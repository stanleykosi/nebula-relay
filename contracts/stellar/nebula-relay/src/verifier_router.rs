use soroban_sdk::{contractclient, contracterror, Bytes, BytesN, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    InvalidProof = 0,
    MalformedPublicInputs = 1,
    MalformedSeal = 2,
    InvalidSelector = 3,
    AlreadyInitialized = 4,
    SelectorRemoved = 5,
    SelectorInUse = 6,
    SelectorUnknown = 7,
}

#[contractclient(name = "RiscZeroVerifierRouterClient")]
#[allow(dead_code)]
pub trait RiscZeroVerifierRouterInterface {
    fn verify(
        env: Env,
        seal: Bytes,
        image_id: BytesN<32>,
        journal: BytesN<32>,
    ) -> Result<(), VerifierError>;
}
