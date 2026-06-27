use chrono::{SecondsFormat, Utc};
use nebula_guest::execute_guest;
use nebula_risc0_shared::{
    bytes_to_hex, dev_seal, encode_journal, image_id_hex, journal_digest, load_witness, to_hex_32,
    witness_hash, NebulaError, ProofArtifact, ProofMode,
};
use std::{fs, path::Path};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HostError {
    #[error(transparent)]
    Nebula(#[from] NebulaError),
    #[error("proof mode {0} is documented but not implemented in this milestone")]
    UnsupportedMode(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn prove_fixture(
    fixture: impl AsRef<Path>,
    mode: &str,
    out: impl AsRef<Path>,
) -> Result<ProofArtifact, HostError> {
    if mode != "dev" {
        return Err(HostError::UnsupportedMode(mode.to_owned()));
    }

    let witness = load_witness(fixture)?;
    let journal = execute_guest(&witness)?;
    let journal_bytes = encode_journal(&journal)?;
    let digest = journal_digest(&journal_bytes);
    let seal = dev_seal(&digest);
    let artifact = ProofArtifact {
        version: 1,
        proof_mode: ProofMode::Dev,
        seal_hex: bytes_to_hex(&seal),
        image_id_hex: image_id_hex(),
        journal_hex: bytes_to_hex(&journal_bytes),
        journal_digest_hex: to_hex_32(&digest),
        public_outputs: journal,
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        witness_hash: to_hex_32(&witness_hash(&witness)?),
    };

    if let Some(parent) = out.as_ref().parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(out, serde_json::to_vec_pretty(&artifact)?)?;
    Ok(artifact)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        format!("{}/../../fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn writes_dev_artifact() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("proof.json");
        let artifact = prove_fixture(fixture("valid-lock.json"), "dev", &out).unwrap();
        assert!(out.exists());
        assert_eq!(artifact.proof_mode, ProofMode::Dev);
        assert!(artifact
            .seal_hex
            .starts_with("0x4e4542554c415f4445565f5345414c5f5631"));
    }

    #[test]
    fn invalid_fixture_fails() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("proof.json");
        assert!(prove_fixture(fixture("wrong-token.json"), "dev", &out).is_err());
    }

    #[test]
    fn non_dev_modes_are_documented_placeholders() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("proof.json");
        assert!(matches!(
            prove_fixture(fixture("valid-lock.json"), "local-groth16", &out),
            Err(HostError::UnsupportedMode(_))
        ));
    }
}
