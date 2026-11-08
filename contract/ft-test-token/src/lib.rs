//! Minimal fungible token for the Cynex near-sandbox suite only.
//!
//! This contract exists so the sandbox suite can fund a policy and
//! settle obligations against a real token on a real local chain. It
//! implements the NEP-141 methods the vault uses (`ft_transfer` for
//! settle, `ft_transfer_call` for funding through `ft_on_transfer`)
//! plus the NEP-145 storage methods those calls need. It is test
//! tooling, not a product: no metadata, no mint after init, no
//! production deployment. Do not point a real vault at it.
//!
//! Storage: two LookupMaps hold balances and the NEAR actually
//! deposited for storage. An account is registered when it has a
//! balance entry, including a zero balance, so registration and
//! balance are the same entry; the deposit map is separate, so
//! storage_balance_of reports what was actually paid.

use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::store::LookupMap;
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, env, near, require,
};

/// Storage charged once per registered account: two map entries
/// (balance and deposit) at the conventional 0.00125 NEAR each,
/// so 0.0025 NEAR in total.
const STORAGE_COST: NearToken = NearToken::from_yoctonear(2_500_000_000_000_000_000_000);

/// Gas for the ft_on_transfer call inside ft_transfer_call.
const GAS_FOR_FT_ON_TRANSFER: Gas = Gas::from_tgas(30);
/// Gas for the ft_resolve_transfer callback.
const GAS_FOR_RESOLVE_TRANSFER: Gas = Gas::from_tgas(10);

/// NEP-145 storage balance, as the standard returns it.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

/// NEP-145 storage balance bounds.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StorageBalanceBounds {
    pub min: U128,
    pub max: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct FtTestToken {
    owner_id: AccountId,
    total_supply: u128,
    balances: LookupMap<AccountId, u128>,
    /// NEAR actually deposited for storage, per account. The owner
    /// is credited at init without a deposit, so its entry is
    /// absent and storage_balance_of honestly reports 0 for it.
    deposits: LookupMap<AccountId, u128>,
}

#[near]
impl FtTestToken {
    #[init]
    pub fn init(owner_id: AccountId, total_supply: U128) -> Self {
        let mut balances = LookupMap::new(b"b");
        balances.insert(owner_id.clone(), total_supply.0);
        let deposits = LookupMap::new(b"d");
        Self {
            owner_id,
            total_supply: total_supply.0,
            balances,
            deposits,
        }
    }

    /// Total supply, fixed at init. There is no mint after init.
    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    /// Balance of an account, zero when the account is unregistered.
    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balance_of(&account_id))
    }

    /// NEP-141 transfer. The receiver must be registered first
    /// (storage_deposit), and the call carries exactly 1 yoctoNEAR.
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "Requires attached deposit of exactly 1 yoctoNEAR"
        );
        let _ = memo;
        let sender_id = env::predecessor_account_id();
        self.transfer(&sender_id, &receiver_id, amount.0);
    }

    /// NEP-141 transfer with a cross-contract call. The tokens move
    /// first, then the receiver's ft_on_transfer runs, then
    /// ft_resolve_transfer refunds whatever the receiver reports
    /// unused. A receiver that fails or returns garbage refunds the
    /// full amount: the safe direction is always the refund.
    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "Requires attached deposit of exactly 1 yoctoNEAR"
        );
        let _ = memo;
        let sender_id = env::predecessor_account_id();
        self.transfer(&sender_id, &receiver_id, amount.0);
        let on_transfer = Promise::new(receiver_id.clone()).function_call(
            "ft_on_transfer".to_string(),
            serde_json::to_vec(&serde_json::json!({
                "sender_id": sender_id,
                "amount": amount,
                "msg": msg,
            }))
            .unwrap(),
            NearToken::from_yoctonear(0),
            GAS_FOR_FT_ON_TRANSFER,
        );
        let resolve = Promise::new(env::current_account_id()).function_call(
            "ft_resolve_transfer".to_string(),
            serde_json::to_vec(&serde_json::json!({
                "sender_id": sender_id,
                "receiver_id": receiver_id,
                "amount": amount,
            }))
            .unwrap(),
            NearToken::from_yoctonear(0),
            GAS_FOR_RESOLVE_TRANSFER,
        );
        PromiseOrValue::Promise(on_transfer.then(resolve))
    }

    /// Callback for ft_transfer_call. Only this contract calls it.
    /// The unused amount is the U128 the receiver returned, capped
    /// at the transferred amount; a failed call or an unparsable
    /// return refunds everything. The refund itself is capped at
    /// the receiver's current balance: the receiver may have spent
    /// part of the transfer before this callback runs, and a refund
    /// larger than the balance would panic instead of refunding
    /// what is available. Whatever cannot be refunded counts as
    /// used. Returns the used amount.
    #[private]
    pub fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        // promise_result_checked bounds the return size: a receiver
        // returning more than a kilobyte arrives as Err(TooLong),
        // which refunds the full amount, instead of burning gas on
        // a huge read. A failed call arrives as Err(Failed) the
        // same way.
        let unused = match env::promise_result_checked(0, 1024) {
            Ok(bytes) => serde_json::from_slice::<U128>(&bytes)
                .map(|v| v.0)
                .unwrap_or(amount.0),
            Err(_) => amount.0,
        };
        let unused = unused.min(amount.0);
        let refund = unused.min(self.balance_of(&receiver_id));
        if refund > 0 {
            self.transfer(&receiver_id, &sender_id, refund);
        }
        U128(amount.0 - refund)
    }

    /// NEP-145 registration. A new account costs STORAGE_COST, the
    /// excess deposit is refunded, and an already registered account
    /// gets its whole deposit back. `registration_only` is accepted
    /// and ignored: min and max are both STORAGE_COST, so there is
    /// nothing partial to register.
    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        let account_id = account_id.unwrap_or_else(env::predecessor_account_id);
        let attached = env::attached_deposit();
        let _ = registration_only;
        if self.balances.contains_key(&account_id) {
            if attached.as_yoctonear() > 0 {
                // Dropping a Promise still schedules it (near-sdk
                // constructs the batch on drop), so the refund lands.
                // The let binding only silences the must-use lint.
                let _ = Promise::new(env::predecessor_account_id()).transfer(attached);
            }
            return self.storage_balance(&account_id);
        }
        require!(
            attached >= STORAGE_COST,
            "Insufficient deposit to register an account"
        );
        self.balances.insert(account_id.clone(), 0);
        self.deposits
            .insert(account_id.clone(), STORAGE_COST.as_yoctonear());
        let excess = attached.as_yoctonear() - STORAGE_COST.as_yoctonear();
        if excess > 0 {
            // See above: dropping the Promise still schedules the refund.
            let _ = Promise::new(env::predecessor_account_id())
                .transfer(NearToken::from_yoctonear(excess));
        }
        self.storage_balance(&account_id)
    }

    /// NEP-145 balance query. None when the account is unregistered.
    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        if self.balances.contains_key(&account_id) {
            Some(self.storage_balance(&account_id))
        } else {
            None
        }
    }

    /// NEP-145 bounds. Registration costs exactly STORAGE_COST.
    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds {
            min: U128(STORAGE_COST.as_yoctonear()),
            max: U128(STORAGE_COST.as_yoctonear()),
        }
    }

    fn balance_of(&self, account_id: &AccountId) -> u128 {
        self.balances.get(account_id).copied().unwrap_or(0)
    }

    fn storage_balance(&self, account_id: &AccountId) -> StorageBalance {
        // Report what the account actually deposited. The owner was
        // credited at init without a deposit, so it reports 0: its
        // storage is staked from the contract's own balance.
        StorageBalance {
            total: U128(self.deposits.get(account_id).copied().unwrap_or(0)),
            available: U128(0),
        }
    }

    fn transfer(&mut self, sender_id: &AccountId, receiver_id: &AccountId, amount: u128) {
        require!(
            self.balances.contains_key(receiver_id),
            "The receiver account is not registered"
        );
        require!(
            self.balances.contains_key(sender_id),
            "The sender account is not registered"
        );
        let sender_balance = self.balance_of(sender_id);
        require!(sender_balance >= amount, "Insufficient balance");
        if sender_id == receiver_id {
            // A self-transfer moves nothing. Without this, the
            // sender and receiver writes below would alias the same
            // balance entry and the final write would mint `amount`
            // from nothing.
            return;
        }
        let new_sender = sender_balance
            .checked_sub(amount)
            .unwrap_or_else(|| env::panic_str("Insufficient balance"));
        let new_receiver = self
            .balance_of(receiver_id)
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("Balance overflow"));
        self.balances.insert(sender_id.clone(), new_sender);
        self.balances.insert(receiver_id.clone(), new_receiver);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::{AccountId, PromiseResult, testing_env};
    use std::collections::HashMap;

    fn owner() -> AccountId {
        accounts(0)
    }

    fn other() -> AccountId {
        accounts(1)
    }

    fn setup() -> FtTestToken {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        testing_env!(ctx.build());
        FtTestToken::init(owner(), U128(1_000_000))
    }

    #[test]
    fn init_credits_the_owner_with_the_whole_supply() {
        let token = setup();
        assert_eq!(token.ft_total_supply(), U128(1_000_000));
        assert_eq!(token.ft_balance_of(owner()), U128(1_000_000));
        assert_eq!(token.ft_balance_of(other()), U128(0));
    }

    #[test]
    fn storage_deposit_registers_and_reports_the_balance() {
        let mut token = setup();
        assert_eq!(token.storage_balance_of(other()), None);
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(other());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.attached_deposit(STORAGE_COST);
        testing_env!(ctx.build());
        let balance = token.storage_deposit(Some(other()), None);
        assert_eq!(balance.total, U128(STORAGE_COST.as_yoctonear()));
        assert_eq!(token.storage_balance_of(other()), Some(balance));
    }

    #[test]
    #[should_panic(expected = "The sender account is not registered")]
    fn ft_transfer_refuses_an_unregistered_sender() {
        let mut token = setup();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(other());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(ctx.build());
        // A zero-amount transfer from an unregistered sender used
        // to pass 0 >= 0 and create a free registration entry.
        token.ft_transfer(owner(), U128(0), None);
    }

    #[test]
    fn ft_resolve_transfer_refunds_everything_on_a_failed_call() {
        let mut token = setup();
        register_and_fund_other(&mut token);
        resolve_context(PromiseResult::Failed);
        let used = token.ft_resolve_transfer(owner(), other(), U128(400_000));
        assert_eq!(used, U128(0));
        assert_eq!(token.ft_balance_of(owner()), U128(1_000_000));
        assert_eq!(token.ft_balance_of(other()), U128(0));
    }

    #[test]
    fn ft_resolve_transfer_refunds_everything_on_a_garbage_return() {
        let mut token = setup();
        register_and_fund_other(&mut token);
        resolve_context(PromiseResult::Successful(b"not-a-u128".to_vec()));
        let used = token.ft_resolve_transfer(owner(), other(), U128(400_000));
        assert_eq!(used, U128(0));
        assert_eq!(token.ft_balance_of(owner()), U128(1_000_000));
        assert_eq!(token.ft_balance_of(other()), U128(0));
    }

    #[test]
    fn ft_resolve_transfer_refunds_everything_on_an_oversize_return() {
        let mut token = setup();
        register_and_fund_other(&mut token);
        // Over the 1024-byte bound, so promise_result_checked
        // returns Err(TooLong) and the full amount is refunded.
        resolve_context(PromiseResult::Successful(vec![b'x'; 2048]));
        let used = token.ft_resolve_transfer(owner(), other(), U128(400_000));
        assert_eq!(used, U128(0));
        assert_eq!(token.ft_balance_of(owner()), U128(1_000_000));
        assert_eq!(token.ft_balance_of(other()), U128(0));
    }

    #[test]
    fn ft_transfer_to_self_moves_nothing_and_mints_nothing() {
        let mut token = setup();
        register_and_fund_other(&mut token);
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(other());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(ctx.build());
        token.ft_transfer(other(), U128(100_000), None);
        assert_eq!(token.ft_balance_of(owner()), U128(600_000));
        assert_eq!(token.ft_balance_of(other()), U128(400_000));
        assert_eq!(token.ft_total_supply(), U128(1_000_000));
    }

    #[test]
    fn storage_balance_of_reports_what_was_actually_deposited() {
        let mut token = setup();
        // The owner was credited at init without a deposit, so it
        // reports 0, not the registration cost.
        assert_eq!(
            token.storage_balance_of(owner()),
            Some(StorageBalance { total: U128(0), available: U128(0) })
        );
        register_and_fund_other(&mut token);
        assert_eq!(
            token.storage_balance_of(other()),
            Some(StorageBalance {
                total: U128(STORAGE_COST.as_yoctonear()),
                available: U128(0)
            })
        );
    }

    #[test]
    fn ft_transfer_moves_balance_between_registered_accounts() {
        let mut token = setup();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(other());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.attached_deposit(STORAGE_COST);
        testing_env!(ctx.build());
        token.storage_deposit(Some(other()), None);
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(ctx.build());
        token.ft_transfer(other(), U128(400_000), None);
        assert_eq!(token.ft_balance_of(owner()), U128(600_000));
        assert_eq!(token.ft_balance_of(other()), U128(400_000));
    }

    #[test]
    #[should_panic(expected = "The receiver account is not registered")]
    fn ft_transfer_refuses_an_unregistered_receiver() {
        let mut token = setup();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(ctx.build());
        token.ft_transfer(other(), U128(1), None);
    }

    fn resolve_context(promise_result: PromiseResult) {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        testing_env!(
            ctx.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            HashMap::default(),
            vec![promise_result],
        );
    }

    fn register_and_fund_other(token: &mut FtTestToken) {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(other());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.attached_deposit(STORAGE_COST);
        testing_env!(ctx.build());
        token.storage_deposit(Some(other()), None);
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(ctx.build());
        token.ft_transfer(other(), U128(400_000), None);
    }

    #[test]
    fn ft_resolve_transfer_refunds_what_the_receiver_reports_unused() {
        let mut token = setup();
        register_and_fund_other(&mut token);
        resolve_context(PromiseResult::Successful(
            serde_json::to_vec(&U128(150_000)).unwrap(),
        ));
        let used = token.ft_resolve_transfer(owner(), other(), U128(400_000));
        assert_eq!(used, U128(250_000));
        assert_eq!(token.ft_balance_of(owner()), U128(750_000));
        assert_eq!(token.ft_balance_of(other()), U128(250_000));
    }

    #[test]
    fn ft_resolve_transfer_caps_the_refund_at_the_receivers_balance() {
        let mut token = setup();
        register_and_fund_other(&mut token);
        // The receiver spent 300,000 of the 400,000 before the
        // callback runs, then reports the whole 400,000 unused.
        // A refund of the full amount would panic; the callback
        // refunds the 100,000 still held and counts the rest used.
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(other());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(ctx.build());
        token.ft_transfer(owner(), U128(300_000), None);
        resolve_context(PromiseResult::Successful(
            serde_json::to_vec(&U128(400_000)).unwrap(),
        ));
        let used = token.ft_resolve_transfer(owner(), other(), U128(400_000));
        assert_eq!(used, U128(300_000));
        assert_eq!(token.ft_balance_of(owner()), U128(1_000_000));
        assert_eq!(token.ft_balance_of(other()), U128(0));
    }

    #[test]
    #[should_panic(expected = "Insufficient balance")]
    fn ft_transfer_refuses_more_than_the_sender_holds() {
        let mut token = setup();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(other());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.attached_deposit(STORAGE_COST);
        testing_env!(ctx.build());
        token.storage_deposit(Some(other()), None);
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("ft-test-token.test.near".parse().unwrap());
        ctx.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(ctx.build());
        token.ft_transfer(other(), U128(1_000_001), None);
    }
}
