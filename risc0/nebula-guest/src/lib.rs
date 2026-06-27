use nebula_risc0_shared::{validate_witness, LockWitness, NebulaError, NebulaJournal};

pub fn execute_guest(witness: &LockWitness) -> Result<NebulaJournal, NebulaError> {
    validate_witness(witness)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nebula_risc0_shared::load_witness;

    fn fixture(name: &str) -> String {
        format!("{}/../../fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn guest_accepts_valid_witness() {
        let witness = load_witness(fixture("valid-lock.json")).unwrap();
        let journal = execute_guest(&witness).unwrap();
        assert_eq!(journal.source_chain_id, 11155111);
        assert_eq!(journal.destination_chain_id, 1501);
    }

    #[test]
    fn guest_rejects_invalid_witnesses() {
        for name in [
            "wrong-token.json",
            "wrong-escrow.json",
            "bad-compliance.json",
            "wrong-destination.json",
        ] {
            let witness = load_witness(fixture(name)).unwrap();
            assert!(execute_guest(&witness).is_err(), "{name} should fail");
        }
    }
}
