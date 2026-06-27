extern crate std;

use super::verifier_router::VerifierError;
use super::*;
use nebula_risc0_shared::{
    encode_journal, journal_digest, load_witness, validate_witness, NebulaJournal, DEV_IMAGE_ID,
    DEV_SEAL_PREFIX,
};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger as _},
    Address, Bytes, Env,
};
use std::{borrow::ToOwned, format, string::String};

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

fn fixture(name: &str) -> String {
    format!("{}/../../../fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

struct Setup {
    env: Env,
    contract_id: Address,
    verifier_router: Address,
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

    let contract_id = env.register(NebulaRelay, ());
    let client = NebulaRelayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let adapter = Address::generate(&env);
    let asset = Address::generate(&env);
    let witness = load_witness(fixture("valid-lock.json")).unwrap();

    client.initialize(
        &admin,
        &verifier_router,
        &adapter,
        &BytesN::from_array(&env, &DEV_IMAGE_ID),
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

    Setup {
        env,
        contract_id,
        verifier_router,
        admin,
        claimant,
    }
}

fn artifact_parts(env: &Env, fixture: &str) -> (Bytes, BytesN<32>, Bytes, BytesN<32>) {
    let witness = load_witness(fixture).unwrap();
    let journal = validate_witness(&witness).unwrap();
    let journal_bytes = encode_journal(&journal).unwrap();
    let digest = journal_digest(&journal_bytes);
    let mut seal = std::vec::Vec::new();
    seal.extend_from_slice(DEV_SEAL_PREFIX);
    seal.extend_from_slice(&digest);
    (
        Bytes::from_slice(env, &seal),
        BytesN::from_array(env, &DEV_IMAGE_ID),
        Bytes::from_slice(env, &journal_bytes),
        hex32(env, &journal.claim_nullifier),
    )
}

fn signed_journal(env: &Env, journal: &NebulaJournal) -> (Bytes, BytesN<32>, Bytes) {
    let journal_bytes = encode_journal(journal).unwrap();
    let digest = journal_digest(&journal_bytes);
    let mut seal = std::vec::Vec::new();
    seal.extend_from_slice(DEV_SEAL_PREFIX);
    seal.extend_from_slice(&digest);
    (
        Bytes::from_slice(env, &seal),
        BytesN::from_array(env, &DEV_IMAGE_ID),
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
    let receipt = client.claim(&s.claimant, &seal, &image_id, &journal, &Bytes::new(&s.env));

    assert_eq!(receipt.nullifier, nullifier);
    assert!(client.is_claimed(&nullifier));
    let record = client.get_claim(&nullifier).unwrap();
    assert_eq!(record.amount, 100_000_000);
    assert_eq!(s.router().last_journal_digest(), Some(expected_digest));
}

#[test]
fn replay_fails() {
    let s = setup();
    let client = s.client();
    let (seal, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, false);
    client.claim(&s.claimant, &seal, &image_id, &journal, &Bytes::new(&s.env));
    assert!(s
        .client()
        .try_claim(&s.claimant, &seal, &image_id, &journal, &Bytes::new(&s.env))
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
        .try_claim(&s.claimant, &seal, &image_id, &journal, &Bytes::new(&s.env))
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
        .try_claim(&s.claimant, &seal, &image_id, &journal, &Bytes::new(&s.env))
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
        &BytesN::from_array(&s.env, &DEV_IMAGE_ID),
        &other,
        &hex32(&s.env, &witness.expected.network_domain),
    );
    assert!(client
        .try_claim(&s.claimant, &seal, &image_id, &journal, &Bytes::new(&s.env))
        .is_err());
}

#[test]
fn paused_claim_fails() {
    let s = setup();
    let (seal, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.client().pause(&s.admin);
    assert!(s
        .client()
        .try_claim(&s.claimant, &seal, &image_id, &journal, &Bytes::new(&s.env))
        .is_err());
}

#[cfg(feature = "dev-mock-verifier")]
fn setup_dev_mock() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let contract_id = env.register(NebulaRelay, ());
    let client = NebulaRelayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let verifier_router = Address::generate(&env);
    let adapter = Address::generate(&env);
    let asset = Address::generate(&env);
    let witness = load_witness(fixture("valid-lock.json")).unwrap();

    client.initialize(
        &admin,
        &verifier_router,
        &adapter,
        &BytesN::from_array(&env, &DEV_IMAGE_ID),
        &asset,
        &hex32(&env, &witness.expected.network_domain),
    );
    client.set_dev_mock_verifier(&admin, &true);
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

    Setup {
        env,
        contract_id,
        verifier_router,
        admin,
        claimant,
    }
}

#[cfg(feature = "dev-mock-verifier")]
#[test]
fn explicit_dev_mock_verifier_still_accepts_stage_6_artifact() {
    let s = setup_dev_mock();
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let receipt = s
        .client()
        .claim(&s.claimant, &seal, &image_id, &journal, &Bytes::new(&s.env));

    assert_eq!(receipt.nullifier, nullifier);
    assert!(s.client().is_claimed(&nullifier));
}
