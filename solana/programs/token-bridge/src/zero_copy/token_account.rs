use std::cell::Ref;

use anchor_lang::prelude::{
    error, require, require_eq, require_keys_eq, AccountInfo, ErrorCode, Pubkey, Result,
};
use anchor_spl::token::spl_token::state;
use solana_program::program_pack::Pack;

/// This implements a zero-copy deserialization for the Token Program's token account. All struct
/// field doc strings are shamelessly copied from the SPL Token docs.
pub struct TokenAccount<'a>(Ref<'a, &'a mut [u8]>);

impl<'a> TokenAccount<'a> {
    /// The mint associated with this account
    pub fn mint(&self) -> Pubkey {
        Pubkey::try_from(&self.0[0..32]).unwrap()
    }

    /// The owner of this account.
    pub fn owner(&self) -> Pubkey {
        Pubkey::try_from(&self.0[32..64]).unwrap()
    }

    /// The amount of tokens this account holds.
    pub fn amount(&self) -> u64 {
        u64::from_le_bytes(self.0[64..72].try_into().unwrap())
    }

    /// If `delegate` is `Some` then `delegated_amount` represents
    /// the amount authorized by the delegate
    pub fn delegate(&self) -> Option<Pubkey> {
        match self.0[72..76] {
            [0, 0, 0, 0] => None,
            _ => Some(Pubkey::try_from(&self.0[76..108]).unwrap()),
        }
    }

    /// The account's state
    pub fn state(&self) -> state::AccountState {
        match self.0[108] {
            0 => state::AccountState::Uninitialized,
            1 => state::AccountState::Initialized,
            2 => state::AccountState::Frozen,
            _ => panic!("Invalid account state"),
        }
    }

    /// If is_native.is_some, this is a native token, and the value logs the rent-exempt reserve. An
    /// Account is required to be rent-exempt, so the value is used by the Processor to ensure that
    /// wrapped SOL accounts do not drop below this threshold.
    pub fn is_native(&self) -> Option<u64> {
        match u32::from_le_bytes(self.0[109..113].try_into().unwrap()) {
            0 => None,
            _ => Some(u64::from_le_bytes(self.0[113..121].try_into().unwrap())),
        }
    }

    /// The amount delegated
    pub fn delegated_amount(&self) -> u64 {
        u64::from_le_bytes(self.0[121..129].try_into().unwrap())
    }

    /// Optional authority to close the account.
    pub fn close_authority(&self) -> Option<Pubkey> {
        match u32::from_le_bytes(self.0[129..133].try_into().unwrap()) {
            0 => None,
            _ => Some(Pubkey::try_from(&self.0[133..165]).unwrap()),
        }
    }
}

impl<'a> core_bridge_program::sdk::LoadZeroCopy<'a> for TokenAccount<'a> {
    fn load(acc_info: &'a AccountInfo) -> Result<Self> {
        require_keys_eq!(
            *acc_info.owner,
            anchor_spl::token::ID,
            ErrorCode::ConstraintTokenTokenProgram
        );

        let data = acc_info.try_borrow_data()?;
        require_eq!(
            data.len(),
            state::Account::LEN,
            ErrorCode::AccountDidNotDeserialize
        );

        let token = Self(data);
        require!(
            token.state() != state::AccountState::Uninitialized,
            ErrorCode::AccountNotInitialized
        );

        Ok(token)
    }
}
