use soroban_sdk::{contractclient, contracterror, Bytes, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CctpForwarderError {
    Rejected = 1,
}

#[contractclient(name = "CctpForwarderClient")]
#[allow(dead_code)]
pub trait CctpForwarderInterface {
    fn mint_and_forward(
        env: Env,
        message: Bytes,
        attestation: Bytes,
    ) -> Result<(), CctpForwarderError>;
}
