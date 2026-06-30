#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env,
};

#[cfg(test)]
mod test;

const MAX_POOL_PAYLOAD_LEN: u32 = 4096;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolAdapterError {
    NotRelay = 1,
    InvalidHandoff = 2,
    Rejected = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreditRecord {
    pub relay: Address,
    pub claimant: Address,
    pub note_commitment: BytesN<32>,
    pub amount: i128,
    pub asset: Address,
    pub nullifier: BytesN<32>,
    pub event_commitment: BytesN<32>,
    pub payload_hash: BytesN<32>,
    pub payload_len: u32,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    Relay,
    CreditByNullifier(BytesN<32>),
    CreditByNote(BytesN<32>),
}

#[contract]
pub struct NebulaPoolAdapter;

#[contractimpl]
impl NebulaPoolAdapter {
    pub fn initialize(env: Env, admin: Address) -> Result<(), PoolAdapterError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(PoolAdapterError::Rejected);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    pub fn set_relay(env: Env, admin: Address, relay: Address) -> Result<(), PoolAdapterError> {
        require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Relay, &relay);
        Ok(())
    }

    pub fn credit_note_from_relay(
        env: Env,
        relay: Address,
        claimant: Address,
        note_commitment: BytesN<32>,
        amount: i128,
        asset: Address,
        nullifier: BytesN<32>,
        event_commitment: BytesN<32>,
        pool_payload: Bytes,
    ) -> Result<(), PoolAdapterError> {
        let expected_relay: Address = env
            .storage()
            .instance()
            .get(&DataKey::Relay)
            .ok_or(PoolAdapterError::NotRelay)?;
        if relay != expected_relay {
            return Err(PoolAdapterError::NotRelay);
        }
        expected_relay.require_auth();
        if amount <= 0
            || pool_payload.len() > MAX_POOL_PAYLOAD_LEN
            || is_zero_bytes(&env, &note_commitment)
            || is_zero_bytes(&env, &nullifier)
            || is_zero_bytes(&env, &event_commitment)
        {
            return Err(PoolAdapterError::InvalidHandoff);
        }

        let nullifier_key = DataKey::CreditByNullifier(nullifier.clone());
        let note_key = DataKey::CreditByNote(note_commitment.clone());
        if env.storage().persistent().has(&nullifier_key)
            || env.storage().persistent().has(&note_key)
        {
            return Err(PoolAdapterError::Rejected);
        }

        let payload_hash: BytesN<32> = env.crypto().sha256(&pool_payload).into();
        let record = CreditRecord {
            relay,
            claimant,
            note_commitment,
            amount,
            asset,
            nullifier,
            event_commitment,
            payload_hash,
            payload_len: pool_payload.len(),
            ledger: env.ledger().sequence(),
        };
        env.storage().persistent().set(&nullifier_key, &record);
        env.storage().persistent().set(&note_key, &record);
        env.storage().instance().extend_ttl(100, 518400);
        env.storage()
            .persistent()
            .extend_ttl(&nullifier_key, 100, 518400);
        env.storage()
            .persistent()
            .extend_ttl(&note_key, 100, 518400);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    pub fn get_relay(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Relay)
    }

    pub fn get_credit_by_nullifier(env: Env, nullifier: BytesN<32>) -> Option<CreditRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::CreditByNullifier(nullifier))
    }

    pub fn get_credit_by_note(env: Env, note_commitment: BytesN<32>) -> Option<CreditRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::CreditByNote(note_commitment))
    }

    pub fn is_credited(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::CreditByNullifier(nullifier))
    }
}

fn require_admin(env: &Env, provided: &Address) -> Result<(), PoolAdapterError> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(PoolAdapterError::Rejected)?;
    if admin != *provided {
        return Err(PoolAdapterError::Rejected);
    }
    provided.require_auth();
    Ok(())
}

fn is_zero_bytes<const N: usize>(env: &Env, value: &BytesN<N>) -> bool {
    *value == BytesN::from_array(env, &[0u8; N])
}
