extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::SorobanAuthorizationEntry,
    Address, Bytes, BytesN, Env, IntoVal,
};

struct Setup {
    env: Env,
    contract_id: Address,
    relay: Address,
    claimant: Address,
}

impl Setup {
    fn client(&self) -> NebulaPoolAdapterClient<'_> {
        NebulaPoolAdapterClient::new(&self.env, &self.contract_id)
    }
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(NebulaPoolAdapter, ());
    let client = NebulaPoolAdapterClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let relay = Address::generate(&env);
    let claimant = Address::generate(&env);
    client.initialize(&admin);
    client.set_relay(&admin, &relay);
    env.set_auths(&[] as &[SorobanAuthorizationEntry]);
    Setup {
        env,
        contract_id,
        relay,
        claimant,
    }
}

fn bytes32(env: &Env, value: u8) -> BytesN<32> {
    BytesN::from_array(env, &[value; 32])
}

fn mock_relay_credit_auth(
    s: &Setup,
    asset: &Address,
    note: &BytesN<32>,
    amount: i128,
    nullifier: &BytesN<32>,
    event_commitment: &BytesN<32>,
    payload: &Bytes,
) {
    s.env.mock_auths(&[MockAuth {
        address: &s.relay,
        invoke: &MockAuthInvoke {
            contract: &s.contract_id,
            fn_name: "credit_note_from_relay",
            args: (
                &s.relay,
                &s.claimant,
                note,
                amount,
                asset,
                nullifier,
                event_commitment,
                payload,
            )
                .into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
}

#[test]
fn initialize_sets_admin_and_rejects_reinitialization() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(NebulaPoolAdapter, ());
    let client = NebulaPoolAdapterClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&admin);

    assert_eq!(client.get_admin(), Some(admin.clone()));
    assert!(client.try_initialize(&admin).is_err());
}

#[test]
fn set_relay_requires_stored_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(NebulaPoolAdapter, ());
    let client = NebulaPoolAdapterClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let other = Address::generate(&env);
    let relay = Address::generate(&env);
    client.initialize(&admin);

    assert!(client.try_set_relay(&other, &relay).is_err());

    client.set_relay(&admin, &relay);
    assert_eq!(client.get_relay(), Some(relay));
}

#[test]
fn credit_note_records_private_note_handoff() {
    let s = setup();
    let client = s.client();
    let asset = Address::generate(&s.env);
    let note = bytes32(&s.env, 1);
    let nullifier = bytes32(&s.env, 2);
    let event_commitment = bytes32(&s.env, 3);
    let payload = Bytes::from_slice(&s.env, b"private-note-compatible-handoff");
    let payload_hash: BytesN<32> = s.env.crypto().sha256(&payload).into();

    assert!(client
        .try_credit_note_from_relay(
            &s.relay,
            &s.claimant,
            &note,
            &100_000_000,
            &asset,
            &nullifier,
            &event_commitment,
            &payload,
        )
        .is_err());
    assert!(!client.is_credited(&nullifier));

    mock_relay_credit_auth(
        &s,
        &asset,
        &note,
        100_000_000,
        &nullifier,
        &event_commitment,
        &payload,
    );
    client.credit_note_from_relay(
        &s.relay,
        &s.claimant,
        &note,
        &100_000_000,
        &asset,
        &nullifier,
        &event_commitment,
        &payload,
    );

    assert!(client.is_credited(&nullifier));
    let by_nullifier = client.get_credit_by_nullifier(&nullifier).unwrap();
    let by_note = client.get_credit_by_note(&note).unwrap();
    assert_eq!(by_nullifier, by_note);
    assert_eq!(by_nullifier.relay, s.relay);
    assert_eq!(by_nullifier.claimant, s.claimant);
    assert_eq!(by_nullifier.note_commitment, note);
    assert_eq!(by_nullifier.amount, 100_000_000);
    assert_eq!(by_nullifier.asset, asset);
    assert_eq!(by_nullifier.event_commitment, event_commitment);
    assert_eq!(by_nullifier.payload_hash, payload_hash);
    assert_eq!(by_nullifier.payload_len, payload.len());
}

#[test]
fn wrong_relay_and_invalid_handoff_fail() {
    let s = setup();
    let client = s.client();
    let wrong_relay = Address::generate(&s.env);
    let asset = Address::generate(&s.env);
    let note = bytes32(&s.env, 1);
    let nullifier = bytes32(&s.env, 2);
    let event_commitment = bytes32(&s.env, 3);
    let payload = Bytes::new(&s.env);

    assert!(client
        .try_credit_note_from_relay(
            &wrong_relay,
            &s.claimant,
            &note,
            &1,
            &asset,
            &nullifier,
            &event_commitment,
            &payload,
        )
        .is_err());

    let zero_note = BytesN::from_array(&s.env, &[0u8; 32]);
    mock_relay_credit_auth(
        &s,
        &asset,
        &zero_note,
        1,
        &nullifier,
        &event_commitment,
        &payload,
    );
    assert!(client
        .try_credit_note_from_relay(
            &s.relay,
            &s.claimant,
            &zero_note,
            &1,
            &asset,
            &nullifier,
            &event_commitment,
            &payload,
        )
        .is_err());
    mock_relay_credit_auth(
        &s,
        &asset,
        &note,
        0,
        &nullifier,
        &event_commitment,
        &payload,
    );
    assert!(client
        .try_credit_note_from_relay(
            &s.relay,
            &s.claimant,
            &note,
            &0,
            &asset,
            &nullifier,
            &event_commitment,
            &payload,
        )
        .is_err());
}

#[test]
fn duplicate_note_or_nullifier_fails() {
    let s = setup();
    let client = s.client();
    let asset = Address::generate(&s.env);
    let note = bytes32(&s.env, 1);
    let nullifier = bytes32(&s.env, 2);
    let event_commitment = bytes32(&s.env, 3);
    let payload = Bytes::new(&s.env);

    mock_relay_credit_auth(
        &s,
        &asset,
        &note,
        100,
        &nullifier,
        &event_commitment,
        &payload,
    );
    client.credit_note_from_relay(
        &s.relay,
        &s.claimant,
        &note,
        &100,
        &asset,
        &nullifier,
        &event_commitment,
        &payload,
    );

    let second_nullifier = bytes32(&s.env, 4);
    mock_relay_credit_auth(
        &s,
        &asset,
        &note,
        100,
        &second_nullifier,
        &event_commitment,
        &payload,
    );
    assert!(client
        .try_credit_note_from_relay(
            &s.relay,
            &s.claimant,
            &note,
            &100,
            &asset,
            &second_nullifier,
            &event_commitment,
            &payload,
        )
        .is_err());
    let second_note = bytes32(&s.env, 5);
    mock_relay_credit_auth(
        &s,
        &asset,
        &second_note,
        100,
        &nullifier,
        &event_commitment,
        &payload,
    );
    assert!(client
        .try_credit_note_from_relay(
            &s.relay,
            &s.claimant,
            &second_note,
            &100,
            &asset,
            &nullifier,
            &event_commitment,
            &payload,
        )
        .is_err());
}
