use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use thiserror::Error;

pub const JOURNAL_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum NebulaError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid hex: {0}")]
    Hex(String),
    #[error("invalid decimal: {0}")]
    Decimal(String),
    #[error("witness validation failed: {0}")]
    Validation(&'static str),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ComplianceMode {
    DisabledDemo,
    AllowlistMembership,
    DenylistNonMembership,
}

impl ComplianceMode {
    pub fn code(&self) -> u8 {
        match self {
            Self::DisabledDemo => 0,
            Self::AllowlistMembership => 1,
            Self::DenylistNonMembership => 2,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedConfig {
    pub source_chain_id: u64,
    pub escrow_contract: String,
    pub token_address: String,
    pub min_amount: String,
    pub max_amount: String,
    pub compliance_root: String,
    pub destination_chain_id: u64,
    pub network_domain: String,
    pub expires_at_ledger: u32,
    pub cctp_source_domain: u32,
    pub cctp_destination_domain: u32,
    pub cctp_mint_recipient: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceWitness {
    pub valid: bool,
    pub mode: ComplianceMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CctpSettlement {
    pub source_domain: u32,
    pub destination_domain: u32,
    pub nonce: String,
    pub message: String,
    pub message_hash: String,
    pub attestation_hash: String,
    pub mint_recipient: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LockWitness {
    pub version: u32,
    pub source_chain_id: u64,
    pub source_block_number: u64,
    pub source_receipt_root: String,
    pub tx_hash: String,
    pub log_index: u32,
    pub lock_id: String,
    pub escrow_contract: String,
    pub sender_address: String,
    pub token_address: String,
    pub amount: String,
    pub stellar_note_commitment: String,
    pub compliance_hint: String,
    pub compliance_root: String,
    pub compliance_mode: ComplianceMode,
    pub destination_chain_id: u64,
    pub cctp_settlement: CctpSettlement,
    pub expected: ExpectedConfig,
    pub compliance_witness: ComplianceWitness,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NebulaJournal {
    pub version: u32,
    pub domain: String,
    pub source_chain_id: u64,
    pub source_block_number: u64,
    pub source_receipt_root: String,
    pub escrow_contract: String,
    pub token: String,
    pub amount: String,
    pub amount_bucket: u64,
    pub stellar_note_commitment: String,
    pub compliance_root: String,
    pub compliance_mode: u8,
    pub claim_nullifier: String,
    pub event_commitment: String,
    pub destination_chain_id: u64,
    pub expires_at_ledger: u32,
    pub cctp_source_domain: u32,
    pub cctp_destination_domain: u32,
    pub cctp_nonce: String,
    pub cctp_message_hash: String,
    pub cctp_attestation_hash: String,
    pub cctp_mint_recipient: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProofMode {
    #[serde(rename = "local-groth16")]
    LocalGroth16,
    #[serde(rename = "remote")]
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofArtifact {
    pub version: u32,
    pub proof_mode: ProofMode,
    pub seal_hex: String,
    pub image_id_hex: String,
    pub journal_hex: String,
    pub journal_digest_hex: String,
    pub public_outputs: NebulaJournal,
    pub generated_at: String,
    pub witness_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditorVerificationInstruction {
    pub title: String,
    pub description: String,
    pub command: Option<String>,
    pub expected: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditorPacket {
    pub version: u32,
    pub source_chain_id: u64,
    pub source_tx_hash: String,
    pub source_log_index: u32,
    pub stellar_claim_tx_hash: Option<String>,
    pub note_commitment: String,
    pub claim_nullifier: String,
    pub event_commitment: String,
    pub proof_image_id: String,
    pub journal_digest: String,
    pub disclosure_mode: String,
    pub caveats: Vec<String>,
    pub verification_instructions: Vec<AuditorVerificationInstruction>,
}

pub fn load_witness(path: impl AsRef<Path>) -> Result<LockWitness, NebulaError> {
    let bytes = fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

pub fn validate_witness(witness: &LockWitness) -> Result<NebulaJournal, NebulaError> {
    if witness.version != 1 {
        return Err(NebulaError::Validation("unsupported witness version"));
    }
    if witness.source_chain_id != witness.expected.source_chain_id {
        return Err(NebulaError::Validation("wrong source chain"));
    }
    if !hex_eq(&witness.escrow_contract, &witness.expected.escrow_contract) {
        return Err(NebulaError::Validation("wrong escrow"));
    }
    if !hex_eq(&witness.token_address, &witness.expected.token_address) {
        return Err(NebulaError::Validation("wrong token"));
    }
    if witness.destination_chain_id != witness.expected.destination_chain_id {
        return Err(NebulaError::Validation("wrong destination"));
    }
    if witness.cctp_settlement.source_domain != witness.expected.cctp_source_domain {
        return Err(NebulaError::Validation("wrong CCTP source domain"));
    }
    if witness.cctp_settlement.destination_domain != witness.expected.cctp_destination_domain {
        return Err(NebulaError::Validation("wrong CCTP destination domain"));
    }
    if !hex_eq(
        &witness.cctp_settlement.mint_recipient,
        &witness.expected.cctp_mint_recipient,
    ) {
        return Err(NebulaError::Validation("wrong CCTP mint recipient"));
    }
    if !hex_eq(&witness.compliance_root, &witness.expected.compliance_root) {
        return Err(NebulaError::Validation("wrong compliance root"));
    }
    if !witness.compliance_witness.valid {
        return Err(NebulaError::Validation("bad compliance witness"));
    }
    if witness.compliance_witness.mode != witness.compliance_mode {
        return Err(NebulaError::Validation("compliance mode mismatch"));
    }

    let amount = parse_u128_decimal(&witness.amount)?;
    let min_amount = parse_u128_decimal(&witness.expected.min_amount)?;
    let max_amount = parse_u128_decimal(&witness.expected.max_amount)?;
    if amount < min_amount || amount > max_amount {
        return Err(NebulaError::Validation("amount out of bounds"));
    }
    if amount == 0 {
        return Err(NebulaError::Validation("zero amount"));
    }

    let note = parse_hex_32(&witness.stellar_note_commitment)?;
    if note == [0u8; 32] {
        return Err(NebulaError::Validation("zero note commitment"));
    }
    let cctp_nonce = parse_hex_32(&witness.cctp_settlement.nonce)?;
    let cctp_message_hash = parse_hex_32(&witness.cctp_settlement.message_hash)?;
    let cctp_attestation_hash = parse_hex_32(&witness.cctp_settlement.attestation_hash)?;
    let cctp_mint_recipient = parse_hex_32(&witness.cctp_settlement.mint_recipient)?;
    let cctp_message = parse_hex_bytes(&witness.cctp_settlement.message)?;
    if cctp_nonce == [0u8; 32]
        || cctp_message_hash == [0u8; 32]
        || cctp_attestation_hash == [0u8; 32]
        || cctp_mint_recipient == [0u8; 32]
    {
        return Err(NebulaError::Validation("zero CCTP settlement field"));
    }
    let computed_cctp_message_hash: [u8; 32] = Sha256::digest(&cctp_message).into();
    if computed_cctp_message_hash != cctp_message_hash {
        return Err(NebulaError::Validation("CCTP message hash mismatch"));
    }
    validate_cctp_v2_message(
        &cctp_message,
        witness.cctp_settlement.source_domain,
        witness.cctp_settlement.destination_domain,
        &cctp_nonce,
        &cctp_mint_recipient,
        &parse_hex_20(&witness.token_address)?,
        amount,
        &parse_hex_20(&witness.escrow_contract)?,
    )?;

    let claim_nullifier = claim_nullifier(witness)?;
    let event_commitment = event_commitment(witness, amount)?;
    let amount_bucket = u64::try_from(amount / 1_000_000)
        .map_err(|_| NebulaError::Validation("amount bucket overflow"))?;

    Ok(NebulaJournal {
        version: JOURNAL_VERSION,
        domain: normalize_hex_32(&witness.expected.network_domain)?,
        source_chain_id: witness.source_chain_id,
        source_block_number: witness.source_block_number,
        source_receipt_root: normalize_hex_32(&witness.source_receipt_root)?,
        escrow_contract: normalize_hex_20(&witness.escrow_contract)?,
        token: normalize_hex_20(&witness.token_address)?,
        amount: amount.to_string(),
        amount_bucket,
        stellar_note_commitment: normalize_hex_32(&witness.stellar_note_commitment)?,
        compliance_root: normalize_hex_32(&witness.compliance_root)?,
        compliance_mode: witness.compliance_mode.code(),
        claim_nullifier: to_hex_32(&claim_nullifier),
        event_commitment: to_hex_32(&event_commitment),
        destination_chain_id: witness.destination_chain_id,
        expires_at_ledger: witness.expected.expires_at_ledger,
        cctp_source_domain: witness.cctp_settlement.source_domain,
        cctp_destination_domain: witness.cctp_settlement.destination_domain,
        cctp_nonce: to_hex_32(&cctp_nonce),
        cctp_message_hash: to_hex_32(&cctp_message_hash),
        cctp_attestation_hash: to_hex_32(&cctp_attestation_hash),
        cctp_mint_recipient: to_hex_32(&cctp_mint_recipient),
    })
}

pub fn encode_journal(journal: &NebulaJournal) -> Result<Vec<u8>, NebulaError> {
    let amount = parse_u128_decimal(&journal.amount)?;
    let mut out = Vec::with_capacity(425);
    out.extend_from_slice(&journal.version.to_be_bytes());
    out.extend_from_slice(&parse_hex_32(&journal.domain)?);
    out.extend_from_slice(&journal.source_chain_id.to_be_bytes());
    out.extend_from_slice(&journal.source_block_number.to_be_bytes());
    out.extend_from_slice(&parse_hex_32(&journal.source_receipt_root)?);
    out.extend_from_slice(&parse_hex_20(&journal.escrow_contract)?);
    out.extend_from_slice(&parse_hex_20(&journal.token)?);
    out.extend_from_slice(&amount.to_be_bytes());
    out.extend_from_slice(&journal.amount_bucket.to_be_bytes());
    out.extend_from_slice(&parse_hex_32(&journal.stellar_note_commitment)?);
    out.extend_from_slice(&parse_hex_32(&journal.compliance_root)?);
    out.push(journal.compliance_mode);
    out.extend_from_slice(&parse_hex_32(&journal.claim_nullifier)?);
    out.extend_from_slice(&parse_hex_32(&journal.event_commitment)?);
    out.extend_from_slice(&journal.destination_chain_id.to_be_bytes());
    out.extend_from_slice(&journal.expires_at_ledger.to_be_bytes());
    out.extend_from_slice(&journal.cctp_source_domain.to_be_bytes());
    out.extend_from_slice(&journal.cctp_destination_domain.to_be_bytes());
    out.extend_from_slice(&parse_hex_32(&journal.cctp_nonce)?);
    out.extend_from_slice(&parse_hex_32(&journal.cctp_message_hash)?);
    out.extend_from_slice(&parse_hex_32(&journal.cctp_attestation_hash)?);
    out.extend_from_slice(&parse_hex_32(&journal.cctp_mint_recipient)?);
    Ok(out)
}

pub fn journal_digest(journal_bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(journal_bytes).into()
}

pub fn witness_hash(witness: &LockWitness) -> Result<[u8; 32], NebulaError> {
    Ok(Sha256::digest(serde_json::to_vec(witness)?).into())
}

pub fn bytes_to_hex(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

pub fn to_hex_32(bytes: &[u8; 32]) -> String {
    bytes_to_hex(bytes)
}

fn claim_nullifier(witness: &LockWitness) -> Result<[u8; 32], NebulaError> {
    let mut h = Sha256::new();
    h.update(b"NEBULA_NULLIFIER_V1");
    h.update(witness.source_chain_id.to_be_bytes());
    h.update(parse_hex_32(&witness.tx_hash)?);
    h.update(witness.log_index.to_be_bytes());
    h.update(parse_hex_20(&witness.escrow_contract)?);
    h.update(parse_hex_32(&witness.stellar_note_commitment)?);
    h.update(parse_hex_32(&witness.cctp_settlement.message_hash)?);
    h.update(parse_hex_32(&witness.cctp_settlement.nonce)?);
    Ok(h.finalize().into())
}

fn event_commitment(witness: &LockWitness, amount: u128) -> Result<[u8; 32], NebulaError> {
    let mut h = Sha256::new();
    h.update(b"NEBULA_EVENT_V1");
    h.update(witness.source_chain_id.to_be_bytes());
    h.update(witness.source_block_number.to_be_bytes());
    h.update(parse_hex_32(&witness.tx_hash)?);
    h.update(witness.log_index.to_be_bytes());
    h.update(parse_hex_32(&witness.lock_id)?);
    h.update(parse_hex_20(&witness.escrow_contract)?);
    h.update(parse_hex_20(&witness.token_address)?);
    h.update(amount.to_be_bytes());
    h.update(parse_hex_32(&witness.stellar_note_commitment)?);
    h.update(parse_hex_32(&witness.cctp_settlement.message_hash)?);
    Ok(h.finalize().into())
}

fn validate_cctp_v2_message(
    message: &[u8],
    expected_source_domain: u32,
    expected_destination_domain: u32,
    expected_nonce: &[u8; 32],
    expected_mint_recipient: &[u8; 32],
    expected_burn_token: &[u8; 20],
    expected_amount: u128,
    expected_message_sender: &[u8; 20],
) -> Result<(), NebulaError> {
    if message.len() <= 376 {
        return Err(NebulaError::Validation("CCTP message missing hook data"));
    }
    let source_domain = read_u32_be(message, 4)?;
    let destination_domain = read_u32_be(message, 8)?;
    if source_domain != expected_source_domain {
        return Err(NebulaError::Validation(
            "CCTP message source domain mismatch",
        ));
    }
    if destination_domain != expected_destination_domain {
        return Err(NebulaError::Validation(
            "CCTP message destination domain mismatch",
        ));
    }
    if read_32(message, 12)? != *expected_nonce {
        return Err(NebulaError::Validation("CCTP message nonce mismatch"));
    }
    if read_32(message, 108)? != *expected_mint_recipient {
        return Err(NebulaError::Validation(
            "CCTP message destination caller mismatch",
        ));
    }

    let body = 148;
    if read_32(message, body + 4)? != evm_address_as_bytes32(expected_burn_token) {
        return Err(NebulaError::Validation("CCTP burn token mismatch"));
    }
    if read_32(message, body + 36)? != *expected_mint_recipient {
        return Err(NebulaError::Validation("CCTP mint recipient mismatch"));
    }
    let amount = read_u256_as_u128(message, body + 68)?;
    if amount != expected_amount {
        return Err(NebulaError::Validation("CCTP amount mismatch"));
    }
    if read_32(message, body + 100)? != evm_address_as_bytes32(expected_message_sender) {
        return Err(NebulaError::Validation("CCTP message sender mismatch"));
    }
    let max_fee = read_u256_as_u128(message, body + 132)?;
    if max_fee >= amount {
        return Err(NebulaError::Validation(
            "CCTP max fee must be less than amount",
        ));
    }
    if read_u32_be(message, 140)? == 0 {
        return Err(NebulaError::Validation(
            "CCTP min finality threshold is zero",
        ));
    }
    Ok(())
}

fn evm_address_as_bytes32(address: &[u8; 20]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[12..].copy_from_slice(address);
    out
}

fn read_u32_be(bytes: &[u8], offset: usize) -> Result<u32, NebulaError> {
    let raw = read_n::<4>(bytes, offset)?;
    Ok(u32::from_be_bytes(raw))
}

fn read_32(bytes: &[u8], offset: usize) -> Result<[u8; 32], NebulaError> {
    read_n::<32>(bytes, offset)
}

fn read_u256_as_u128(bytes: &[u8], offset: usize) -> Result<u128, NebulaError> {
    let raw = read_n::<32>(bytes, offset)?;
    if raw[..16].iter().any(|byte| *byte != 0) {
        return Err(NebulaError::Validation("CCTP uint256 exceeds u128"));
    }
    let mut out = [0u8; 16];
    out.copy_from_slice(&raw[16..]);
    Ok(u128::from_be_bytes(out))
}

fn read_n<const N: usize>(bytes: &[u8], offset: usize) -> Result<[u8; N], NebulaError> {
    let end = offset
        .checked_add(N)
        .ok_or(NebulaError::Validation("CCTP offset overflow"))?;
    if end > bytes.len() {
        return Err(NebulaError::Validation("CCTP message too short"));
    }
    let mut out = [0u8; N];
    out.copy_from_slice(&bytes[offset..end]);
    Ok(out)
}

fn parse_u128_decimal(value: &str) -> Result<u128, NebulaError> {
    value
        .parse::<u128>()
        .map_err(|_| NebulaError::Decimal(value.to_owned()))
}

fn hex_eq(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

fn normalize_hex_20(value: &str) -> Result<String, NebulaError> {
    Ok(to_prefixed_lower_hex(&parse_hex_20(value)?))
}

fn normalize_hex_32(value: &str) -> Result<String, NebulaError> {
    Ok(to_prefixed_lower_hex(&parse_hex_32(value)?))
}

fn to_prefixed_lower_hex(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

fn parse_hex_20(value: &str) -> Result<[u8; 20], NebulaError> {
    let bytes = parse_hex_exact(value, 20)?;
    let mut out = [0u8; 20];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn parse_hex_32(value: &str) -> Result<[u8; 32], NebulaError> {
    let bytes = parse_hex_exact(value, 32)?;
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn parse_hex_bytes(value: &str) -> Result<Vec<u8>, NebulaError> {
    let raw = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .ok_or_else(|| NebulaError::Hex(value.to_owned()))?;
    hex::decode(raw).map_err(|_| NebulaError::Hex(value.to_owned()))
}

fn parse_hex_exact(value: &str, len: usize) -> Result<Vec<u8>, NebulaError> {
    let raw = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .ok_or_else(|| NebulaError::Hex(value.to_owned()))?;
    let bytes = hex::decode(raw).map_err(|_| NebulaError::Hex(value.to_owned()))?;
    if bytes.len() != len {
        return Err(NebulaError::Hex(value.to_owned()));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        format!("{}/../../fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn valid_fixture_parses_and_encodes_deterministically() {
        let witness = load_witness(fixture("valid-lock.json")).unwrap();
        let journal = validate_witness(&witness).unwrap();
        let encoded = encode_journal(&journal).unwrap();
        assert_eq!(encoded.len(), 425);
        assert_eq!(
            journal.domain,
            "0x4e4542554c415f5354454c4c41525f544553544e45545f563100000000000000"
        );
        assert_eq!(journal.amount_bucket, 100);
        assert_eq!(journal.cctp_destination_domain, 27);
        assert_eq!(
            journal.cctp_message_hash,
            "0x428f0dc1a457bec99fe9a1e8d375a01d4fc7c6b0691cef934fbbbfe30c300b67"
        );
        assert_eq!(
            to_hex_32(&journal_digest(&encoded)),
            to_hex_32(&journal_digest(&encoded))
        );
    }

    #[test]
    fn invalid_fixtures_reject() {
        for name in [
            "wrong-token.json",
            "wrong-escrow.json",
            "bad-compliance.json",
            "wrong-destination.json",
        ] {
            let witness = load_witness(fixture(name)).unwrap();
            assert!(validate_witness(&witness).is_err(), "{name} should fail");
        }
    }

    #[test]
    fn cctp_message_binding_rejects_hash_and_amount_mismatches() {
        let mut witness = load_witness(fixture("valid-lock.json")).unwrap();
        witness.cctp_settlement.message_hash =
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_owned();
        assert!(validate_witness(&witness).is_err());

        let mut witness = load_witness(fixture("valid-lock.json")).unwrap();
        witness.amount = "90000000".to_owned();
        assert!(validate_witness(&witness).is_err());
    }
}
