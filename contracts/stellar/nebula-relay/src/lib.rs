#![no_std]

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractimpl, contracttype, vec, Address, Bytes, BytesN, Env, IntoVal,
    Symbol, I256, U256,
};

mod cctp_forwarder;
mod private_pool;
#[cfg(test)]
mod test;
mod verifier_router;

use cctp_forwarder::CctpForwarderClient;
use private_pool::{PrivatePoolClient, PrivatePoolDeposit};
use verifier_router::RiscZeroVerifierRouterClient;

const JOURNAL_LEN: u32 = 465;
const JOURNAL_VERSION: u32 = 2;
const MAX_COMPLIANCE_MODE: u32 = 2;
const STELLAR_TESTNET_CHAIN_ID: u64 = 1501;
const CCTP_STELLAR_DOMAIN: u32 = 27;

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
    WrongDestination = 17,
    VerifierRouterFailed = 18,
    InvalidConfig = 19,
    CctpSettlementFailed = 20,
    InvalidCctpSettlement = 21,
    PrivatePoolNotConfigured = 22,
    PrivatePoolFailed = 23,
    InvalidPrivatePoolDeposit = 24,
    InvalidSettlementAmount = 25,
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
pub struct PrivateClaimReceipt {
    pub nullifier: BytesN<32>,
    pub note_commitment: BytesN<32>,
    pub amount: i128,
    pub settlement_amount: i128,
    pub settlement_amount_bucket: u64,
    pub private_pool: Address,
    pub event_commitment: BytesN<32>,
    pub cctp_message_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrivateClaimRecord {
    pub note_commitment: BytesN<32>,
    pub amount: i128,
    pub settlement_amount: i128,
    pub amount_bucket: u64,
    pub settlement_amount_bucket: u64,
    pub token: BytesN<20>,
    pub source_chain_id: u64,
    pub event_commitment: BytesN<32>,
    pub cctp_message_hash: BytesN<32>,
    pub cctp_attestation_hash: BytesN<32>,
    pub private_pool: Address,
    pub pool_output_commitment0: U256,
    pub pool_output_commitment1: U256,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NebulaJournalV2 {
    pub version: u32,
    pub domain: BytesN<32>,
    pub source_chain_id: u64,
    pub source_block_number: u64,
    pub source_receipt_root: BytesN<32>,
    pub escrow_contract: BytesN<20>,
    pub token: BytesN<20>,
    pub amount: i128,
    pub amount_bucket: u64,
    pub settlement_amount: i128,
    pub settlement_amount_bucket: u64,
    pub stellar_note_commitment: BytesN<32>,
    pub compliance_root: BytesN<32>,
    pub compliance_mode: u32,
    pub claim_nullifier: BytesN<32>,
    pub event_commitment: BytesN<32>,
    pub destination_chain_id: u64,
    pub expires_at_ledger: u32,
    pub cctp_source_domain: u32,
    pub cctp_destination_domain: u32,
    pub cctp_nonce: BytesN<32>,
    pub cctp_message_hash: BytesN<32>,
    pub cctp_attestation_hash: BytesN<32>,
    pub cctp_mint_recipient: BytesN<32>,
    pub cctp_fee_executed: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    VerifierRouter,
    PrivatePool,
    CctpForwarder,
    CctpMintRecipient,
    AcceptedImageId,
    Asset,
    NetworkDomain,
    Paused,
    Source(u64, BytesN<20>, BytesN<20>),
    ComplianceRoot(BytesN<32>, u32),
    Claimed(BytesN<32>),
    PrivateClaim(BytesN<32>),
    PrivateNote(BytesN<32>),
}

#[contract]
pub struct NebulaRelay;

#[contractimpl]
impl NebulaRelay {
    pub fn initialize(
        env: Env,
        admin: Address,
        verifier_router: Address,
        cctp_forwarder: Address,
        cctp_mint_recipient: BytesN<32>,
        accepted_image_id: BytesN<32>,
        asset: Address,
        network_domain: BytesN<32>,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        if is_zero_bytes(&env, &accepted_image_id) {
            return Err(Error::InvalidImageId);
        }
        if is_zero_bytes(&env, &network_domain) {
            return Err(Error::InvalidDomain);
        }
        if is_zero_bytes(&env, &cctp_mint_recipient) {
            return Err(Error::InvalidCctpSettlement);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VerifierRouter, &verifier_router);
        env.storage()
            .instance()
            .set(&DataKey::CctpForwarder, &cctp_forwarder);
        env.storage()
            .instance()
            .set(&DataKey::CctpMintRecipient, &cctp_mint_recipient);
        env.storage()
            .instance()
            .set(&DataKey::AcceptedImageId, &accepted_image_id);
        env.storage().instance().set(&DataKey::Asset, &asset);
        env.storage()
            .instance()
            .set(&DataKey::NetworkDomain, &network_domain);
        env.storage().instance().set(&DataKey::Paused, &false);
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
        if source_chain_id == 0
            || is_zero_bytes(&env, &escrow_contract)
            || is_zero_bytes(&env, &token)
        {
            return Err(Error::InvalidConfig);
        }
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
        if is_zero_bytes(&env, &root) || mode > MAX_COMPLIANCE_MODE {
            return Err(Error::ComplianceRootInvalid);
        }
        if active && expires_at_ledger <= env.ledger().sequence() {
            return Err(Error::ReceiptRootExpired);
        }
        env.storage().persistent().set(
            &DataKey::ComplianceRoot(root, mode),
            &ComplianceRootConfig {
                expires_at_ledger,
                active,
            },
        );
        Ok(())
    }

    pub fn claim_to_private_pool(
        env: Env,
        seal: Bytes,
        image_id: BytesN<32>,
        journal: Bytes,
        cctp_message: Bytes,
        cctp_attestation: Bytes,
        private_deposit: PrivatePoolDeposit,
    ) -> Result<PrivateClaimReceipt, Error> {
        if is_paused(&env)? {
            return Err(Error::Paused);
        }

        verify_proof(&env, &seal, &image_id, &journal)?;
        let decoded = decode_journal(&env, &journal)?;
        validate_journal(&env, &decoded)?;

        if Self::is_claimed(env.clone(), decoded.claim_nullifier.clone()) {
            return Err(Error::NullifierAlreadyClaimed);
        }

        validate_private_pool_deposit(&env, &decoded, &private_deposit)?;
        settle_cctp(&env, &decoded, &cctp_message, &cctp_attestation)?;
        deposit_private_pool(&env, &decoded, &private_deposit)?;

        let private_pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::PrivatePool)
            .ok_or(Error::PrivatePoolNotConfigured)?;
        let record = PrivateClaimRecord {
            note_commitment: decoded.stellar_note_commitment.clone(),
            amount: decoded.amount,
            settlement_amount: decoded.settlement_amount,
            amount_bucket: decoded.amount_bucket,
            settlement_amount_bucket: decoded.settlement_amount_bucket,
            token: decoded.token.clone(),
            source_chain_id: decoded.source_chain_id,
            event_commitment: decoded.event_commitment.clone(),
            cctp_message_hash: decoded.cctp_message_hash.clone(),
            cctp_attestation_hash: decoded.cctp_attestation_hash.clone(),
            private_pool: private_pool.clone(),
            pool_output_commitment0: private_deposit.proof.output_commitment0.clone(),
            pool_output_commitment1: private_deposit.proof.output_commitment1.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Claimed(decoded.claim_nullifier.clone()), &true);
        env.storage().persistent().set(
            &DataKey::PrivateClaim(decoded.claim_nullifier.clone()),
            &record,
        );
        env.storage().persistent().set(
            &DataKey::PrivateNote(decoded.stellar_note_commitment.clone()),
            &record,
        );

        Ok(PrivateClaimReceipt {
            nullifier: decoded.claim_nullifier,
            note_commitment: decoded.stellar_note_commitment,
            amount: decoded.amount,
            settlement_amount: decoded.settlement_amount,
            settlement_amount_bucket: decoded.settlement_amount_bucket,
            private_pool,
            event_commitment: decoded.event_commitment,
            cctp_message_hash: decoded.cctp_message_hash,
        })
    }

    pub fn is_claimed(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Claimed(nullifier))
            .unwrap_or(false)
    }

    pub fn get_private_claim(env: Env, nullifier: BytesN<32>) -> Option<PrivateClaimRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::PrivateClaim(nullifier))
    }

    pub fn get_private_note(env: Env, note_commitment: BytesN<32>) -> Option<PrivateClaimRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::PrivateNote(note_commitment))
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

    pub fn set_private_pool(env: Env, admin: Address, private_pool: Address) -> Result<(), Error> {
        require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::PrivatePool, &private_pool);
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

    let router_address: Address = env
        .storage()
        .instance()
        .get(&DataKey::VerifierRouter)
        .ok_or(Error::NotInitialized)?;
    let router = RiscZeroVerifierRouterClient::new(env, &router_address);
    router
        .try_verify(seal, image_id, &journal_digest)
        .map_err(|_| Error::InvalidProof)?
        .map_err(|_| Error::VerifierRouterFailed)?;
    Ok(())
}

fn validate_journal(env: &Env, journal: &NebulaJournalV2) -> Result<(), Error> {
    if journal.compliance_mode > MAX_COMPLIANCE_MODE
        || is_zero_bytes(env, &journal.source_receipt_root)
        || is_zero_bytes(env, &journal.stellar_note_commitment)
        || is_zero_bytes(env, &journal.claim_nullifier)
        || is_zero_bytes(env, &journal.event_commitment)
        || is_zero_bytes(env, &journal.cctp_nonce)
        || is_zero_bytes(env, &journal.cctp_message_hash)
        || is_zero_bytes(env, &journal.cctp_attestation_hash)
        || is_zero_bytes(env, &journal.cctp_mint_recipient)
    {
        return Err(Error::InvalidJournal);
    }
    if journal.cctp_destination_domain != CCTP_STELLAR_DOMAIN {
        return Err(Error::InvalidCctpSettlement);
    }
    let expected_mint_recipient: BytesN<32> = env
        .storage()
        .instance()
        .get(&DataKey::CctpMintRecipient)
        .ok_or(Error::NotInitialized)?;
    if journal.cctp_mint_recipient != expected_mint_recipient {
        return Err(Error::InvalidCctpSettlement);
    }
    if journal.amount <= 0 {
        return Err(Error::AmountOutOfBounds);
    }
    let expected_bucket = journal.amount / 1_000_000;
    if expected_bucket > u64::MAX as i128 || journal.amount_bucket != expected_bucket as u64 {
        return Err(Error::InvalidJournal);
    }
    if journal.cctp_fee_executed < 0
        || journal.settlement_amount <= 0
        || journal.settlement_amount > journal.amount
    {
        return Err(Error::InvalidSettlementAmount);
    }
    if journal.amount - journal.cctp_fee_executed != journal.settlement_amount {
        return Err(Error::InvalidSettlementAmount);
    }
    let expected_settlement_bucket = journal.settlement_amount / 1_000_000;
    if expected_settlement_bucket > u64::MAX as i128
        || journal.settlement_amount_bucket != expected_settlement_bucket as u64
    {
        return Err(Error::InvalidSettlementAmount);
    }

    let domain: BytesN<32> = env
        .storage()
        .instance()
        .get(&DataKey::NetworkDomain)
        .ok_or(Error::NotInitialized)?;
    if journal.domain != domain {
        return Err(Error::InvalidDomain);
    }
    if journal.destination_chain_id != STELLAR_TESTNET_CHAIN_ID {
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

fn settle_cctp(
    env: &Env,
    journal: &NebulaJournalV2,
    cctp_message: &Bytes,
    cctp_attestation: &Bytes,
) -> Result<(), Error> {
    if cctp_message.len() == 0 || cctp_attestation.len() == 0 {
        return Err(Error::InvalidCctpSettlement);
    }
    let message_hash: BytesN<32> = env.crypto().sha256(cctp_message).into();
    let attestation_hash: BytesN<32> = env.crypto().sha256(cctp_attestation).into();
    if message_hash != journal.cctp_message_hash
        || attestation_hash != journal.cctp_attestation_hash
    {
        return Err(Error::InvalidCctpSettlement);
    }

    let forwarder_address: Address = env
        .storage()
        .instance()
        .get(&DataKey::CctpForwarder)
        .ok_or(Error::NotInitialized)?;
    let forwarder = CctpForwarderClient::new(env, &forwarder_address);
    forwarder
        .try_mint_and_forward(cctp_message, cctp_attestation)
        .map_err(|_| Error::CctpSettlementFailed)?
        .map_err(|_| Error::CctpSettlementFailed)?;
    Ok(())
}

fn validate_private_pool_deposit(
    env: &Env,
    journal: &NebulaJournalV2,
    private_deposit: &PrivatePoolDeposit,
) -> Result<(), Error> {
    let private_pool: Address = env
        .storage()
        .instance()
        .get(&DataKey::PrivatePool)
        .ok_or(Error::PrivatePoolNotConfigured)?;
    if private_deposit.ext_data.recipient != private_pool {
        return Err(Error::InvalidPrivatePoolDeposit);
    }
    let ext_amount = private_deposit
        .ext_data
        .ext_amount
        .to_i128()
        .ok_or(Error::InvalidPrivatePoolDeposit)?;
    if ext_amount != journal.settlement_amount || ext_amount <= 0 {
        return Err(Error::InvalidPrivatePoolDeposit);
    }
    if private_deposit.proof.public_amount != u256_from_i128(env, journal.settlement_amount) {
        return Err(Error::InvalidPrivatePoolDeposit);
    }
    let zero = U256::from_u32(env, 0);
    if private_deposit.proof.output_commitment0 == zero
        && private_deposit.proof.output_commitment1 == zero
    {
        return Err(Error::InvalidPrivatePoolDeposit);
    }
    let output0 = u256_to_bytes32(env, &private_deposit.proof.output_commitment0);
    let output1 = u256_to_bytes32(env, &private_deposit.proof.output_commitment1);
    if journal.stellar_note_commitment != output0 && journal.stellar_note_commitment != output1 {
        return Err(Error::InvalidPrivatePoolDeposit);
    }
    if private_deposit.ext_data.encrypted_output0.len() == 0
        && private_deposit.ext_data.encrypted_output1.len() == 0
    {
        return Err(Error::InvalidPrivatePoolDeposit);
    }
    Ok(())
}

fn deposit_private_pool(
    env: &Env,
    journal: &NebulaJournalV2,
    private_deposit: &PrivatePoolDeposit,
) -> Result<(), Error> {
    let private_pool: Address = env
        .storage()
        .instance()
        .get(&DataKey::PrivatePool)
        .ok_or(Error::PrivatePoolNotConfigured)?;
    let asset: Address = env
        .storage()
        .instance()
        .get(&DataKey::Asset)
        .ok_or(Error::NotInitialized)?;
    let relay = env.current_contract_address();
    let pool = PrivatePoolClient::new(env, &private_pool);

    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: private_pool.clone(),
                fn_name: Symbol::new(env, "transact"),
                args: vec![
                    env,
                    private_deposit.proof.clone().into_val(env),
                    private_deposit.ext_data.clone().into_val(env),
                    relay.clone().into_val(env),
                ],
            },
            sub_invocations: vec![
                env,
                InvokerContractAuthEntry::Contract(SubContractInvocation {
                    context: ContractContext {
                        contract: asset,
                        fn_name: Symbol::new(env, "transfer"),
                        args: vec![
                            env,
                            relay.clone().into_val(env),
                            private_pool.clone().into_val(env),
                            journal.settlement_amount.into_val(env),
                        ],
                    },
                    sub_invocations: vec![env],
                }),
            ],
        }),
    ]);

    pool.try_transact(&private_deposit.proof, &private_deposit.ext_data, &relay)
        .map_err(|_| Error::PrivatePoolFailed)?
        .map_err(|_| Error::PrivatePoolFailed)?;
    Ok(())
}

fn u256_from_i128(env: &Env, amount: i128) -> U256 {
    U256::from_be_bytes(env, &I256::from_i128(env, amount).to_be_bytes())
}

fn u256_to_bytes32(env: &Env, value: &U256) -> BytesN<32> {
    let mut buf = [0u8; 32];
    value.to_be_bytes().copy_into_slice(&mut buf);
    BytesN::from_array(env, &buf)
}

fn decode_journal(_env: &Env, journal: &Bytes) -> Result<NebulaJournalV2, Error> {
    if journal.len() != JOURNAL_LEN {
        return Err(Error::InvalidJournal);
    }
    let version = read_u32(journal, 0)?;
    if version != JOURNAL_VERSION {
        return Err(Error::InvalidJournal);
    }
    let amount = read_u128(journal, 124)?;
    let settlement_amount = read_u128(journal, 148)?;
    let cctp_fee_executed = read_u128(journal, 449)?;
    if amount > i128::MAX as u128
        || settlement_amount > i128::MAX as u128
        || cctp_fee_executed > i128::MAX as u128
    {
        return Err(Error::InvalidJournal);
    }
    Ok(NebulaJournalV2 {
        version,
        domain: read_n(journal, 4)?,
        source_chain_id: read_u64(journal, 36)?,
        source_block_number: read_u64(journal, 44)?,
        source_receipt_root: read_n(journal, 52)?,
        escrow_contract: read_n(journal, 84)?,
        token: read_n(journal, 104)?,
        amount: amount as i128,
        amount_bucket: read_u64(journal, 140)?,
        settlement_amount: settlement_amount as i128,
        settlement_amount_bucket: read_u64(journal, 164)?,
        stellar_note_commitment: read_n(journal, 172)?,
        compliance_root: read_n(journal, 204)?,
        compliance_mode: read_u8(journal, 236)? as u32,
        claim_nullifier: read_n(journal, 237)?,
        event_commitment: read_n(journal, 269)?,
        destination_chain_id: read_u64(journal, 301)?,
        expires_at_ledger: read_u32(journal, 309)?,
        cctp_source_domain: read_u32(journal, 313)?,
        cctp_destination_domain: read_u32(journal, 317)?,
        cctp_nonce: read_n(journal, 321)?,
        cctp_message_hash: read_n(journal, 353)?,
        cctp_attestation_hash: read_n(journal, 385)?,
        cctp_mint_recipient: read_n(journal, 417)?,
        cctp_fee_executed: cctp_fee_executed as i128,
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

fn is_zero_bytes<const N: usize>(env: &Env, value: &BytesN<N>) -> bool {
    *value == BytesN::from_array(env, &[0u8; N])
}
