use soroban_sdk::{
    contractclient, contracterror, contracttype,
    crypto::bn254::{Bn254G1Affine, Bn254G2Affine},
    Address, Bytes, BytesN, Env, Vec, I256, U256,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PrivatePoolError {
    NotAuthorized = 1,
    MerkleTreeFull = 2,
    AlreadyInitialized = 3,
    WrongLevels = 4,
    NextIndexNotEven = 5,
    WrongExtAmount = 6,
    InvalidProof = 7,
    UnknownRoot = 8,
    AlreadySpentNullifier = 9,
    WrongExtHash = 10,
    NotInitialized = 11,
    Overflow = 12,
    NonCanonicalPublicInput = 13,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Groth16Proof {
    pub a: Bn254G1Affine,
    pub b: Bn254G2Affine,
    pub c: Bn254G1Affine,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrivatePoolProof {
    pub proof: Groth16Proof,
    pub root: U256,
    pub input_nullifiers: Vec<U256>,
    pub output_commitment0: U256,
    pub output_commitment1: U256,
    pub public_amount: U256,
    pub ext_data_hash: BytesN<32>,
    pub asp_membership_root: U256,
    pub asp_non_membership_root: U256,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrivatePoolExtData {
    pub recipient: Address,
    pub ext_amount: I256,
    pub encrypted_output0: Bytes,
    pub encrypted_output1: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrivatePoolDeposit {
    pub proof: PrivatePoolProof,
    pub ext_data: PrivatePoolExtData,
}

#[allow(dead_code)]
#[contractclient(crate_path = "soroban_sdk", name = "PrivatePoolClient")]
pub trait PrivatePoolInterface {
    fn transact(
        env: Env,
        proof: PrivatePoolProof,
        ext_data: PrivatePoolExtData,
        sender: Address,
    ) -> Result<(), PrivatePoolError>;
}
