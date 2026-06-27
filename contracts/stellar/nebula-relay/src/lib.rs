#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env,
};

#[cfg(test)]
mod test;
mod verifier_router;

use verifier_router::RiscZeroVerifierRouterClient;

const JOURNAL_LEN: u32 = 289;
#[cfg(feature = "dev-mock-verifier")]
const DEV_SEAL_PREFIX: &[u8; 18] = b"NEBULA_DEV_SEAL_V1";
const DEMO_DESTINATION_CHAIN_ID: u64 = 1_501;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    Paused = 4,
    InvalidImageId = 5,
    InvalidProof = 6,
    InvalidJournal = 7,
    InvalidDomain = 8,
    SourceNotRegistered = 9,
    SourceInactive = 10,
    AmountOutOfBounds = 11,
    ComplianceRootInvalid = 12,
    ReceiptRootUnknown = 13,
    ReceiptRootExpired = 14,
    NullifierAlreadyClaimed = 15,
    PoolAdapterFailed = 16,
    WrongDestination = 17,
    VerifierRouterFailed = 18,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceConfig {
    pub min_amount: i128,
    pub max_amount: i128,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComplianceRootConfig {
    pub expires_at_ledger: u32,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimReceipt {
    pub nullifier: BytesN<32>,
    pub note_commitment: BytesN<32>,
    pub amount: i128,
    pub event_commitment: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimRecord {
    pub claimant: Address,
    pub note_commitment: BytesN<32>,
    pub amount: i128,
    pub token: BytesN<20>,
    pub source_chain_id: u64,
    pub event_commitment: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NebulaJournalV1 {
    pub version: u32,
    pub domain: BytesN<32>,
    pub source_chain_id: u64,
    pub source_block_number: u64,
    pub source_receipt_root: BytesN<32>,
    pub escrow_contract: BytesN<20>,
    pub token: BytesN<20>,
    pub amount: i128,
    pub amount_bucket: u64,
    pub stellar_note_commitment: BytesN<32>,
    pub compliance_root: BytesN<32>,
    pub compliance_mode: u32,
    pub claim_nullifier: BytesN<32>,
    pub event_commitment: BytesN<32>,
    pub destination_chain_id: u64,
    pub expires_at_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    VerifierRouter,
    PoolAdapter,
    AcceptedImageId,
    Asset,
    NetworkDomain,
    Paused,
    DevMockVerifierEnabled,
    Source(u64, BytesN<20>, BytesN<20>),
    ComplianceRoot(BytesN<32>, u32),
    Claimed(BytesN<32>),
    Claim(BytesN<32>),
    Note(BytesN<32>),
}

#[contract]
pub struct NebulaRelay;

#[contractimpl]
impl NebulaRelay {
    pub fn initialize(
        env: Env,
        admin: Address,
        verifier_router: Address,
        pool_adapter: Address,
        accepted_image_id: BytesN<32>,
        asset: Address,
        network_domain: BytesN<32>,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VerifierRouter, &verifier_router);
        env.storage()
            .instance()
            .set(&DataKey::PoolAdapter, &pool_adapter);
        env.storage()
            .instance()
            .set(&DataKey::AcceptedImageId, &accepted_image_id);
        env.storage().instance().set(&DataKey::Asset, &asset);
        env.storage()
            .instance()
            .set(&DataKey::NetworkDomain, &network_domain);
        env.storage().instance().set(&DataKey::Paused, &false);
        #[cfg(feature = "dev-mock-verifier")]
        env.storage()
            .instance()
            .set(&DataKey::DevMockVerifierEnabled, &false);
        Ok(())
    }

    pub fn register_source(
        env: Env,
        admin: Address,
        source_chain_id: u64,
        escrow_contract: BytesN<20>,
        token: BytesN<20>,
        min_amount: i128,
        max_amount: i128,
        active: bool,
    ) -> Result<(), Error> {
        require_admin(&env, &admin)?;
        if min_amount <= 0 || max_amount < min_amount {
            return Err(Error::AmountOutOfBounds);
        }
        env.storage().persistent().set(
            &DataKey::Source(source_chain_id, escrow_contract, token),
            &SourceConfig {
                min_amount,
                max_amount,
                active,
            },
        );
        Ok(())
    }

    pub fn register_compliance_root(
        env: Env,
        admin: Address,
        root: BytesN<32>,
        mode: u32,
        expires_at_ledger: u32,
        active: bool,
    ) -> Result<(), Error> {
        require_admin(&env, &admin)?;
        env.storage().persistent().set(
            &DataKey::ComplianceRoot(root, mode),
            &ComplianceRootConfig {
                expires_at_ledger,
                active,
            },
        );
        Ok(())
    }

    pub fn claim(
        env: Env,
        claimant: Address,
        seal: Bytes,
        image_id: BytesN<32>,
        journal: Bytes,
        _pool_payload: Bytes,
    ) -> Result<ClaimReceipt, Error> {
        claimant.require_auth();
        if is_paused(&env)? {
            return Err(Error::Paused);
        }

        verify_proof(&env, &seal, &image_id, &journal)?;
        let decoded = decode_journal(&env, &journal)?;
        validate_journal(&env, &decoded)?;

        if Self::is_claimed(env.clone(), decoded.claim_nullifier.clone()) {
            return Err(Error::NullifierAlreadyClaimed);
        }

        let record = ClaimRecord {
            claimant,
            note_commitment: decoded.stellar_note_commitment.clone(),
            amount: decoded.amount,
            token: decoded.token.clone(),
            source_chain_id: decoded.source_chain_id,
            event_commitment: decoded.event_commitment.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Claimed(decoded.claim_nullifier.clone()), &true);
        env.storage()
            .persistent()
            .set(&DataKey::Claim(decoded.claim_nullifier.clone()), &record);
        env.storage().persistent().set(
            &DataKey::Note(decoded.stellar_note_commitment.clone()),
            &record,
        );

        Ok(ClaimReceipt {
            nullifier: decoded.claim_nullifier,
            note_commitment: decoded.stellar_note_commitment,
            amount: decoded.amount,
            event_commitment: decoded.event_commitment,
        })
    }

    pub fn is_claimed(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Claimed(nullifier))
            .unwrap_or(false)
    }

    pub fn get_claim(env: Env, nullifier: BytesN<32>) -> Option<ClaimRecord> {
        env.storage().persistent().get(&DataKey::Claim(nullifier))
    }

    pub fn get_source(
        env: Env,
        source_chain_id: u64,
        escrow_contract: BytesN<20>,
        token: BytesN<20>,
    ) -> Option<SourceConfig> {
        env.storage()
            .persistent()
            .get(&DataKey::Source(source_chain_id, escrow_contract, token))
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    #[cfg(feature = "dev-mock-verifier")]
    pub fn set_dev_mock_verifier(env: Env, admin: Address, enabled: bool) -> Result<(), Error> {
        require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::DevMockVerifierEnabled, &enabled);
        Ok(())
    }
}

fn require_admin(env: &Env, provided: &Address) -> Result<(), Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;
    if admin != *provided {
        return Err(Error::Unauthorized);
    }
    provided.require_auth();
    Ok(())
}

fn is_paused(env: &Env) -> Result<bool, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .ok_or(Error::NotInitialized)
}

fn verify_proof(
    env: &Env,
    seal: &Bytes,
    image_id: &BytesN<32>,
    journal: &Bytes,
) -> Result<(), Error> {
    let accepted: BytesN<32> = env
        .storage()
        .instance()
        .get(&DataKey::AcceptedImageId)
        .ok_or(Error::NotInitialized)?;
    if *image_id != accepted {
        return Err(Error::InvalidImageId);
    }

    let journal_digest: BytesN<32> = env.crypto().sha256(journal).into();

    #[cfg(feature = "dev-mock-verifier")]
    {
        let dev_enabled = env
            .storage()
            .instance()
            .get(&DataKey::DevMockVerifierEnabled)
            .unwrap_or(false);
        if dev_enabled {
            return verify_dev_mock(env, seal, &journal_digest);
        }
    }

    let router_address: Address = env
        .storage()
        .instance()
        .get(&DataKey::VerifierRouter)
        .ok_or(Error::NotInitialized)?;
    let router = RiscZeroVerifierRouterClient::new(env, &router_address);
    router.verify(seal, image_id, &journal_digest);
    Ok(())
}

#[cfg(feature = "dev-mock-verifier")]
fn verify_dev_mock(env: &Env, seal: &Bytes, journal_digest: &BytesN<32>) -> Result<(), Error> {
    let prefix_len = DEV_SEAL_PREFIX.len() as u32;
    if seal.len() != prefix_len + 32 {
        return Err(Error::InvalidProof);
    }
    let expected_prefix = Bytes::from_array(env, DEV_SEAL_PREFIX);
    if seal.slice(0..prefix_len) != expected_prefix {
        return Err(Error::InvalidProof);
    }
    let seal_digest: BytesN<32> = seal
        .slice(prefix_len..prefix_len + 32)
        .try_into()
        .map_err(|_| Error::InvalidProof)?;
    if seal_digest != *journal_digest {
        return Err(Error::InvalidProof);
    }
    Ok(())
}

fn validate_journal(env: &Env, journal: &NebulaJournalV1) -> Result<(), Error> {
    let domain: BytesN<32> = env
        .storage()
        .instance()
        .get(&DataKey::NetworkDomain)
        .ok_or(Error::NotInitialized)?;
    if journal.domain != domain {
        return Err(Error::InvalidDomain);
    }
    if journal.destination_chain_id != DEMO_DESTINATION_CHAIN_ID {
        return Err(Error::WrongDestination);
    }

    let source_key = DataKey::Source(
        journal.source_chain_id,
        journal.escrow_contract.clone(),
        journal.token.clone(),
    );
    let source: SourceConfig = env
        .storage()
        .persistent()
        .get(&source_key)
        .ok_or(Error::SourceNotRegistered)?;
    if !source.active {
        return Err(Error::SourceInactive);
    }
    if journal.amount < source.min_amount || journal.amount > source.max_amount {
        return Err(Error::AmountOutOfBounds);
    }

    let root: ComplianceRootConfig = env
        .storage()
        .persistent()
        .get(&DataKey::ComplianceRoot(
            journal.compliance_root.clone(),
            journal.compliance_mode,
        ))
        .ok_or(Error::ComplianceRootInvalid)?;
    if !root.active {
        return Err(Error::ComplianceRootInvalid);
    }
    if root.expires_at_ledger < env.ledger().sequence() {
        return Err(Error::ReceiptRootExpired);
    }
    if journal.expires_at_ledger < env.ledger().sequence() {
        return Err(Error::ReceiptRootExpired);
    }
    Ok(())
}

fn decode_journal(_env: &Env, journal: &Bytes) -> Result<NebulaJournalV1, Error> {
    if journal.len() != JOURNAL_LEN {
        return Err(Error::InvalidJournal);
    }
    let version = read_u32(journal, 0)?;
    if version != 1 {
        return Err(Error::InvalidJournal);
    }
    let amount = read_u128(journal, 124)?;
    if amount > i128::MAX as u128 {
        return Err(Error::InvalidJournal);
    }
    Ok(NebulaJournalV1 {
        version,
        domain: read_n(journal, 4)?,
        source_chain_id: read_u64(journal, 36)?,
        source_block_number: read_u64(journal, 44)?,
        source_receipt_root: read_n(journal, 52)?,
        escrow_contract: read_n(journal, 84)?,
        token: read_n(journal, 104)?,
        amount: amount as i128,
        amount_bucket: read_u64(journal, 140)?,
        stellar_note_commitment: read_n(journal, 148)?,
        compliance_root: read_n(journal, 180)?,
        compliance_mode: read_u8(journal, 212)? as u32,
        claim_nullifier: read_n(journal, 213)?,
        event_commitment: read_n(journal, 245)?,
        destination_chain_id: read_u64(journal, 277)?,
        expires_at_ledger: read_u32(journal, 285)?,
    })
}

fn read_n<const N: usize>(bytes: &Bytes, offset: u32) -> Result<BytesN<N>, Error> {
    bytes
        .slice(offset..offset + N as u32)
        .try_into()
        .map_err(|_| Error::InvalidJournal)
}

fn read_u8(bytes: &Bytes, offset: u32) -> Result<u8, Error> {
    bytes.get(offset).ok_or(Error::InvalidJournal)
}

fn read_u32(bytes: &Bytes, offset: u32) -> Result<u32, Error> {
    Ok(u32::from_be_bytes(read_n::<4>(bytes, offset)?.to_array()))
}

fn read_u64(bytes: &Bytes, offset: u32) -> Result<u64, Error> {
    Ok(u64::from_be_bytes(read_n::<8>(bytes, offset)?.to_array()))
}

fn read_u128(bytes: &Bytes, offset: u32) -> Result<u128, Error> {
    Ok(u128::from_be_bytes(read_n::<16>(bytes, offset)?.to_array()))
}
