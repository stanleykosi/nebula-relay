extern crate std;

use super::cctp_forwarder::CctpForwarderError;
use super::pool_adapter::PoolAdapterError;
use super::verifier_router::VerifierError;
use super::*;
use nebula_risc0_shared::{
    encode_journal, journal_digest, load_witness, validate_witness, NebulaJournal,
};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger as _},
    Address, Bytes, Env,
};
use std::{borrow::ToOwned, format, string::String};

const TEST_IMAGE_ID: [u8; 32] = [0x42; 32];
const TEST_ROUTER_SEAL_PREFIX: &[u8; 19] = b"NEBULA_TEST_SEAL_V1";

#[contracttype]
#[derive(Clone)]
enum RouterHarnessKey {
    ExpectedSeal,
    ExpectedImageId,
    ExpectedJournalDigest,
    ShouldFail,
    LastSeal,
    LastImageId,
    LastJournalDigest,
}

#[contracttype]
#[derive(Clone)]
enum PoolHarnessKey {
    ExpectedRelay,
    ExpectedClaimant,
    ExpectedNote,
    ExpectedAmount,
    ExpectedAsset,
    ExpectedNullifier,
    ExpectedEvent,
    ShouldFail,
    Called,
    LastRelay,
    LastClaimant,
    LastNote,
    LastAmount,
    LastAsset,
    LastNullifier,
    LastEvent,
    LastPayload,
}

#[contracttype]
#[derive(Clone)]
enum CctpHarnessKey {
    ExpectedMessage,
    ExpectedAttestation,
    ShouldFail,
    Called,
    LastMessage,
    LastAttestation,
}

#[contract]
struct RouterHarness;

#[contractimpl]
impl RouterHarness {
    pub fn configure(
        env: Env,
        expected_seal: Bytes,
        expected_image_id: BytesN<32>,
        expected_journal_digest: BytesN<32>,
        should_fail: bool,
    ) {
        env.storage()
            .temporary()
            .set(&RouterHarnessKey::ExpectedSeal, &expected_seal);
        env.storage()
            .temporary()
            .set(&RouterHarnessKey::ExpectedImageId, &expected_image_id);
        env.storage().temporary().set(
            &RouterHarnessKey::ExpectedJournalDigest,
            &expected_journal_digest,
        );
        env.storage()
            .temporary()
            .set(&RouterHarnessKey::ShouldFail, &should_fail);
    }

    pub fn verify(
        env: Env,
        seal: Bytes,
        image_id: BytesN<32>,
        journal: BytesN<32>,
    ) -> Result<(), VerifierError> {
        env.storage()
            .temporary()
            .set(&RouterHarnessKey::LastSeal, &seal);
        env.storage()
            .temporary()
            .set(&RouterHarnessKey::LastImageId, &image_id);
        env.storage()
            .temporary()
            .set(&RouterHarnessKey::LastJournalDigest, &journal);

        if env
            .storage()
            .temporary()
            .get(&RouterHarnessKey::ShouldFail)
            .unwrap_or(false)
        {
            return Err(VerifierError::InvalidProof);
        }

        let expected_seal: Bytes = env
            .storage()
            .temporary()
            .get(&RouterHarnessKey::ExpectedSeal)
            .ok_or(VerifierError::MalformedSeal)?;
        if seal != expected_seal {
            return Err(VerifierError::InvalidProof);
        }

        let expected_image_id: BytesN<32> = env
            .storage()
            .temporary()
            .get(&RouterHarnessKey::ExpectedImageId)
            .ok_or(VerifierError::MalformedPublicInputs)?;
        if image_id != expected_image_id {
            return Err(VerifierError::InvalidProof);
        }

        let expected_journal_digest: BytesN<32> = env
            .storage()
            .temporary()
            .get(&RouterHarnessKey::ExpectedJournalDigest)
            .ok_or(VerifierError::MalformedPublicInputs)?;
        if journal != expected_journal_digest {
            return Err(VerifierError::InvalidProof);
        }

        Ok(())
    }

    pub fn last_journal_digest(env: Env) -> Option<BytesN<32>> {
        env.storage()
            .temporary()
            .get(&RouterHarnessKey::LastJournalDigest)
    }
}

#[contract]
struct PoolAdapterHarness;

#[contractimpl]
impl PoolAdapterHarness {
    pub fn configure(
        env: Env,
        expected_relay: Address,
        expected_claimant: Address,
        expected_note: BytesN<32>,
        expected_amount: i128,
        expected_asset: Address,
        expected_nullifier: BytesN<32>,
        expected_event: BytesN<32>,
        should_fail: bool,
    ) {
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::ExpectedRelay, &expected_relay);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::ExpectedClaimant, &expected_claimant);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::ExpectedNote, &expected_note);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::ExpectedAmount, &expected_amount);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::ExpectedAsset, &expected_asset);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::ExpectedNullifier, &expected_nullifier);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::ExpectedEvent, &expected_event);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::ShouldFail, &should_fail);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::Called, &false);
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
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::Called, &true);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::LastRelay, &relay);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::LastClaimant, &claimant);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::LastNote, &note_commitment);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::LastAmount, &amount);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::LastAsset, &asset);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::LastNullifier, &nullifier);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::LastEvent, &event_commitment);
        env.storage()
            .temporary()
            .set(&PoolHarnessKey::LastPayload, &pool_payload);

        if env
            .storage()
            .temporary()
            .get(&PoolHarnessKey::ShouldFail)
            .unwrap_or(false)
        {
            return Err(PoolAdapterError::Rejected);
        }

        let expected_relay: Address = env
            .storage()
            .temporary()
            .get(&PoolHarnessKey::ExpectedRelay)
            .ok_or(PoolAdapterError::InvalidHandoff)?;
        if relay != expected_relay {
            return Err(PoolAdapterError::NotRelay);
        }

        let expected_claimant: Address = env
            .storage()
            .temporary()
            .get(&PoolHarnessKey::ExpectedClaimant)
            .ok_or(PoolAdapterError::InvalidHandoff)?;
        let expected_note: BytesN<32> = env
            .storage()
            .temporary()
            .get(&PoolHarnessKey::ExpectedNote)
            .ok_or(PoolAdapterError::InvalidHandoff)?;
        let expected_amount: i128 = env
            .storage()
            .temporary()
            .get(&PoolHarnessKey::ExpectedAmount)
            .ok_or(PoolAdapterError::InvalidHandoff)?;
        let expected_asset: Address = env
            .storage()
            .temporary()
            .get(&PoolHarnessKey::ExpectedAsset)
            .ok_or(PoolAdapterError::InvalidHandoff)?;
        let expected_nullifier: BytesN<32> = env
            .storage()
            .temporary()
            .get(&PoolHarnessKey::ExpectedNullifier)
            .ok_or(PoolAdapterError::InvalidHandoff)?;
        let expected_event: BytesN<32> = env
            .storage()
            .temporary()
            .get(&PoolHarnessKey::ExpectedEvent)
            .ok_or(PoolAdapterError::InvalidHandoff)?;

        if claimant != expected_claimant
            || note_commitment != expected_note
            || amount != expected_amount
            || asset != expected_asset
            || nullifier != expected_nullifier
            || event_commitment != expected_event
        {
            return Err(PoolAdapterError::InvalidHandoff);
        }

        Ok(())
    }

    pub fn was_called(env: Env) -> bool {
        env.storage()
            .temporary()
            .get(&PoolHarnessKey::Called)
            .unwrap_or(false)
    }

    pub fn last_note(env: Env) -> Option<BytesN<32>> {
        env.storage().temporary().get(&PoolHarnessKey::LastNote)
    }

    pub fn last_amount(env: Env) -> Option<i128> {
        env.storage().temporary().get(&PoolHarnessKey::LastAmount)
    }

    pub fn last_asset(env: Env) -> Option<Address> {
        env.storage().temporary().get(&PoolHarnessKey::LastAsset)
    }

    pub fn last_payload(env: Env) -> Option<Bytes> {
        env.storage().temporary().get(&PoolHarnessKey::LastPayload)
    }
}

#[contract]
struct CctpForwarderHarness;

#[contractimpl]
impl CctpForwarderHarness {
    pub fn configure(
        env: Env,
        expected_message: Bytes,
        expected_attestation: Bytes,
        should_fail: bool,
    ) {
        env.storage()
            .temporary()
            .set(&CctpHarnessKey::ExpectedMessage, &expected_message);
        env.storage()
            .temporary()
            .set(&CctpHarnessKey::ExpectedAttestation, &expected_attestation);
        env.storage()
            .temporary()
            .set(&CctpHarnessKey::ShouldFail, &should_fail);
        env.storage()
            .temporary()
            .set(&CctpHarnessKey::Called, &false);
    }

    pub fn mint_and_forward(
        env: Env,
        message: Bytes,
        attestation: Bytes,
    ) -> Result<(), CctpForwarderError> {
        env.storage()
            .temporary()
            .set(&CctpHarnessKey::Called, &true);
        env.storage()
            .temporary()
            .set(&CctpHarnessKey::LastMessage, &message);
        env.storage()
            .temporary()
            .set(&CctpHarnessKey::LastAttestation, &attestation);

        if env
            .storage()
            .temporary()
            .get(&CctpHarnessKey::ShouldFail)
            .unwrap_or(false)
        {
            return Err(CctpForwarderError::Rejected);
        }

        let expected_message: Bytes = env
            .storage()
            .temporary()
            .get(&CctpHarnessKey::ExpectedMessage)
            .ok_or(CctpForwarderError::Rejected)?;
        let expected_attestation: Bytes = env
            .storage()
            .temporary()
            .get(&CctpHarnessKey::ExpectedAttestation)
            .ok_or(CctpForwarderError::Rejected)?;
        if message != expected_message || attestation != expected_attestation {
            return Err(CctpForwarderError::Rejected);
        }
        Ok(())
    }

    pub fn was_called(env: Env) -> bool {
        env.storage()
            .temporary()
            .get(&CctpHarnessKey::Called)
            .unwrap_or(false)
    }

    pub fn last_message(env: Env) -> Option<Bytes> {
        env.storage().temporary().get(&CctpHarnessKey::LastMessage)
    }
}

fn hex20(env: &Env, value: &str) -> BytesN<20> {
    let raw = value.trim_start_matches("0x");
    let bytes = hex::decode(raw).unwrap();
    BytesN::from_array(env, bytes.as_slice().try_into().unwrap())
}

fn hex32(env: &Env, value: &str) -> BytesN<32> {
    let raw = value.trim_start_matches("0x");
    let bytes = hex::decode(raw).unwrap();
    BytesN::from_array(env, bytes.as_slice().try_into().unwrap())
}

fn bytes_from_hex(env: &Env, value: &str) -> Bytes {
    let raw = value.trim_start_matches("0x");
    Bytes::from_slice(env, &hex::decode(raw).unwrap())
}

fn cctp_message(env: &Env) -> Bytes {
    let witness = load_witness(fixture("valid-lock.json")).unwrap();
    bytes_from_hex(env, &witness.cctp_settlement.message)
}

fn cctp_attestation(env: &Env) -> Bytes {
    bytes_from_hex(env, "0x0a0b0c0d")
}

fn fixture(name: &str) -> String {
    format!("{}/../../../fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

struct Setup {
    env: Env,
    contract_id: Address,
    verifier_router: Address,
    pool_adapter: Address,
    cctp_forwarder: Address,
    asset: Address,
    admin: Address,
    claimant: Address,
}

impl Setup {
    fn client(&self) -> NebulaRelayClient<'_> {
        NebulaRelayClient::new(&self.env, &self.contract_id)
    }

    fn router(&self) -> RouterHarnessClient<'_> {
        RouterHarnessClient::new(&self.env, &self.verifier_router)
    }

    fn adapter(&self) -> PoolAdapterHarnessClient<'_> {
        PoolAdapterHarnessClient::new(&self.env, &self.pool_adapter)
    }

    fn cctp(&self) -> CctpForwarderHarnessClient<'_> {
        CctpForwarderHarnessClient::new(&self.env, &self.cctp_forwarder)
    }

    fn configure_router(
        &self,
        seal: &Bytes,
        image_id: &BytesN<32>,
        journal: &Bytes,
        should_fail: bool,
    ) -> BytesN<32> {
        let digest: BytesN<32> = self.env.crypto().sha256(journal).into();
        self.router()
            .configure(seal, image_id, &digest, &should_fail);
        digest
    }

    fn configure_router_with_digest(
        &self,
        seal: &Bytes,
        image_id: &BytesN<32>,
        expected_journal_digest: &BytesN<32>,
        should_fail: bool,
    ) {
        self.router()
            .configure(seal, image_id, expected_journal_digest, &should_fail);
    }

    fn configure_adapter_from_journal(&self, journal: &NebulaJournal, should_fail: bool) {
        let fields = handoff_fields(&self.env, journal);
        self.adapter().configure(
            &self.contract_id,
            &self.claimant,
            &fields.note_commitment,
            &fields.amount,
            &self.asset,
            &fields.nullifier,
            &fields.event_commitment,
            &should_fail,
        );
    }

    fn configure_cctp(&self, should_fail: bool) {
        self.cctp().configure(
            &cctp_message(&self.env),
            &cctp_attestation(&self.env),
            &should_fail,
        );
    }
}

struct HandoffFields {
    note_commitment: BytesN<32>,
    amount: i128,
    nullifier: BytesN<32>,
    event_commitment: BytesN<32>,
}

fn handoff_fields(env: &Env, journal: &NebulaJournal) -> HandoffFields {
    HandoffFields {
        note_commitment: hex32(env, &journal.stellar_note_commitment),
        amount: journal.amount.parse::<i128>().unwrap(),
        nullifier: hex32(env, &journal.claim_nullifier),
        event_commitment: hex32(env, &journal.event_commitment),
    }
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let (seal, image_id, journal, _) = artifact_parts(&env, &fixture("valid-lock.json"));
    let verifier_router = env.register(RouterHarness, ());
    let router = RouterHarnessClient::new(&env, &verifier_router);
    let digest: BytesN<32> = env.crypto().sha256(&journal).into();
    router.configure(&seal, &image_id, &digest, &false);
    let pool_adapter = env.register(PoolAdapterHarness, ());
    let cctp_forwarder = env.register(CctpForwarderHarness, ());

    let contract_id = env.register(NebulaRelay, ());
    let client = NebulaRelayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let asset = Address::generate(&env);
    let witness = load_witness(fixture("valid-lock.json")).unwrap();

    client.initialize(
        &admin,
        &verifier_router,
        &pool_adapter,
        &cctp_forwarder,
        &hex32(&env, &witness.expected.cctp_mint_recipient),
        &BytesN::from_array(&env, &TEST_IMAGE_ID),
        &asset,
        &hex32(&env, &witness.expected.network_domain),
    );
    client.register_source(
        &admin,
        &witness.source_chain_id,
        &hex20(&env, &witness.expected.escrow_contract),
        &hex20(&env, &witness.expected.token_address),
        &witness.expected.min_amount.parse::<i128>().unwrap(),
        &witness.expected.max_amount.parse::<i128>().unwrap(),
        &true,
    );
    client.register_compliance_root(
        &admin,
        &hex32(&env, &witness.expected.compliance_root),
        &1u32,
        &witness.expected.expires_at_ledger,
        &true,
    );

    let setup = Setup {
        env,
        contract_id,
        verifier_router,
        pool_adapter,
        cctp_forwarder,
        asset,
        admin,
        claimant,
    };
    setup.configure_adapter_from_journal(&valid_journal(), false);
    setup.configure_cctp(false);
    setup
}

fn artifact_parts(env: &Env, fixture: &str) -> (Bytes, BytesN<32>, Bytes, BytesN<32>) {
    let witness = load_witness(fixture).unwrap();
    let journal = validate_witness(&witness).unwrap();
    let journal_bytes = encode_journal(&journal).unwrap();
    let digest = journal_digest(&journal_bytes);
    let mut seal = std::vec::Vec::new();
    seal.extend_from_slice(TEST_ROUTER_SEAL_PREFIX);
    seal.extend_from_slice(&digest);
    (
        Bytes::from_slice(env, &seal),
        BytesN::from_array(env, &TEST_IMAGE_ID),
        Bytes::from_slice(env, &journal_bytes),
        hex32(env, &journal.claim_nullifier),
    )
}

fn signed_journal(env: &Env, journal: &NebulaJournal) -> (Bytes, BytesN<32>, Bytes) {
    let journal_bytes = encode_journal(journal).unwrap();
    let digest = journal_digest(&journal_bytes);
    let mut seal = std::vec::Vec::new();
    seal.extend_from_slice(TEST_ROUTER_SEAL_PREFIX);
    seal.extend_from_slice(&digest);
    (
        Bytes::from_slice(env, &seal),
        BytesN::from_array(env, &TEST_IMAGE_ID),
        Bytes::from_slice(env, &journal_bytes),
    )
}

fn valid_journal() -> NebulaJournal {
    let witness = load_witness(fixture("valid-lock.json")).unwrap();
    validate_witness(&witness).unwrap()
}

#[test]
fn valid_claim_stores_nullifier_and_record() {
    let s = setup();
    let client = s.client();
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let expected_digest = s.configure_router(&seal, &image_id, &journal, false);
    let receipt = client.claim(
        &s.claimant,
        &seal,
        &image_id,
        &journal,
        &cctp_message(&s.env),
        &cctp_attestation(&s.env),
        &Bytes::new(&s.env),
    );

    assert_eq!(receipt.nullifier, nullifier);
    assert!(client.is_claimed(&nullifier));
    let record = client.get_claim(&nullifier).unwrap();
    assert_eq!(record.amount, 100_000_000);
    assert_eq!(record.cctp_message_hash, receipt.cctp_message_hash);
    let note_record = client.get_note(&receipt.note_commitment).unwrap();
    assert_eq!(note_record, record);
    assert_eq!(s.router().last_journal_digest(), Some(expected_digest));
    assert!(s.cctp().was_called());
}

#[test]
fn claim_hands_off_private_note_to_adapter() {
    let s = setup();
    let client = s.client();
    let (seal, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let payload = Bytes::from_slice(&s.env, b"mode-a-private-payments-handoff-v1");
    s.configure_router(&seal, &image_id, &journal, false);
    s.configure_adapter_from_journal(&valid_journal(), false);

    let receipt = client.claim(
        &s.claimant,
        &seal,
        &image_id,
        &journal,
        &cctp_message(&s.env),
        &cctp_attestation(&s.env),
        &payload,
    );

    assert!(s.adapter().was_called());
    assert_eq!(
        s.adapter().last_note(),
        Some(receipt.note_commitment.clone())
    );
    assert_eq!(s.adapter().last_amount(), Some(receipt.amount));
    assert_eq!(s.adapter().last_asset(), Some(s.asset.clone()));
    assert_eq!(s.adapter().last_payload(), Some(payload));
}

#[test]
fn adapter_rejects_non_relay_handoff() {
    let s = setup();
    let journal = valid_journal();
    let fields = handoff_fields(&s.env, &journal);
    let wrong_relay = Address::generate(&s.env);
    let payload = Bytes::from_slice(&s.env, b"direct-non-relay-call");

    assert!(s
        .adapter()
        .try_credit_note_from_relay(
            &wrong_relay,
            &s.claimant,
            &fields.note_commitment,
            &fields.amount,
            &s.asset,
            &fields.nullifier,
            &fields.event_commitment,
            &payload,
        )
        .is_err());
}

#[test]
fn adapter_failure_rolls_back_nullifier_storage() {
    let s = setup();
    let client = s.client();
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let model = valid_journal();
    let fields = handoff_fields(&s.env, &model);
    s.configure_router(&seal, &image_id, &journal, false);
    s.configure_adapter_from_journal(&model, true);

    assert!(client
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
    assert!(!client.is_claimed(&nullifier));
    assert!(client.get_claim(&nullifier).is_none());
    assert!(client.get_note(&fields.note_commitment).is_none());
}

#[test]
fn cctp_settlement_failure_rolls_back_before_handoff_and_storage() {
    let s = setup();
    let client = s.client();
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, false);
    s.configure_cctp(true);

    assert!(client
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
    assert!(!s.adapter().was_called());
    assert!(!client.is_claimed(&nullifier));
}

#[test]
fn wrong_cctp_message_or_attestation_fails_before_handoff() {
    let s = setup();
    let client = s.client();
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, false);

    assert!(client
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal,
            &bytes_from_hex(&s.env, "0xff"),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
    assert!(!s.cctp().was_called());
    assert!(!s.adapter().was_called());
    assert!(!client.is_claimed(&nullifier));
}

#[test]
fn wrong_cctp_destination_or_mint_recipient_journal_fails() {
    let s = setup();

    let mut wrong_domain = valid_journal();
    wrong_domain.cctp_destination_domain = 26;
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &wrong_domain);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());

    let mut wrong_recipient = valid_journal();
    wrong_recipient.cctp_mint_recipient =
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd".to_owned();
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &wrong_recipient);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
}

#[test]
fn replay_fails() {
    let s = setup();
    let client = s.client();
    let (seal, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, false);
    client.claim(
        &s.claimant,
        &seal,
        &image_id,
        &journal,
        &cctp_message(&s.env),
        &cctp_attestation(&s.env),
        &Bytes::new(&s.env),
    );
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
}

#[test]
fn wrong_image_id_fails() {
    let s = setup();
    let (seal, _, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let bad_image = BytesN::from_array(&s.env, &[9u8; 32]);
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &bad_image,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env)
        )
        .is_err());
}

#[test]
fn tampered_seal_fails() {
    let s = setup();
    let (_, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let seal = bytes_from_hex(
        &s.env,
        "0x4e4542554c415f4445565f5345414c5f56310000000000000000000000000000000000000000000000000000000000000000",
    );
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
}

#[test]
fn router_rejects_wrong_journal_digest() {
    let s = setup();
    let (seal, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let wrong_digest = BytesN::from_array(&s.env, &[9u8; 32]);
    s.configure_router_with_digest(&seal, &image_id, &wrong_digest, false);

    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
}

#[test]
fn router_error_fails_before_handoff_and_storage() {
    let s = setup();
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, true);

    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
    assert!(!s.adapter().was_called());
    assert!(!s.client().is_claimed(&nullifier));
}

#[test]
fn admin_registration_rejects_invalid_source_config() {
    let s = setup();
    let witness = load_witness(fixture("valid-lock.json")).unwrap();
    let escrow = hex20(&s.env, &witness.expected.escrow_contract);
    let token = hex20(&s.env, &witness.expected.token_address);
    let zero20 = BytesN::from_array(&s.env, &[0u8; 20]);

    assert!(s
        .client()
        .try_register_source(&s.admin, &0u64, &escrow, &token, &1i128, &2i128, &true)
        .is_err());
    assert!(s
        .client()
        .try_register_source(
            &s.admin,
            &witness.source_chain_id,
            &zero20,
            &token,
            &1i128,
            &2i128,
            &true,
        )
        .is_err());
    assert!(s
        .client()
        .try_register_source(
            &s.admin,
            &witness.source_chain_id,
            &escrow,
            &zero20,
            &1i128,
            &2i128,
            &true,
        )
        .is_err());
}

#[test]
fn admin_registration_rejects_invalid_compliance_config() {
    let s = setup();
    let root = hex32(
        &s.env,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    let zero32 = BytesN::from_array(&s.env, &[0u8; 32]);

    assert!(s
        .client()
        .try_register_compliance_root(&s.admin, &zero32, &1u32, &999_999u32, &true)
        .is_err());
    assert!(s
        .client()
        .try_register_compliance_root(&s.admin, &root, &3u32, &999_999u32, &true)
        .is_err());
    assert!(s
        .client()
        .try_register_compliance_root(&s.admin, &root, &1u32, &1u32, &true)
        .is_err());
}

#[test]
fn invalid_fixtures_fail_guest_validation() {
    for name in [
        "wrong-token.json",
        "wrong-escrow.json",
        "bad-compliance.json",
        "wrong-destination.json",
    ] {
        let witness = load_witness(fixture(name)).unwrap();
        assert!(validate_witness(&witness).is_err());
    }
}

#[test]
fn contract_rejects_wrong_token_journal() {
    let s = setup();
    let mut journal = valid_journal();
    journal.token = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_owned();
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &journal);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
}

#[test]
fn contract_rejects_wrong_escrow_journal() {
    let s = setup();
    let mut journal = valid_journal();
    journal.escrow_contract = "0x2222222222222222222222222222222222222222".to_owned();
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &journal);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
}

#[test]
fn contract_rejects_bad_compliance_root_journal() {
    let s = setup();
    let mut journal = valid_journal();
    journal.compliance_root =
        "0x8888888888888888888888888888888888888888888888888888888888888888".to_owned();
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &journal);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
}

#[test]
fn contract_rejects_wrong_destination_journal() {
    let s = setup();
    let mut journal = valid_journal();
    journal.destination_chain_id = 1_502;
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &journal);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
}

#[test]
fn contract_rejects_malformed_public_outputs() {
    let s = setup();

    let mut zero_note = valid_journal();
    zero_note.stellar_note_commitment =
        "0x0000000000000000000000000000000000000000000000000000000000000000".to_owned();
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &zero_note);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());

    let mut wrong_bucket = valid_journal();
    wrong_bucket.amount_bucket += 1;
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &wrong_bucket);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
}

#[test]
fn contract_rejects_unregistered_source_and_root_from_journal() {
    let s = setup();
    let (seal, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let other = Address::generate(&s.env);
    let contract_id = s.env.register(NebulaRelay, ());
    let client = NebulaRelayClient::new(&s.env, &contract_id);
    let witness = load_witness(fixture("valid-lock.json")).unwrap();
    client.initialize(
        &s.admin,
        &s.verifier_router,
        &other,
        &s.cctp_forwarder,
        &hex32(&s.env, &witness.expected.cctp_mint_recipient),
        &BytesN::from_array(&s.env, &TEST_IMAGE_ID),
        &other,
        &hex32(&s.env, &witness.expected.network_domain),
    );
    assert!(client
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
}

#[test]
fn paused_claim_fails() {
    let s = setup();
    let (seal, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.client().pause(&s.admin);
    assert!(s
        .client()
        .try_claim(
            &s.claimant,
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &Bytes::new(&s.env),
        )
        .is_err());
}
