import "dotenv/config";
import {
  Fee,
  LCDClient,
  MnemonicKey,
  MsgUpdateContractAdmin,
} from "@terra-money/terra.js";
import {
  MsgInstantiateContract,
  MsgExecuteContract,
  MsgStoreCode,
} from "@terra-money/terra.js";
import { readFileSync } from "fs";
import { Bech32, toHex } from "@cosmjs/encoding";
import { zeroPad } from "ethers/lib/utils.js";

// gas estimation wasn't working, so you'll find many hardcoded values in here
// YMMV

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// look, broadcast and broadcastBlock still resulted in sequence mismatches
// and nobody has time for that
async function broadcastAndWait(terra, tx) {
  const response = await terra.tx.broadcast(tx);
  let currentHeight = (await terra.tendermint.blockInfo()).block.header.height;
  while (currentHeight <= response.height) {
    await sleep(100);
    currentHeight = (await terra.tendermint.blockInfo()).block.header.height;
  }
  return response;
}

// Terra addresses are "human-readable", but for cross-chain registrations, we
// want the "canonical" version
function convert_terra_address_to_hex(human_addr) {
  return "0x" + toHex(zeroPad(Bech32.decode(human_addr).data, 32));
}

const artifacts = [
  // "wormhole.wasm",
  // "token_bridge_terra.wasm",
  // "cw20_wrapped.wasm",
];

/* Set up terra client & wallet */

const terra = new LCDClient({
  URL: "https://terra-classic-lcd.publicnode.com",
  chainID: "columbus-5",
  isClassic: false,
});

const wallet = terra.wallet(
  new MnemonicKey({
    mnemonic: process.env.MNEMONIC,
  })
);

/* Deploy artifacts */

// const codeIds = {};
const codeIds = {
  "wormhole.wasm": 557, // current wasm
  // "wormhole.wasm": 8143, // new wasm
  "token_bridge_terra.wasm": 8144,
  "cw20_wrapped.wasm": 767, // old wasm
  // "cw20_wrapped.wasm": 8145, // new wasm
};

for (const file of artifacts) {
  const contract_bytes = readFileSync(`../artifacts/${file}`);
  console.log(`Storing WASM: ${file} (${contract_bytes.length} bytes)`);

  const store_code = new MsgStoreCode(
    wallet.key.accAddress,
    contract_bytes.toString("base64")
  );

  const tx = await wallet.createAndSignTx({
    msgs: [store_code],
    memo: "",
    fee: new Fee(5000000, { uluna: 200_000_000 }),
  });

  const rs = await broadcastAndWait(terra, tx);
  console.log(rs.raw_log);
  const ci = /"code_id","value":"([^"]+)/gm.exec(rs.raw_log)[1];
  codeIds[file] = parseInt(ci);
}

console.log(codeIds);

/* Instantiate contracts.
 *
 * We instantiate the core contracts here (i.e. wormhole itself and the bridge contracts).
 * The wrapped asset contracts don't need to be instantiated here, because those
 * will be instantiated by the on-chain bridge contracts on demand.
 * */

// Governance constants defined by the Wormhole spec.
const govChain = 1;
const govAddress =
  "0000000000000000000000000000000000000000000000000000000000000004";

async function instantiate(contract, inst_msg, label) {
  var address;
  await wallet
    .createAndSignTx({
      msgs: [
        new MsgInstantiateContract(
          wallet.key.accAddress,
          wallet.key.accAddress,
          codeIds[contract],
          inst_msg,
          undefined,
          label
        ),
      ],
      memo: "",
      fee: new Fee(5000000, { uluna: 200_000_000 }),
    })
    .then((tx) => broadcastAndWait(terra, tx))
    .then((rs) => {
      address = /"_contract_address","value":"([^"]+)/gm.exec(rs.raw_log)[1];
    });
  console.log(
    `Instantiated ${contract} at ${address} (${convert_terra_address_to_hex(
      address
    )})`
  );
  return address;
}

// Instantiate contracts

// const addresses = {};
const addresses = {
  // TEST SETUP 1
  // existing core
  "wormhole.wasm": "terra1dq03ugtd40zu9hcgdzrsq6z2z4hwhc9tqk2uy5",
  // against existing core
  // "token_bridge_terra.wasm":
  //   "terra1hqjsuypxjyhjqxcph3at0d5jw84yhd3h7hzrvw0xhhsr9vc0l39s63zsu0",

  // TEST SETUP 2
  // // new build
  // "wormhole.wasm":
  //   "terra1stflcrlulqs9xpy63e9ey3ynrpd2249527sf79xth8w58ykqkwxq7ry7q7",
  // // against new core
  // "token_bridge_terra.wasm":
  //   "terra146np8yvga9rv28urzh5wm54h9h9zm0xg9dmvl6ruydfreqn6eyxqjq5vgw",

  // TEST SETUP 3
  // // old code id
  // "wormhole.wasm":
  //   "terra1h940amys4jv0ytcfrd3n66545d4rx6w7u39c9xr2gmsl2w8ng0jql9c970",
  // // against old core code
  // "token_bridge_terra.wasm":
  //   "terra10ljyg6atu6jrxmzr0v0ln03tvgh6dp7uslfmngz5vhnag4p5l80qk0pt9n",
};

// // devnet guardian public key
// const init_guardians = ["beFA429d57cD18b7F8A4d91A2da9AB4AF05d0FBe"];

// addresses["wormhole.wasm"] = await instantiate(
//   "wormhole.wasm",
//   {
//     gov_chain: govChain,
//     gov_address: Buffer.from(govAddress, "hex").toString("base64"),
//     guardian_set_expirity: 86400,
//     initial_guardian_set: {
//       addresses: init_guardians.map((hex) => {
//         return {
//           bytes: Buffer.from(hex, "hex").toString("base64"),
//         };
//       }),
//       expiration_time: 0,
//     },
//   },
//   "wormholeTest"
// );

addresses["token_bridge_terra.wasm"] = await instantiate(
  "token_bridge_terra.wasm",
  {
    // gov_chain: govChain,
    // gov_address: Buffer.from(govAddress, "hex").toString("base64"),
    gov_chain: 6,
    gov_address: Buffer.from(
      "00000000000000000000000049887a216375fded17dc1aaad4920c3777265614",
      "hex"
    ).toString("base64"),
    wormhole_contract: addresses["wormhole.wasm"],
    wrapped_asset_code_id: codeIds["cw20_wrapped.wasm"],
  },
  "tokenBridgeTest"
);

/* Registrations: tell the bridge contracts to know about each other */

const contract_registrations = {
  "token_bridge_terra.wasm": [
    // Solana devnet token bridge registration
    // "01000000000100c9f4230109e378f7efc0605fb40f0e1869f2d82fda5b1dfad8a5a2dafee85e033d155c18641165a77a2db6a7afbf2745b458616cb59347e89ae0c7aa3e7cc2d400000000010000000100010000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000546f6b656e4272696467650100000001c69a1b1a65dd336bf1df6a77afb501fc25db7fc0938cb08595a9ef473265cb4f",
    // Ethereum devnet token bridge registration
    // "01000000000100e2e1975d14734206e7a23d90db48a6b5b6696df72675443293c6057dcb936bf224b5df67d32967adeb220d4fe3cb28be515be5608c74aab6adb31099a478db5c01000000010000000100010000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000546f6b656e42726964676501000000020000000000000000000000000290fb167208af455bb137780163b7b7a9a10c16",
    // Avalanche mainnet token bridge registration
    "01000000030d022fa91e5df8ef1a320710730c63143c72e8ac8309546c7b36e3a974cc42ae3188169bba1d62afb5a9d04d09cea0b6fdd5fbff9bd3828b9e43d40c66b4a7ac4188010355e8a4edb5de6ce386ba67204da0fb15559b43788cdd0471fdd560c4c5aa81307a6be777fc8f525fee0f79faef62f1a91f99465f84dad8ebb53b4df68a5322390104570a49a223c855bf61fefce149e52efab20d8be703f5a0decfb0cdcffea75cd9418ac7f375a8ddff481eb19494f0ada6532aa2bfcb8f5fe7d79ffa42bcb69d8b000559cf3254735ba37c09512da6cba3417892cef2d8cee64721d85bb652233965ce38d9ef1db109b138bd4a8a75bf05e414ea0123eda9ed673295d16aee13e2b0cd0106b9e38f4a941c104b1b2077061cf5212f4684795b90220f078fa4d38d08fe2080526c82bf9608197e594bb1e575789d201408ccdf56bf323b64ef173c6c75dd44010761d86f30d709fa3304322eb68d5e319af6696291a2c27d3d94314d3a94af6f9b19b60e64d4eabc8a3334f5baf6b087605b51ed3d0fa1049a6711645d81773bff0108216485ceff70b54f363e49c00a5418cce3f460092f119e2049eb5ca56b8bf4d358e57b7180a97ade4700bee8b77d047515e63e83849039a4b2527a349ef6d1640109c8990d7c964186a264ffa01291a23ef8ff644830d76a6b9d17dff6455bcb67271913c099e3597656ab2016152f55af78861e513787847f645bacaa3193c053bb010c847815ab7ce77f9151fbd35fff9767f73035dbc76c0683e1efedc89eb16c93284de384ad6de521200a1cef67279a1d41b714b3e3e558796bd287243453b81a2c000d721ffed26dc5f06ee8858b9595c8a57870f663f10f03e2ad078679a6373b24ee457eafe4bdcc7005f2a2cfb674f0c29394a64c21c81a59824965566e6859dcf0000f28f1f759bc52cc011fcaba0482cd4c3012e9474cc5089b185747d848e998e72231a0c8dab79041bbe804c13032411afd78a386df08ac517939828a62effb22b60110720e9720728dd34858fa83e292730b64991ec9bc8c2f999ab3bf3873f2254e4972c097153e9dfa4cb9b6ab2e2ffd8d9483ac7d6002754795e41fd4aab001f9c6011161cc391d56aead20f0e1169e759cb320277afaf9cf08adb31db58040eb2c97042cf92037df376c87c65e386ec0eb26e22e4ce5d9ace143c02a26612a3d2cab81000000000032bda66200010000000000000000000000000000000000000000000000000000000000000004e2dcca3b0a7d091320000000000000000000000000000000000000000000546f6b656e42726964676501000000060000000000000000000000000e082f06ff657d94310cb8ce8b0d9a04541d8052",
  ],
};

for (const [contract, registrations] of Object.entries(
  contract_registrations
)) {
  console.log(`Registering chains for ${contract}:`);
  for (const registration of registrations) {
    await wallet
      .createAndSignTx({
        msgs: [
          new MsgExecuteContract(
            wallet.key.accAddress,
            addresses[contract],
            {
              submit_vaa: {
                data: Buffer.from(registration, "hex").toString("base64"),
              },
            },
            { uluna: 1000 }
          ),
        ],
        memo: "",
        fee: new Fee(500000, { uluna: 20_000_000 }),
      })
      .then((tx) => broadcastAndWait(terra, tx))
      .then((rs) => console.log(rs));
  }
}

/* Test sending a message */

await wallet
  .createAndSignTx({
    msgs: [
      new MsgExecuteContract(
        wallet.key.accAddress,
        addresses["wormhole.wasm"],
        {
          post_message: {
            message: Buffer.from("hello", "ascii").toString("base64"),
            nonce: 1,
          },
        },
        {}
        // { uluna: 10000 } // if fee is set (old code id newly initialized)
      ),
    ],
    memo: "",
    fee: new Fee(200000, { uluna: 10_000_000 }),
  })
  .then((tx) => broadcastAndWait(terra, tx))
  .then((rs) => console.log(rs));

/* Test depositing and withdrawing native tokens */

await wallet
  .createAndSignTx({
    msgs: [
      new MsgExecuteContract(
        wallet.key.accAddress,
        addresses["token_bridge_terra.wasm"],
        {
          deposit_tokens: {},
        },
        { uluna: 10000 }
      ),
    ],
    memo: "",
    fee: new Fee(200000, { uluna: 10_000_000 }),
  })
  .then((tx) => broadcastAndWait(terra, tx))
  .then((rs) => console.log(rs));

await wallet
  .createAndSignTx({
    msgs: [
      new MsgExecuteContract(
        wallet.key.accAddress,
        addresses["token_bridge_terra.wasm"],
        {
          withdraw_tokens: {
            asset: {
              native_token: {
                denom: "uluna",
              },
            },
          },
        },
        {}
      ),
    ],
    memo: "",
    fee: new Fee(200000, { uluna: 10_000_000 }),
  })
  .then((tx) => broadcastAndWait(terra, tx))
  .then((rs) => console.log(rs));

/* Test sending and receiving native tokens */

await wallet
  .createAndSignTx({
    msgs: [
      new MsgExecuteContract(
        wallet.key.accAddress,
        addresses["token_bridge_terra.wasm"],
        {
          deposit_tokens: {},
        },
        { uluna: 10000 }
      ),
      new MsgExecuteContract(
        wallet.key.accAddress,
        addresses["token_bridge_terra.wasm"],
        {
          initiate_transfer: {
            asset: {
              amount: "10000",
              info: {
                native_token: {
                  denom: "uluna",
                },
              },
            },
            recipient_chain: 2,
            recipient: Buffer.from(
              "0000000000000000000000000000000000000000000000000000000000000000",
              "hex"
            ).toString("base64"),
            fee: "0",
            nonce: 1,
          },
        },
        {} // no fee?
        // { uluna: 10050 } // fee + tax
      ),
    ],
    memo: "",
    fee: new Fee(500000, { uluna: 20_000_000 }),
  })
  .then((tx) => broadcastAndWait(terra, tx))
  .then((rs) => console.log(rs));

/* test upgrade */

await wallet
  .createAndSignTx({
    msgs: [
      new MsgUpdateContractAdmin(
        wallet.key.accAddress,
        addresses["token_bridge_terra.wasm"],
        addresses["token_bridge_terra.wasm"]
      ),
    ],
    memo: "",
    fee: new Fee(200000, { uluna: 10_000_000 }),
  })
  .then((tx) => broadcastAndWait(terra, tx))
  .then((rs) => console.log(rs));

const UPGRADE_VAA_6097_FROM_ETH =
  "AQAAAAMNA4M1EZeonAE22/WmeXcWp1kJci8XZj/MRr9K019QfB/zXsrozO28hSPeq4wGvT2GZOvf7djGlYhAIXYQOCx7IUMABBrS/U8YwjT/jhAkTjsuGH1ig5VVIPMjCi2QDxD6Wr5oGOoBBXWAK3AUxMP/nuawQ1/dYKZjJ1EE9ibbGP3dNxABBVIMwhY0er6LQzSeTdvBtyLpLM8utXrdopTxE9ZzA5COeMGqzdn6XPmyARHHibeeQRDNcGxS6lV1CJv1Yz2/BEQBBlhVtjbvTto+YW/oE0tlwcAMF7cvoNNgaLGLQtHwr/m7dmS/1IgwyU2xlEa1GbGNKWHfFDpgQvdPpY753hDNjf8ACAluQ2xk+e2IbO0KBexrIjjF+LR9Zu05ofVeyBytRGC2NQnpb33jkFNdeirY7zhf6KJ/YfkkgO4wTDJ29Hz65XoACTvtROqwmVpmmehMW5GP0UitXzvb8wGuuA9H9WemocVSbIPFJvvsW5UhWFA2ivQUgeSpFVWzA4AsH5Fd2InYjtsACkMb0wH0gf6u6K27OoriGhYKPGb9kTd7PmsOnLRqQ/0Rc1fjqZ0iQi73qMAhWT+Kl1ZxIb8v8DPuRbDrkrNsFCwBDLt6ukezyOE6aP/H+RBJIstAGDo0kS3i3oRDOhhVOplKIs1l1RewUZTP4xVY5uekFdWwhh7Yg8/W46qLAdNj6hcADbOUgdrTYVn7+dqEWtrWhZjhfV70Y5Ih56ZVytpx2FczWF/fhtXr4B0F/RRohFZrGAZBfIijgEZj2TUByQaBjOcADqtjoqjyFady3nvn8WFdeu2xcHU+qLwMbGriJQNfzCn/Yjg/dDwdQ8e5R5vfU1cZXXwokS/BnM1z4WteOuJj2U8AEIoiz7KZb+IGtF9h0SMAzLfWEJ0o9uJPZU8FkyXb1vZRV/NqWjvaaiNiddHgIS0KMzGpWXfTqASkb3DYKn4XaEMBEY6ry6W4U5Dyl/Ys2Z8unKCa/uYCCoqLH4ji34SYuPG3YXeyqWA0Y8FnIUKVCLVVB/U3GtKlJgqQQMSTF7fzrroAEi2DeNuO48sDsCG4yFe9IeYf2rfKSEI7pTN9ce53OPMgRQag8CilE/APsjqIOKBrhobZUtofmj7vv3nYUuZQ6JQAZSbmswAAAAEAAgAAAAAAAAAAAAAAAEmIeiFjdf3tF9waqtSSDDd3JlYUAAAAAAAAAAjIAAAAAAAAAAAAAAAAAAAAAAAAAAAAVG9rZW5CcmlkZ2UCAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAX0Q==";
const UPGRADE_VAA_8144_FROM_ETH =
  "AQAAAAMNAwkfELExATCNmJC80nNnnP2Dp1PhOi86rxgpKfuj7ZkoJYpr284zLOww/3q/gQ0GYZtPNBKp+d0mmNUWPfaIiPoBBO83btgmjSe28cIJa4ce3iD3awDCaod6bpn2F1a/mvLCGQlTP4m1r0/VZSd8/6srSjotd5ku7+shSSpq2VykEEUABcITxQu9DPcYkmTCDiImGQNtFjwDpt2qcZAyzf0Ypyl5K1CXzGS/LTA2NbeyIWvHc45kQlLafDX16F4B2EOVyBgABohhup0bFYQRjdxfehhA4Dhq9uJWa6m5C25rs0fddLKqe58Lp3Pnm8psXTyYOOdYhs7GKVx6ehvg/vXMpk1OIJYAB2Cio6MA1pBBTHhZy6soWDfjlwNMOHu2NbeuGDcwm3e6F8BBFSJZu9dxSv6UcwIBhM3v5z8VghXQKCYPxg/s5xIBCNWmeNzwvXpeAROefiAIYOShoAi/F81WZKhvIWAB7va+aR0x8g9Vh/YwihTZNpxK1cFo884YMA8y7N0HlIO+2JEBCUxAkNWS1aBEE0p+Yg7fPG4PbR7UhkPtr96TaHa06iTJAQW0ArcCl9ctxYq4M/6ZVJZOFPMA4dzwSFBk7QEN0b0ACkQGOWN9636jUgDnCKupYaK0AoF+QQzGw9aBb0ioKtbkWmJP2spcY538jM4DI9ct3SPL+utkI8nIFN0Xeqdh82IBDTur+ih66I1tG3Bu90vwDlGAZlvxJFgyr97U0lAuLkwlAz0W0fVC6wunIeLrVt6Q+gbwzQtKNGDXwxLRygDxDysBDhyD2wpC65k3oIE+Ez86rq++pIabC5iLKDSrEQj7CDWgZFhPhCS43stNXa/j+5fksD6VaN4iwiA5jmP5NNNeD5gBEKY3jmRLOKHLDUb91zd+efInZ3MB0hidGzkXmezFRRyfRT8ETjE3523Mhj4ICf76o8hQBZutjQzCSZidmhy8AlsBEfsS3IiPNdMZfLjksrjEqiXoDnZp6Pp2vfE29uE1qumlGt6WWIkWrmt1TJ3DsDmlnD+6tNnGndAA7Gj9MuQoOFQAEqZRRNy/PXLBjr+8pqAjmP76R78ff4Lt7mJq1uOTmNBRYU5bogYnPNWvvjt1K7AZf1Lk44usOhmTunFQdo3XjOcBZSbqowAAAAEAAgAAAAAAAAAAAAAAAEmIeiFjdf3tF9waqtSSDDd3JlYUAAAAAAAAAAnIAAAAAAAAAAAAAAAAAAAAAAAAAAAAVG9rZW5CcmlkZ2UCAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf0A==";
const UPGRADE_VAA_8144_FROM_AVAX =
  "AQAAAAMNAKhHZwXtXsFG72BrMFuvFCQ6clkxt4xrSX0zjo+Mo9rxAqm6us8FTlymKO1LG2zQh2PANeWgyDgBHTZ7hCqIPGkBAZ14jimE3tnVDNabKqK2d8//YXyxmLoR6yXSQ4z4P/pIKLuT7yuj9h5rv0MfxMRv5GpKS776OMAH8sNAMwOA/dcBAv1JxO9L/kSxYP7shdbBzGpyUi8cZNtr9vDWvUKhabRQH7d3MKZOehp6IpTbGqVjCo4hLexROgDv7CStB7DpbGcBAwxVHgibqA3vWaqqIvXCC39rykV8R0iVaRcV40RSqkiSIlwqMn20e5rA0wpPqykGnFfM+XZP8CnF7BsNpg5J1NIABH6WsSuZTp0XEyVKk/uhvhy6czEge2oAIHvYP2+GqXDpZns2lEj7unP1aRWnb/ENt18nGOkj9ceszQplijo5cpkBB/uLlAIv6OsnvZftBdUDWt+UOM1JmRpPNWuvUNmrubEUOaiP/2/8mNjYuFzEMb7Aysz16+iDd8Ee5N38yjttT5wBCHidEaf5mCQ13IHuLXQ07pkVUPYcToi7lYFawGjkZMu/RXXQKdGdEcCQcvjHRvUpLQPwKY4RRQE3vQEM6I3ob+gBC+bh5z2+dvhQN1UrD2OY4Q+9zlnhqYx75mjhzP+OgeficzMzWojAJ0zF+uOhtxHIxAS2EG18MD7vTZ2Aou1hvLcADDZRhAganHu5qroeu41NegWoI/x6jit8XVVfmJ2cazOwTSoIF3HXNANjQqiPvddaAeUXMQzQFyB0IKYsjeccQdUBDet/Ta8ks4Da+0M/dP0EcAbZDryPKD8qJEIUTmeyq/HaNtl1TqsFu+Fi7jX6bpjseDzY6/RCt2WhmnjOF8qpYkABDvotIzQUeYH70VrXyHxJOLDj+/t2JH5cS2qKIOxoYG/TRicGyk6ZNp6YBSILUreUFoJhsW1N3Nq2AS1dHkhAQYIBD7akF9Pu5P1ONXD/aRvs1xKDPdWt/8nzRkXFuQcUzRK/BxjkySDQ8Bbmpj+VBfO9In/9MUxZ66JxhbAHAlz9yjIBEMEpQaS8YdliRuQidguZTDViwyQG8GKGY91jxfJoNxOudbk39P3Y4etiv7riZ0RCOOSRpYCqg0ixPq2nBFbSvVcAZSbvfAAAAAEABgAAAAAAAAAAAAAAAEmIeiFjdf3tF9waqtSSDDd3JlYUAAAAAAAAAADIAAAAAAAAAAAAAAAAAAAAAAAAAAAAVG9rZW5CcmlkZ2UCAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf0A==";
const UPGRADE_VAA_8144_FROM_AVAX_2 =
  "AQAAAAMNAGyLJixW8OAUN2ZVlWmVzvktgTASitTJiIf+OgprjBLmEifh0Yzkt8QeldLprkRCCsQudTWVxKyrJuvzf6aSyiABAfgI0qrDiWhZTk//P93eGRgpv9Fji/PDHx8PptdC2RrtVkg4ViBPylTcjbj+q1kipkQ3y1s7ejN1oNTTM/aKlHIAAl7YFEtgJKvv4a0kCIfnsuqSvqJTa13DP9YJOwJm2783ePgXEFCHG4/9MYds5g9x79oUMpRHcaG8Q65er+2Y/lsABTrhap/jB/LLL8j63wrNNtXbNqCFNfu5e7p6GueZSnFRbIuQv/QCP0eldQ0wK6M1ROmYdpiAJ9AkaE++LGQtftABBmbxKxKZZlLKjAqOgfaNL8/AcaIec2eltLQzd+wuTo9hT3kd6Hf7lg6qkL3ALvi2vYl7I5HdcgAJetciw2LZtcIAB5d5SKiEjMcUUjDrxvH3Xo7GcIQQU3EKrT1w+jp2W1oZWoyaz3mH2CT+eFUm/QPKkFWqQ4P5DuaY20Gm8RdCzEEACgLTrnY+B5vu7VoziiKaSZ8Ka5OubkkmbNplpOHYm/7WHrVr+M1Dme8nUyOj1eMTx4lDL04WeS70dqxPfgEg+DcBCy3OjOpxhcBT9m9q23xBVLxV8U1MrSsB7evgYgMwbe1YZYSfNRfEtp34ZSImf69xIk8Dpq7YuKHw9oVd06JSnvEBDZlMwlTYqEqs6xIO6Wvlrbhklux5sFSXILbblcY8ZGEgObE1jKenz7NTZ6TUyobEtbNLkBf4pXLkKgM0StVCmkQADkjImGoALLhRz8cVFaib6nNVEgo+paCmcYmLBylq+uI0brJTTw0aW62a8EB/YiGX8x9depTA8MZvX8DvoizHFlABEFFjAWXVyVHEoaCRKKwiqFGwpaUlqwikH8YIrEJDpmVYYtyJ3slWWUx1EZPBv5uXIU6W+/HDcElioxECcy6KpUABEUnBGBdighxudauXOtikpGT6Rgk8i5jMb2jaBIIshIP8fFyouU486Ij26r8Q0Hn6rcO9Bl1iqx/w+TPqM1cSCrcBErqLvcPsB5TuLfRV7kqSVJW8DPlE6MmTH3ZlcFCZOcTvQ2OlSpu2JoxzoNnD9PZrwz2ZQ3gZHQSXjC2QH83WWEwAZSbwBwAAAAEABgAAAAAAAAAAAAAAAEmIeiFjdf3tF9waqtSSDDd3JlYUAAAAAAAAAAHIAAAAAAAAAAAAAAAAAAAAAAAAAAAAVG9rZW5CcmlkZ2UCAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf0A==";

await wallet
  .createAndSignTx({
    msgs: [
      new MsgExecuteContract(
        wallet.key.accAddress,
        addresses["token_bridge_terra.wasm"],
        {
          submit_vaa: {
            data: UPGRADE_VAA_8144_FROM_AVAX,
          },
        }
      ),
    ],
    memo: "",
    fee: new Fee(1000000, { uluna: 50_000_000 }),
  })
  .then((tx) => broadcastAndWait(terra, tx))
  .then((rs) => console.log(rs));

await wallet
  .createAndSignTx({
    msgs: [
      new MsgExecuteContract(
        wallet.key.accAddress,
        addresses["token_bridge_terra.wasm"],
        {
          submit_vaa: {
            data: UPGRADE_VAA_8144_FROM_AVAX_2,
          },
        }
      ),
    ],
    memo: "",
    fee: new Fee(1000000, { uluna: 50_000_000 }),
  })
  .then((tx) => broadcastAndWait(terra, tx))
  .then((rs) => console.log(rs));
