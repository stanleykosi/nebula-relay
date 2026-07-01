extern crate std;

use super::cctp_forwarder::CctpForwarderError;
use super::private_pool::{
    Groth16Proof, PrivatePoolDeposit, PrivatePoolError, PrivatePoolExtData, PrivatePoolProof,
};
use super::verifier_router::VerifierError;
use super::*;
use nebula_risc0_shared::{
    encode_journal, journal_digest, load_witness, validate_witness, NebulaJournal,
};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    crypto::bn254::{Bn254G1Affine, Bn254G2Affine},
    testutils::{Address as _, Ledger as _},
    Address, Bytes, Env, Vec, I256, U256,
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
enum CctpHarnessKey {
    ExpectedMessage,
    ExpectedAttestation,
    ShouldFail,
    Called,
    LastMessage,
    LastAttestation,
}

#[contracttype]
#[derive(Clone)]
enum PrivatePoolHarnessKey {
    ExpectedSender,
    ExpectedRecipient,
    ExpectedAmount,
    ExpectedPublicAmount,
    ShouldFail,
    Called,
    LastSender,
    LastRecipient,
    LastExtAmount,
    LastPublicAmount,
    LastOutputCommitment0,
    LastOutputCommitment1,
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

#[contract]
struct PrivatePoolHarness;

#[contractimpl]
impl PrivatePoolHarness {
    pub fn configure(
        env: Env,
        expected_sender: Address,
        expected_recipient: Address,
        expected_amount: i128,
        expected_public_amount: U256,
        should_fail: bool,
    ) {
        env.storage()
            .temporary()
            .set(&PrivatePoolHarnessKey::ExpectedSender, &expected_sender);
        env.storage().temporary().set(
            &PrivatePoolHarnessKey::ExpectedRecipient,
            &expected_recipient,
        );
        env.storage()
            .temporary()
            .set(&PrivatePoolHarnessKey::ExpectedAmount, &expected_amount);
        env.storage().temporary().set(
            &PrivatePoolHarnessKey::ExpectedPublicAmount,
            &expected_public_amount,
        );
        env.storage()
            .temporary()
            .set(&PrivatePoolHarnessKey::ShouldFail, &should_fail);
        env.storage()
            .temporary()
            .set(&PrivatePoolHarnessKey::Called, &false);
    }

    pub fn transact(
        env: Env,
        proof: PrivatePoolProof,
        ext_data: PrivatePoolExtData,
        sender: Address,
    ) -> Result<(), PrivatePoolError> {
        env.storage()
            .temporary()
            .set(&PrivatePoolHarnessKey::Called, &true);
        env.storage()
            .temporary()
            .set(&PrivatePoolHarnessKey::LastSender, &sender);
        env.storage()
            .temporary()
            .set(&PrivatePoolHarnessKey::LastRecipient, &ext_data.recipient);
        env.storage()
            .temporary()
            .set(&PrivatePoolHarnessKey::LastExtAmount, &ext_data.ext_amount);
        env.storage().temporary().set(
            &PrivatePoolHarnessKey::LastPublicAmount,
            &proof.public_amount,
        );
        env.storage().temporary().set(
            &PrivatePoolHarnessKey::LastOutputCommitment0,
            &proof.output_commitment0,
        );
        env.storage().temporary().set(
            &PrivatePoolHarnessKey::LastOutputCommitment1,
            &proof.output_commitment1,
        );

        if env
            .storage()
            .temporary()
            .get(&PrivatePoolHarnessKey::ShouldFail)
            .unwrap_or(false)
        {
            return Err(PrivatePoolError::InvalidProof);
        }

        let expected_sender: Address = env
            .storage()
            .temporary()
            .get(&PrivatePoolHarnessKey::ExpectedSender)
            .ok_or(PrivatePoolError::NotAuthorized)?;
        let expected_recipient: Address = env
            .storage()
            .temporary()
            .get(&PrivatePoolHarnessKey::ExpectedRecipient)
            .ok_or(PrivatePoolError::NotAuthorized)?;
        let expected_amount: i128 = env
            .storage()
            .temporary()
            .get(&PrivatePoolHarnessKey::ExpectedAmount)
            .ok_or(PrivatePoolError::WrongExtAmount)?;
        let expected_public_amount: U256 = env
            .storage()
            .temporary()
            .get(&PrivatePoolHarnessKey::ExpectedPublicAmount)
            .ok_or(PrivatePoolError::WrongExtAmount)?;

        if sender != expected_sender
            || ext_data.recipient != expected_recipient
            || ext_data.ext_amount.to_i128() != Some(expected_amount)
            || proof.public_amount != expected_public_amount
        {
            return Err(PrivatePoolError::WrongExtAmount);
        }

        Ok(())
    }

    pub fn was_called(env: Env) -> bool {
        env.storage()
            .temporary()
            .get(&PrivatePoolHarnessKey::Called)
            .unwrap_or(false)
    }

    pub fn last_sender(env: Env) -> Option<Address> {
        env.storage()
            .temporary()
            .get(&PrivatePoolHarnessKey::LastSender)
    }

    pub fn last_recipient(env: Env) -> Option<Address> {
        env.storage()
            .temporary()
            .get(&PrivatePoolHarnessKey::LastRecipient)
    }

    pub fn last_ext_amount(env: Env) -> Option<I256> {
        env.storage()
            .temporary()
            .get(&PrivatePoolHarnessKey::LastExtAmount)
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
    private_pool: Address,
    cctp_forwarder: Address,
    admin: Address,
}

impl Setup {
    fn client(&self) -> NebulaRelayClient<'_> {
        NebulaRelayClient::new(&self.env, &self.contract_id)
    }

    fn router(&self) -> RouterHarnessClient<'_> {
        RouterHarnessClient::new(&self.env, &self.verifier_router)
    }

    fn private_pool(&self) -> PrivatePoolHarnessClient<'_> {
        PrivatePoolHarnessClient::new(&self.env, &self.private_pool)
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

    fn configure_private_pool_from_journal(&self, journal: &NebulaJournal, should_fail: bool) {
        let amount = journal.settlement_amount.parse::<i128>().unwrap();
        self.private_pool().configure(
            &self.contract_id,
            &self.private_pool,
            &amount,
            &u256_from_i128_test(&self.env, amount),
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

fn u256_from_i128_test(env: &Env, amount: i128) -> U256 {
    U256::from_be_bytes(env, &I256::from_i128(env, amount).to_be_bytes())
}

fn u256_from_bytes32_test(env: &Env, value: &BytesN<32>) -> U256 {
    U256::from_be_bytes(env, &Bytes::from(value.clone()))
}

fn private_pool_deposit(
    env: &Env,
    private_pool: &Address,
    amount: i128,
    note_commitment: &BytesN<32>,
) -> PrivatePoolDeposit {
    PrivatePoolDeposit {
        proof: PrivatePoolProof {
            proof: Groth16Proof {
                a: Bn254G1Affine::from_bytes(BytesN::from_array(env, &[1u8; 64])),
                b: Bn254G2Affine::from_bytes(BytesN::from_array(env, &[2u8; 128])),
                c: Bn254G1Affine::from_bytes(BytesN::from_array(env, &[3u8; 64])),
            },
            root: U256::from_u32(env, 1),
            input_nullifiers: Vec::new(env),
            output_commitment0: u256_from_bytes32_test(env, note_commitment),
            output_commitment1: U256::from_u32(env, 8),
            public_amount: u256_from_i128_test(env, amount),
            ext_data_hash: BytesN::from_array(env, &[9u8; 32]),
            asp_membership_root: U256::from_u32(env, 11),
            asp_non_membership_root: U256::from_u32(env, 12),
        },
        ext_data: PrivatePoolExtData {
            recipient: private_pool.clone(),
            ext_amount: I256::from_i128(env, amount),
            encrypted_output0: Bytes::from_slice(env, b"encrypted-output-0"),
            encrypted_output1: Bytes::from_slice(env, b"encrypted-output-1"),
        },
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
    let private_pool = env.register(PrivatePoolHarness, ());
    let cctp_forwarder = env.register(CctpForwarderHarness, ());

    let contract_id = env.register(NebulaRelay, ());
    let client = NebulaRelayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let asset = Address::generate(&env);
    let witness = load_witness(fixture("valid-lock.json")).unwrap();

    client.initialize(
        &admin,
        &verifier_router,
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
    client.set_private_pool(&admin, &private_pool);

    let setup = Setup {
        env,
        contract_id,
        verifier_router,
        private_pool,
        cctp_forwarder,
        admin,
    };
    setup.configure_private_pool_from_journal(&valid_journal(), false);
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

fn private_deposit_for_journal(setup: &Setup, journal: &NebulaJournal) -> PrivatePoolDeposit {
    let amount = journal.settlement_amount.parse::<i128>().unwrap();
    let note_commitment = hex32(&setup.env, &journal.stellar_note_commitment);
    private_pool_deposit(&setup.env, &setup.private_pool, amount, &note_commitment)
}

#[test]
fn private_pool_claim_stores_nullifier_without_claimant_record() {
    let s = setup();
    let client = s.client();
    let model = valid_journal();
    let amount = model.settlement_amount.parse::<i128>().unwrap();
    let note_commitment = hex32(&s.env, &model.stellar_note_commitment);
    let private_deposit = private_pool_deposit(&s.env, &s.private_pool, amount, &note_commitment);
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let expected_digest = s.configure_router(&seal, &image_id, &journal, false);
    s.configure_private_pool_from_journal(&model, false);

    let receipt = client.claim_to_private_pool(
        &seal,
        &image_id,
        &journal,
        &cctp_message(&s.env),
        &cctp_attestation(&s.env),
        &private_deposit,
    );

    assert_eq!(receipt.nullifier, nullifier);
    assert_eq!(receipt.settlement_amount, amount);
    assert_eq!(receipt.private_pool, s.private_pool);
    assert!(client.is_claimed(&nullifier));
    let record = client.get_private_claim(&nullifier).unwrap();
    assert_eq!(record.settlement_amount, amount);
    assert_eq!(record.private_pool, s.private_pool);
    assert_eq!(
        record.pool_output_commitment0,
        private_deposit.proof.output_commitment0
    );
    assert_eq!(s.private_pool().was_called(), true);
    assert_eq!(s.private_pool().last_sender(), Some(s.contract_id.clone()));
    assert_eq!(
        s.private_pool().last_recipient(),
        Some(s.private_pool.clone())
    );
    assert_eq!(
        s.private_pool().last_ext_amount().unwrap().to_i128(),
        Some(amount)
    );
    assert_eq!(s.router().last_journal_digest(), Some(expected_digest));
    assert!(s.cctp().was_called());
}

#[test]
fn private_pool_replay_fails_without_second_pool_call() {
    let s = setup();
    let client = s.client();
    let model = valid_journal();
    let amount = model.settlement_amount.parse::<i128>().unwrap();
    let note_commitment = hex32(&s.env, &model.stellar_note_commitment);
    let private_deposit = private_pool_deposit(&s.env, &s.private_pool, amount, &note_commitment);
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, false);
    s.configure_private_pool_from_journal(&model, false);

    client.claim_to_private_pool(
        &seal,
        &image_id,
        &journal,
        &cctp_message(&s.env),
        &cctp_attestation(&s.env),
        &private_deposit,
    );

    assert!(client
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
    assert!(client.is_claimed(&nullifier));
}

#[test]
fn private_pool_wrong_amount_fails_before_cctp_settlement() {
    let s = setup();
    let client = s.client();
    let model = valid_journal();
    let amount = model.settlement_amount.parse::<i128>().unwrap();
    let note_commitment = hex32(&s.env, &model.stellar_note_commitment);
    let wrong_deposit =
        private_pool_deposit(&s.env, &s.private_pool, amount - 1, &note_commitment);
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, false);
    s.configure_private_pool_from_journal(&model, false);

    assert!(client
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &wrong_deposit,
        )
        .is_err());
    assert!(!s.cctp().was_called());
    assert!(!s.private_pool().was_called());
    assert!(!client.is_claimed(&nullifier));
}

#[test]
fn private_pool_wrong_note_commitment_fails_before_cctp_settlement() {
    let s = setup();
    let client = s.client();
    let model = valid_journal();
    let amount = model.settlement_amount.parse::<i128>().unwrap();
    let wrong_note = BytesN::from_array(&s.env, &[0x99; 32]);
    let wrong_deposit = private_pool_deposit(&s.env, &s.private_pool, amount, &wrong_note);
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, false);
    s.configure_private_pool_from_journal(&model, false);

    assert!(client
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &wrong_deposit,
        )
        .is_err());
    assert!(!s.cctp().was_called());
    assert!(!s.private_pool().was_called());
    assert!(!client.is_claimed(&nullifier));
}

#[test]
fn private_pool_failure_rolls_back_nullifier_storage() {
    let s = setup();
    let client = s.client();
    let model = valid_journal();
    let amount = model.settlement_amount.parse::<i128>().unwrap();
    let note_commitment = hex32(&s.env, &model.stellar_note_commitment);
    let private_deposit = private_pool_deposit(&s.env, &s.private_pool, amount, &note_commitment);
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, false);
    s.configure_private_pool_from_journal(&model, true);

    assert!(client
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
    assert!(!client.is_claimed(&nullifier));
    assert!(client.get_private_claim(&nullifier).is_none());
}

#[test]
fn cctp_settlement_failure_rolls_back_before_private_pool_and_storage() {
    let s = setup();
    let client = s.client();
    let model = valid_journal();
    let private_deposit = private_deposit_for_journal(&s, &model);
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, false);
    s.configure_cctp(true);

    assert!(client
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
    assert!(!s.private_pool().was_called());
    assert!(!client.is_claimed(&nullifier));
}

#[test]
fn wrong_cctp_message_or_attestation_fails_before_private_pool() {
    let s = setup();
    let client = s.client();
    let model = valid_journal();
    let private_deposit = private_deposit_for_journal(&s, &model);
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, false);

    assert!(client
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &bytes_from_hex(&s.env, "0xff"),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
    assert!(!s.cctp().was_called());
    assert!(!s.private_pool().was_called());
    assert!(!client.is_claimed(&nullifier));
}

#[test]
fn wrong_cctp_destination_or_mint_recipient_journal_fails() {
    let s = setup();

    let mut wrong_domain = valid_journal();
    wrong_domain.cctp_destination_domain = 26;
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &wrong_domain);
    let private_deposit = private_deposit_for_journal(&s, &wrong_domain);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());

    let mut wrong_recipient = valid_journal();
    wrong_recipient.cctp_mint_recipient =
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd".to_owned();
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &wrong_recipient);
    let private_deposit = private_deposit_for_journal(&s, &wrong_recipient);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
}

#[test]
fn replay_fails() {
    let s = setup();
    let client = s.client();
    let model = valid_journal();
    let private_deposit = private_deposit_for_journal(&s, &model);
    let (seal, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, false);
    client.claim_to_private_pool(
        &seal,
        &image_id,
        &journal,
        &cctp_message(&s.env),
        &cctp_attestation(&s.env),
        &private_deposit,
    );
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
}

#[test]
fn wrong_image_id_fails() {
    let s = setup();
    let model = valid_journal();
    let private_deposit = private_deposit_for_journal(&s, &model);
    let (seal, _, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let bad_image = BytesN::from_array(&s.env, &[9u8; 32]);
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &bad_image,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit
        )
        .is_err());
}

#[test]
fn tampered_seal_fails() {
    let s = setup();
    let model = valid_journal();
    let private_deposit = private_deposit_for_journal(&s, &model);
    let (_, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let seal = bytes_from_hex(
        &s.env,
        "0x4e4542554c415f4445565f5345414c5f56310000000000000000000000000000000000000000000000000000000000000000",
    );
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
}

#[test]
fn router_rejects_wrong_journal_digest() {
    let s = setup();
    let model = valid_journal();
    let private_deposit = private_deposit_for_journal(&s, &model);
    let (seal, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let wrong_digest = BytesN::from_array(&s.env, &[9u8; 32]);
    s.configure_router_with_digest(&seal, &image_id, &wrong_digest, false);

    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
}

#[test]
fn router_error_fails_before_private_pool_and_storage() {
    let s = setup();
    let model = valid_journal();
    let private_deposit = private_deposit_for_journal(&s, &model);
    let (seal, image_id, journal, nullifier) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.configure_router(&seal, &image_id, &journal, true);

    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
    assert!(!s.private_pool().was_called());
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
    let private_deposit = private_deposit_for_journal(&s, &journal);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
}

#[test]
fn contract_rejects_wrong_escrow_journal() {
    let s = setup();
    let mut journal = valid_journal();
    journal.escrow_contract = "0x2222222222222222222222222222222222222222".to_owned();
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &journal);
    let private_deposit = private_deposit_for_journal(&s, &journal);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
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
    let private_deposit = private_deposit_for_journal(&s, &journal);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
}

#[test]
fn contract_rejects_wrong_destination_journal() {
    let s = setup();
    let mut journal = valid_journal();
    journal.destination_chain_id = 1_502;
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &journal);
    let private_deposit = private_deposit_for_journal(&s, &journal);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
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
    let private_deposit = private_deposit_for_journal(&s, &zero_note);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());

    let mut wrong_bucket = valid_journal();
    wrong_bucket.amount_bucket += 1;
    let (seal, image_id, journal_bytes) = signed_journal(&s.env, &wrong_bucket);
    let private_deposit = private_deposit_for_journal(&s, &wrong_bucket);
    s.configure_router(&seal, &image_id, &journal_bytes, false);
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal_bytes,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
}

#[test]
fn contract_rejects_unregistered_source_and_root_from_journal() {
    let s = setup();
    let (seal, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    let model = valid_journal();
    let private_deposit = private_deposit_for_journal(&s, &model);
    let other = Address::generate(&s.env);
    let contract_id = s.env.register(NebulaRelay, ());
    let client = NebulaRelayClient::new(&s.env, &contract_id);
    let witness = load_witness(fixture("valid-lock.json")).unwrap();
    client.initialize(
        &s.admin,
        &s.verifier_router,
        &s.cctp_forwarder,
        &hex32(&s.env, &witness.expected.cctp_mint_recipient),
        &BytesN::from_array(&s.env, &TEST_IMAGE_ID),
        &other,
        &hex32(&s.env, &witness.expected.network_domain),
    );
    assert!(client
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
}

#[test]
fn paused_claim_fails() {
    let s = setup();
    let model = valid_journal();
    let private_deposit = private_deposit_for_journal(&s, &model);
    let (seal, image_id, journal, _) = artifact_parts(&s.env, &fixture("valid-lock.json"));
    s.client().pause(&s.admin);
    assert!(s
        .client()
        .try_claim_to_private_pool(
            &seal,
            &image_id,
            &journal,
            &cctp_message(&s.env),
            &cctp_attestation(&s.env),
            &private_deposit,
        )
        .is_err());
}
