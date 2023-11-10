use crate::{
    error::CoreBridgeError,
    legacy::{instruction::PostMessageArgs, utils::LegacyAnchorized},
    state::{
        Config, EmitterSequence, PostedMessageV1Data, PostedMessageV1Info,
        PostedMessageV1Unreliable,
    },
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(_nonce: u32, payload_len: u32)]
pub struct PostMessageUnreliable<'info> {
    /// This account is needed to determine how many lamports to transfer from the payer for the
    /// message fee (if there is one).
    #[account(
        seeds = [Config::SEED_PREFIX],
        bump,
    )]
    config: Account<'info, LegacyAnchorized<Config>>,

    /// This message account is observed by the Guardians.
    ///
    /// NOTE: This space requirement enforces that the payload length is the same for every call to
    /// this instruction handler. So for unreliable message accounts already created, this
    /// implicitly prevents the payload size from changing.
    #[account(
        init_if_needed,
        payer = payer,
        space = PostedMessageV1Unreliable::compute_size(payload_len.try_into().unwrap()),
    )]
    message: Account<'info, LegacyAnchorized<PostedMessageV1Unreliable>>,

    /// The emitter of the Core Bridge message. This account is typically an integrating program's
    /// PDA which signs for this instruction.
    emitter: Signer<'info>,

    /// Sequence tracker for given emitter. Every Core Bridge message is tagged with a unique
    /// sequence number.
    #[account(
        init_if_needed,
        payer = payer,
        space = EmitterSequence::INIT_SPACE,
        seeds = [
            EmitterSequence::SEED_PREFIX,
            emitter.key().as_ref()
        ],
        bump,
    )]
    emitter_sequence: Account<'info, LegacyAnchorized<EmitterSequence>>,

    #[account(mut)]
    payer: Signer<'info>,

    /// CHECK: Fee collector, which is used to update the [Config] account with the most up-to-date
    /// last lamports on this account.
    #[account(
        seeds = [crate::constants::FEE_COLLECTOR_SEED_PREFIX],
        bump,
    )]
    fee_collector: Option<AccountInfo<'info>>,

    /// CHECK: Previously needed sysvar.
    _clock: UncheckedAccount<'info>,

    system_program: Program<'info, System>,
}

impl<'info> crate::legacy::utils::ProcessLegacyInstruction<'info, PostMessageArgs>
    for PostMessageUnreliable<'info>
{
    const LOG_IX_NAME: &'static str = "LegacyPostMessageUnreliable";

    const ANCHOR_IX_FN: fn(Context<Self>, PostMessageArgs) -> Result<()> = post_message_unreliable;

    fn order_account_infos<'a>(
        account_infos: &'a [AccountInfo<'info>],
    ) -> Result<Vec<AccountInfo<'info>>> {
        super::order_post_message_account_infos(account_infos)
    }
}

impl<'info> PostMessageUnreliable<'info> {
    fn constraints(ctx: &Context<Self>) -> Result<()> {
        let msg = &ctx.accounts.message;

        // If the message account already exists, the emitter signing for this instruction must be
        // the same one encoded in this account.
        if !msg.payload.is_empty() {
            require_keys_eq!(
                ctx.accounts.emitter.key(),
                msg.emitter,
                CoreBridgeError::EmitterMismatch
            );
        }

        // Done.
        Ok(())
    }
}

/// Processor to post (publish) a Wormhole message by setting up the message account for
/// Guardian observation. This message account has either been created already or is created in
/// this call.
///
/// If this message account already exists, the emitter must be the same as the one encoded in
/// the message and the payload must be the same size.
#[access_control(PostMessageUnreliable::constraints(&ctx))]
fn post_message_unreliable(
    ctx: Context<PostMessageUnreliable>,
    args: PostMessageArgs,
) -> Result<()> {
    // Take the message fee amount from the payer.
    super::handle_message_fee(
        &ctx.accounts.config,
        &ctx.accounts.payer,
        &ctx.accounts.fee_collector,
        &ctx.accounts.system_program,
    )?;

    let PostMessageArgs {
        nonce,
        payload,
        commitment,
    } = args;

    // Should we require the payload not be empty?
    require!(
        !payload.is_empty(),
        CoreBridgeError::InvalidInstructionArgument
    );

    // Finally set the `message` account with posted data.
    ctx.accounts.message.set_inner(
        PostedMessageV1Unreliable::from(PostedMessageV1Data {
            info: PostedMessageV1Info {
                consistency_level: commitment.into(),
                emitter_authority: Default::default(),
                status: crate::legacy::state::MessageStatus::Published,
                _gap_0: Default::default(),
                posted_timestamp: Clock::get().map(Into::into)?,
                nonce,
                sequence: ctx.accounts.emitter_sequence.value,
                solana_chain_id: Default::default(),
                emitter: ctx.accounts.emitter.key(),
            },
            payload,
        })
        .into(),
    );

    // Increment emitter sequence value.
    ctx.accounts.emitter_sequence.value += 1;

    // Done.
    Ok(())
}
