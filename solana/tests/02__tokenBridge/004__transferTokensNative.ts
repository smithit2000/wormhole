import * as anchor from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  MINT_INFO_8,
  MINT_INFO_9,
  MintInfo,
  expectDeepEqual,
  expectIxErr,
  expectIxOk,
  expectIxOkDetails,
  getTokenBalances,
} from "../helpers";
import * as tokenBridge from "../helpers/tokenBridge";
import { expect } from "chai";

describe("Token Bridge -- Legacy Instruction: Transfer Tokens (Native)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const program = tokenBridge.getAnchorProgram(connection, tokenBridge.localnet());
  const payer = (provider.wallet as anchor.Wallet).payer;

  const forkedProgram = tokenBridge.getAnchorProgram(connection, tokenBridge.mainnet());

  const mints: MintInfo[] = [MINT_INFO_8, MINT_INFO_9];

  before("Set Up Mints and Token Accounts", async () => {
    for (const { mint } of mints) {
      const token = getAssociatedTokenAddressSync(mint, payer.publicKey);

      await mintTo(connection, payer, mint, token, payer, BigInt("1000000000000000000"));
    }
  });

  describe("Ok", () => {
    const unorderedPrograms = [
      {
        name: "System",
        pubkey: anchor.web3.SystemProgram.programId,
        forkPubkey: anchor.web3.SystemProgram.programId,
        idx: 14,
      },
      { name: "Token", pubkey: TOKEN_PROGRAM_ID, forkPubkey: TOKEN_PROGRAM_ID, idx: 15 },
      {
        name: "Core Bridge",
        pubkey: tokenBridge.coreBridgeProgramId(program),
        forkPubkey: tokenBridge.coreBridgeProgramId(forkedProgram),
        idx: 16,
      },
    ];

    const possibleIndices = [13, 14, 15, 16];

    for (const { name, pubkey, forkPubkey, idx } of unorderedPrograms) {
      for (const possibleIdx of possibleIndices) {
        if (possibleIdx == idx) {
          continue;
        }

        it(`Invoke \`transfer_tokens_native\` with ${name} Program at Index == ${possibleIdx}`, async () => {
          const { mint } = MINT_INFO_8;
          const srcToken = getAssociatedTokenAddressSync(mint, payer.publicKey);

          const amount = new anchor.BN(10);
          const approveIx = tokenBridge.approveTransferAuthorityIx(
            program,
            srcToken,
            payer.publicKey,
            amount
          );

          const args = defaultArgs(amount, new anchor.BN(0));
          const coreMessage = anchor.web3.Keypair.generate();
          const ix = tokenBridge.legacyTransferTokensNativeIx(
            program,
            {
              payer: payer.publicKey,
              srcToken,
              mint,
              coreMessage: coreMessage.publicKey,
            },
            args
          );
          expectDeepEqual(ix.keys[idx].pubkey, pubkey);
          ix.keys[idx].pubkey = ix.keys[possibleIdx].pubkey;
          ix.keys[possibleIdx].pubkey = pubkey;

          const forkCoreMessage = anchor.web3.Keypair.generate();
          const forkedApproveIx = tokenBridge.approveTransferAuthorityIx(
            forkedProgram,
            srcToken,
            payer.publicKey,
            amount
          );
          const forkedIx = tokenBridge.legacyTransferTokensNativeIx(
            forkedProgram,
            {
              payer: payer.publicKey,
              srcToken,
              mint,
              coreMessage: forkCoreMessage.publicKey,
            },
            args
          );
          expectDeepEqual(forkedIx.keys[idx].pubkey, forkPubkey);
          forkedIx.keys[idx].pubkey = forkedIx.keys[possibleIdx].pubkey;
          forkedIx.keys[possibleIdx].pubkey = forkPubkey;

          await Promise.all([
            expectIxOk(connection, [approveIx, ix], [payer, coreMessage]),
            expectIxOk(connection, [forkedApproveIx, forkedIx], [payer, forkCoreMessage]),
          ]);
        });
      }
    }

    for (const { mint, decimals } of mints) {
      const srcToken = getAssociatedTokenAddressSync(mint, payer.publicKey);

      it(`Invoke \`transfer_tokens_native\` (${decimals} Decimals)`, async () => {
        const amount = new anchor.BN("88888888");
        const relayerFee = new anchor.BN("11111111");

        const balancesBefore = await getTokenBalances(program, forkedProgram, srcToken);

        const [coreMessage, txDetails, forkCoreMessage, forkTxDetails] = await parallelTxDetails(
          program,
          forkedProgram,
          { payer: payer.publicKey, mint: mint, srcToken },
          defaultArgs(amount, relayerFee),
          payer
        );

        await tokenBridge.expectCorrectTokenBalanceChanges(
          connection,
          srcToken,
          balancesBefore,
          tokenBridge.TransferDirection.Out
        );

        // TODO: Check that the core messages are correct.
      });
    }
  });

  describe("New Implementation", () => {
    it(`Cannot Invoke \`transfer_tokens_native\` (Invalid Relayer Fee)`, async () => {
      const { mint } = mints[0];
      const srcToken = getAssociatedTokenAddressSync(mint, payer.publicKey);
      const coreMessage = anchor.web3.Keypair.generate();

      // Create an relayerFee that is larger than the amount.
      const amount = new anchor.BN("88888888");
      const relayerFee = new anchor.BN("99999999");
      expect(relayerFee.gt(amount)).to.be.true;

      // Create transfer instruction.
      const approveIx = tokenBridge.approveTransferAuthorityIx(
        program,
        srcToken,
        payer.publicKey,
        amount
      );
      const ix = tokenBridge.legacyTransferTokensNativeIx(
        program,
        { coreMessage: coreMessage.publicKey, payer: payer.publicKey, mint, srcToken },
        defaultArgs(amount, relayerFee)
      );

      await expectIxErr(connection, [approveIx, ix], [payer, coreMessage], "InvalidRelayerFee");
    });
  });
});

function defaultArgs(amount: anchor.BN, relayerFee: anchor.BN) {
  return {
    nonce: 420,
    amount,
    relayerFee,
    recipient: Array.from(Buffer.alloc(32, "deadbeef", "hex")),
    recipientChain: 2,
  };
}

async function parallelTxDetails(
  program: tokenBridge.TokenBridgeProgram,
  forkedProgram: tokenBridge.TokenBridgeProgram,
  accounts: { payer: PublicKey; mint: PublicKey; srcToken: PublicKey },
  args: tokenBridge.LegacyTransferTokensArgs,
  payer: anchor.web3.Keypair
) {
  const connection = program.provider.connection;
  const { payer: owner, srcToken: token } = accounts;
  const { amount } = args;
  const coreMessage = anchor.web3.Keypair.generate();
  const approveIx = tokenBridge.approveTransferAuthorityIx(program, token, owner, amount);
  const ix = tokenBridge.legacyTransferTokensNativeIx(
    program,
    {
      coreMessage: coreMessage.publicKey,
      ...accounts,
    },
    args
  );

  const forkCoreMessage = anchor.web3.Keypair.generate();
  const forkedApproveIx = tokenBridge.approveTransferAuthorityIx(
    forkedProgram,
    token,
    owner,
    amount
  );
  const forkedIx = tokenBridge.legacyTransferTokensNativeIx(
    forkedProgram,
    {
      coreMessage: forkCoreMessage.publicKey,
      ...accounts,
    },
    args
  );

  const [txDetails, forkTxDetails] = await Promise.all([
    expectIxOkDetails(connection, [approveIx, ix], [payer, coreMessage]),
    expectIxOkDetails(connection, [forkedApproveIx, forkedIx], [payer, forkCoreMessage]),
  ]);

  return [coreMessage, txDetails, forkCoreMessage, forkTxDetails];
}
