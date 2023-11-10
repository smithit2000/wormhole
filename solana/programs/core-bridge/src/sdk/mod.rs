//! **ATTENTION INTEGRATORS!** Core Bridge Program developer kit. It is recommended to use
//! [sdk::cpi](crate::sdk::cpi) for invoking Core Bridge instructions as opposed to the
//! code-generated Anchor CPI (found in [cpi](crate::cpi)) and legacy CPI (found in
//! [legacy::cpi](crate::legacy::cpi)).
//! CPI builders. Methods useful for interacting with the Core Bridge program from another program.

mod publish_message;
pub use publish_message::*;

mod prepare_message;
pub use prepare_message::*;

/// Sub-module for System program interaction.
pub mod system_program {
    pub use crate::utils::cpi::{create_account_safe, CreateAccountSafe};
}

#[doc(inline)]
pub use crate::{
    constants::{PROGRAM_EMITTER_SEED_PREFIX, SOLANA_CHAIN},
    cpi::{finalize_message_v1, init_message_v1, write_message_v1},
    id,
    legacy::{
        cpi::{post_message_unreliable, PostMessageUnreliable},
        instruction::PostMessageArgs,
    },
    processor::{InitMessageV1Args, WriteMessageV1Args},
    types::*,
    utils::vaa::{claim_vaa, ClaimVaa, VaaAccount},
};

pub mod legacy {
    pub use crate::legacy::utils::{
        AccountVariant, LegacyAccount, LegacyAnchorized, ProcessLegacyInstruction,
    };
}

/// Convenient method to determine the space required for a
/// [PostedMessageV1](crate::zero_copy::PostedMessageV1) account before the account is initialized
/// via [init_message_v1](crate::wormhole_core_bridge_solana::init_message_v1).
pub fn compute_prepared_message_space(payload_size: usize) -> usize {
    crate::state::PostedMessageV1::PAYLOAD_START + payload_size
}

/// Wormhole Core Bridge Program.
pub type CoreBridge = crate::program::WormholeCoreBridgeSolana;
