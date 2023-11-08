use crate::{
    constants::{CUSTODY_AUTHORITY_SEED_PREFIX, TRANSFER_AUTHORITY_SEED_PREFIX},
    error::TokenBridgeError,
    state::WrappedAsset,
    utils::{self, TruncateAmount},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use core_bridge_program::sdk::{self as core_bridge_sdk};
use ruint::aliases::U256;
use wormhole_raw_vaas::support::EncodedAmount;

use super::TransferTokensWithPayloadArgs;

#[derive(Accounts)]
pub struct TransferTokensWithPayloadNative<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// Source token account. Because we check the mint of the custody token account, we can
    /// be sure that this token account is the same mint since the Token Program transfer
    /// instruction handler checks that the mints of these two accounts must be the same.
    #[account(
        mut,
        token::mint = mint,
    )]
    src_token: Account<'info, token::TokenAccount>,

    /// Native mint. We ensure this mint is not one that has originated from a foreign
    /// network by checking the wrapped asset account is non-existent.
    mint: Account<'info, token::Mint>,

    /// Non-existent wrapped asset account.
    ///
    /// CHECK: This account should have zero data. Otherwise this mint was created by the Token
    /// Bridge program.
    #[account(
        seeds = [
            WrappedAsset::SEED_PREFIX,
            mint.key().as_ref()
        ],
        bump,
        constraint = non_existent_wrapped_asset.data_is_empty() @ TokenBridgeError::WrappedAsset
    )]
    non_existent_wrapped_asset: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        token::mint = mint,
        token::authority = custody_authority,
        seeds = [mint.key().as_ref()],
        bump,
    )]
    custody_token: Account<'info, token::TokenAccount>,

    /// CHECK: This authority is whom the source token account owner delegates spending approval for
    /// transferring native assets or burning wrapped assets.
    #[account(
        seeds = [TRANSFER_AUTHORITY_SEED_PREFIX],
        bump
    )]
    transfer_authority: AccountInfo<'info>,

    /// CHECK: This account is the authority that can move tokens from the custody account.
    #[account(
        seeds = [CUSTODY_AUTHORITY_SEED_PREFIX],
        bump
    )]
    custody_authority: AccountInfo<'info>,

    /// CHECK: This account is needed for the Core Bridge program.
    core_bridge_config: UncheckedAccount<'info>,

    /// CHECK: This account is needed for the Core Bridge program.
    #[account(mut)]
    core_message: Signer<'info>,

    /// CHECK: We need this emitter to invoke the Core Bridge program to send Wormhole messages.
    /// This PDA address is checked in `post_token_bridge_message`.
    core_emitter: AccountInfo<'info>,

    /// CHECK: This account is needed for the Core Bridge program.
    #[account(mut)]
    core_emitter_sequence: UncheckedAccount<'info>,

    /// CHECK: This account is needed for the Core Bridge program.
    #[account(mut)]
    core_fee_collector: Option<UncheckedAccount<'info>>,

    /// This account is used to authorize sending the transfer with payload. This signer is either
    /// an ordinary signer (whose pubkey will be encoded as the sender address) or a program's PDA,
    /// whose seeds are [b"sender"] (and the program ID will be encoded as the sender address).
    sender_authority: Signer<'info>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
    core_bridge_program: Program<'info, core_bridge_sdk::cpi::CoreBridge>,
}

impl<'info> core_bridge_sdk::cpi::system_program::CreateAccount<'info>
    for TransferTokensWithPayloadNative<'info>
{
    fn payer(&self) -> AccountInfo<'info> {
        self.payer.to_account_info()
    }

    fn system_program(&self) -> AccountInfo<'info> {
        self.system_program.to_account_info()
    }
}

impl<'info> core_bridge_sdk::cpi::PublishMessage<'info> for TransferTokensWithPayloadNative<'info> {
    fn core_bridge_program(&self) -> AccountInfo<'info> {
        self.core_bridge_program.to_account_info()
    }

    fn core_bridge_config(&self) -> AccountInfo<'info> {
        self.core_bridge_config.to_account_info()
    }

    fn core_emitter_authority(&self) -> AccountInfo<'info> {
        self.core_emitter.to_account_info()
    }

    fn core_emitter_sequence(&self) -> AccountInfo<'info> {
        self.core_emitter_sequence.to_account_info()
    }

    fn core_fee_collector(&self) -> Option<AccountInfo<'info>> {
        self.core_fee_collector
            .as_ref()
            .map(|acc| acc.to_account_info())
    }
}

pub fn transfer_tokens_with_payload_native(
    ctx: Context<TransferTokensWithPayloadNative>,
    args: TransferTokensWithPayloadArgs,
) -> Result<()> {
    let TransferTokensWithPayloadArgs {
        nonce,
        amount,
        redeemer,
        redeemer_chain,
        payload,
        cpi_program_id,
    } = args;

    // Generate sender address, which may either be the program ID or the sender authority's pubkey.
    //
    // NOTE: We perform the derivation check here instead of in the access control because we do not
    // want to spend compute units to re-derive the authority if cpi_program_id is Some(pubkey).
    let sender = crate::utils::new_sender_address(&ctx.accounts.sender_authority, cpi_program_id)?;

    let mint = &ctx.accounts.mint;

    // Deposit native assets from the source token account into the custody account.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.src_token.to_account_info(),
                to: ctx.accounts.custody_token.to_account_info(),
                authority: ctx.accounts.transfer_authority.to_account_info(),
            },
            &[&[
                TRANSFER_AUTHORITY_SEED_PREFIX,
                &[ctx.bumps["transfer_authority"]],
            ]],
        ),
        mint.truncate_amount(amount),
    )?;

    // Prepare Wormhole message. We need to normalize these amounts because we are working with
    // native assets.
    let token_transfer = crate::messages::TransferWithMessage {
        norm_amount: EncodedAmount::norm(U256::from(amount), mint.decimals).0,
        token_address: ctx.accounts.mint.key().to_bytes(),
        token_chain: core_bridge_sdk::SOLANA_CHAIN,
        redeemer,
        redeemer_chain,
        sender,
        payload,
    };

    // Finally publish Wormhole message using the Core Bridge.
    utils::cpi::post_token_bridge_message(
        ctx.accounts,
        &ctx.accounts.core_message,
        nonce,
        token_transfer,
    )
}
