use soroban_sdk::{contractclient, contracterror, Address, Bytes, BytesN, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolAdapterError {
    NotRelay = 1,
    InvalidHandoff = 2,
    Rejected = 3,
}

#[contractclient(name = "NebulaPoolAdapterClient")]
#[allow(dead_code)]
pub trait NebulaPoolAdapterInterface {
    fn credit_note_from_relay(
        env: Env,
        relay: Address,
        claimant: Address,
        note_commitment: BytesN<32>,
        amount: i128,
        asset: Address,
        nullifier: BytesN<32>,
        event_commitment: BytesN<32>,
        pool_payload: Bytes,
    ) -> Result<(), PoolAdapterError>;
}
