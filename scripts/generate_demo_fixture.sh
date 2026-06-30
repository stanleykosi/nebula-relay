#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${NEBULA_ARTIFACT_DIR:-$ROOT_DIR/artifacts/demo}"
WITNESS_PATH="${NEBULA_WITNESS_FIXTURE:-$ROOT_DIR/fixtures/valid-lock.json}"
PROOF_PATH="${NEBULA_PROOF_ARTIFACT:-$ROOT_DIR/artifacts/remote-proof.json}"
SUBMISSION_PATH="${NEBULA_DEMO_SUBMISSION:-$ARTIFACT_DIR/demo-submission.json}"
AUDITOR_PACKET_PATH="${NEBULA_AUDITOR_PACKET:-$ARTIFACT_DIR/auditor-packet.json}"
PROOF_MODE="${RISC0_PROVER_MODE:-remote}"

mkdir -p "$ARTIFACT_DIR"

if [ ! -f "$PROOF_PATH" ]; then
  echo "Proof artifact not found at $PROOF_PATH"
  case "$PROOF_MODE" in
    remote|local-groth16)
      echo "Generating a $PROOF_MODE proof artifact from $WITNESS_PATH"
      (cd "$ROOT_DIR" && cargo run -p nebula-host -- prove --fixture "$WITNESS_PATH" --mode "$PROOF_MODE" --out "$PROOF_PATH")
      ;;
    *)
      echo "Unsupported RISC0_PROVER_MODE=$PROOF_MODE; use remote or local-groth16." >&2
      exit 1
      ;;
  esac
fi

node - "$WITNESS_PATH" "$PROOF_PATH" "$SUBMISSION_PATH" "$AUDITOR_PACKET_PATH" <<'NODE'
const fs = require("fs");
const path = require("path");

const [witnessPath, proofPath, submissionPath, auditorPacketPath] = process.argv.slice(2);
const witness = readJson(witnessPath);
const proof = readJson(proofPath);

assertProofMatchesWitness(witness, proof);

const stellarClaimTxHash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const auditorPacket = {
  version: 1,
  sourceChainId: witness.sourceChainId,
  sourceTxHash: witness.txHash,
  sourceLogIndex: witness.logIndex,
  stellarClaimTxHash,
  noteCommitment: witness.stellarNoteCommitment,
  claimNullifier: proof.publicOutputs.claimNullifier,
  eventCommitment: proof.publicOutputs.eventCommitment,
  proofImageId: proof.imageIdHex,
  journalDigest: proof.journalDigestHex,
  cctpMessageHash: proof.publicOutputs.cctpMessageHash,
  cctpAttestationHash: proof.publicOutputs.cctpAttestationHash,
  cctpNonce: proof.publicOutputs.cctpNonce,
  disclosureMode: "user-exported",
  caveats: buildCaveats(proof.proofMode),
  verificationInstructions: [
    {
      title: "Validate packet schema",
      description:
        "Parse the JSON with @nebula/core AuditorPacketSchema before relying on any field.",
      expected:
        "The packet has version 1, required hashes, at least one caveat, and verification instructions.",
    },
    {
      title: "Confirm CCTP settlement",
      description:
        "Compare the CCTP message hash, attestation hash, and nonce against the Circle Iris message used for the Stellar mint.",
      expected:
        "The Nebula journal and auditor packet bind to the same CCTP burn/mint message.",
    },
    {
      title: "Confirm source lock",
      description:
        "Compare sourceChainId, sourceTxHash, and sourceLogIndex against the source-chain receipt or deterministic fixture.",
      expected:
        "The referenced log is the canonical NebulaEscrow Locked event for this claim.",
    },
    {
      title: "Confirm proof binding",
      description:
        "Compare proofImageId and journalDigest against the proof artifact supplied to NebulaRelay.",
      expected:
        "The proof artifact commits to the same note commitment, nullifier, event commitment, and compliance root.",
    },
    {
      title: "Confirm Stellar claim",
      description:
        "Check the Stellar claim transaction when one is present, then confirm the nullifier is stored once.",
      expected:
        "A replay with the same claimNullifier fails with NebulaRelay's replay protection.",
    },
    {
      title: "Review disclosure caveats",
      description:
        "Read every caveat before treating this as audit evidence.",
      expected:
        "The packet is user-controlled selective disclosure, not production view-key disclosure.",
    },
  ],
};

const submission = {
  version: 1,
  generatedAt: proof.generatedAt,
  mode: {
    network: "fixture",
    proofMode: proof.proofMode,
    verifierMode: "real-router",
    privatePaymentsMode: "mode-a-handoff",
  },
  lockWitness: witness,
  proofArtifact: proof,
  stellarClaim: {
    mode: "fixture",
    txHash: stellarClaimTxHash,
    nullifier: proof.publicOutputs.claimNullifier,
    nullifierStored: true,
    replayFailure: "NebulaRelay NullifierAlreadyClaimed (#15)",
    invalidTokenFailure:
      "Invalid token rejected: witness token does not match expected token.",
    privateNoteHandoff:
      "Mode A handoff ready: private-note-compatible commitment recorded; direct pool credit is planned.",
  },
  cctpSettlement: {
    mode: "fixture",
    sourceDomain: witness.cctpSettlement.sourceDomain,
    destinationDomain: witness.cctpSettlement.destinationDomain,
    nonce: witness.cctpSettlement.nonce,
    message: witness.cctpSettlement.message,
    messageHash: proof.publicOutputs.cctpMessageHash,
    attestationHash: proof.publicOutputs.cctpAttestationHash,
    mintRecipient: proof.publicOutputs.cctpMintRecipient,
    messageHex: witness.cctpSettlement.message,
    attestationHex: "0x0a0b0c0d",
  },
  auditorPacket,
};

ensureDir(path.dirname(submissionPath));
ensureDir(path.dirname(auditorPacketPath));
writeJson(submissionPath, submission);
writeJson(auditorPacketPath, auditorPacket);

console.log(`demo_submission=${submissionPath}`);
console.log(`auditor_packet=${auditorPacketPath}`);
console.log(`proof_mode=${proof.proofMode}`);
console.log(`journal_digest=${proof.journalDigestHex}`);
console.log(`claim_nullifier=${proof.publicOutputs.claimNullifier}`);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalize(value) {
  return typeof value === "string" ? value.toLowerCase() : value;
}

function assertEqual(label, left, right) {
  if (normalize(left) !== normalize(right)) {
    throw new Error(`${label} mismatch: ${left} != ${right}`);
  }
}

function assertProofMatchesWitness(witness, proof) {
  const outputs = proof.publicOutputs;
  assertEqual("sourceChainId", witness.sourceChainId, outputs.sourceChainId);
  assertEqual(
    "sourceBlockNumber",
    witness.sourceBlockNumber,
    outputs.sourceBlockNumber
  );
  assertEqual(
    "sourceReceiptRoot",
    witness.sourceReceiptRoot,
    outputs.sourceReceiptRoot
  );
  assertEqual("escrowContract", witness.escrowContract, outputs.escrowContract);
  assertEqual("token", witness.tokenAddress, outputs.token);
  assertEqual("amount", witness.amount, outputs.amount);
  assertEqual(
    "stellarNoteCommitment",
    witness.stellarNoteCommitment,
    outputs.stellarNoteCommitment
  );
  assertEqual("complianceRoot", witness.complianceRoot, outputs.complianceRoot);
  assertEqual(
    "destinationChainId",
    witness.destinationChainId,
    outputs.destinationChainId
  );
  assertEqual(
    "cctpSourceDomain",
    witness.cctpSettlement.sourceDomain,
    outputs.cctpSourceDomain
  );
  assertEqual(
    "cctpDestinationDomain",
    witness.cctpSettlement.destinationDomain,
    outputs.cctpDestinationDomain
  );
  assertEqual("cctpNonce", witness.cctpSettlement.nonce, outputs.cctpNonce);
  assertEqual(
    "cctpMessageHash",
    witness.cctpSettlement.messageHash,
    outputs.cctpMessageHash
  );
  assertEqual(
    "cctpAttestationHash",
    witness.cctpSettlement.attestationHash,
    outputs.cctpAttestationHash
  );
  assertEqual(
    "cctpMintRecipient",
    witness.cctpSettlement.mintRecipient,
    outputs.cctpMintRecipient
  );
}

function buildCaveats(proofMode) {
  const proofModeCaveat =
    proofMode === "local-groth16"
      ? "Local Groth16 proof mode requires the configured Stellar verifier router and matching image ID before testnet use."
      : "Remote proof mode depends on the configured prover and verifier; review prover trust and availability before production use.";
  return [
    proofModeCaveat,
    "User-exported selective disclosure; the user chooses when and where to share it.",
    "This packet is not a production view-key system and does not provide ongoing account surveillance.",
    "Packet does not reveal private keys, note secrets, recipient secrets, or allowlist witness paths.",
    "Mode A private-note-compatible handoff; no direct upstream pool credit is claimed.",
    "CCTP settlement is proof-bound in the artifact, but this packet is not a legal or security audit.",
  ];
}
NODE
