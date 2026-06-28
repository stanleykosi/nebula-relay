#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBMISSION_PATH="${1:-${NEBULA_DEMO_SUBMISSION:-$ROOT_DIR/artifacts/demo/demo-submission.json}}"

if ! command -v node >/dev/null 2>&1; then
  echo "Blocker: node is required to validate the demo submission JSON." >&2
  exit 1
fi

node - "$SUBMISSION_PATH" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");

const submissionPath = process.argv[2];
if (!submissionPath) {
  throw new Error("missing submission path");
}

const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
const witness = submission.lockWitness;
const proof = submission.proofArtifact;
const packet = submission.auditorPacket;

assert(submission.version === 1, "submission.version must be 1");
assert(witness && typeof witness === "object", "missing lockWitness");
assert(proof && typeof proof === "object", "missing proofArtifact");
assert(packet && typeof packet === "object", "missing auditorPacket");

validateWitness(witness);
validateProof(proof);
validateAuditorPacket(packet);
assertProofMatchesWitness(witness, proof);
assertPacketMatchesWitnessAndProof(packet, witness, proof);
validateDevSealIfNeeded(proof);
validateJournalDigest(proof);
validateFixtureFailures(submission);

console.log("Nebula demo submission verified");
console.log(`proof_mode=${proof.proofMode}`);
console.log(`source_tx=${witness.txHash}`);
console.log(`journal_digest=${proof.journalDigestHex}`);
console.log(`claim_nullifier=${proof.publicOutputs.claimNullifier}`);
console.log(`cctp_message_hash=${proof.publicOutputs.cctpMessageHash}`);
console.log(`auditor_packet_caveats=${packet.caveats.length}`);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(label, left, right) {
  if (normalize(left) !== normalize(right)) {
    throw new Error(`${label} mismatch: ${left} != ${right}`);
  }
}

function normalize(value) {
  return typeof value === "string" ? value.toLowerCase() : value;
}

function isHex(value, bytes) {
  return (
    typeof value === "string" &&
    new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)
  );
}

function isHexBytes(value) {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
}

function validateWitness(value) {
  assert(value.version === 1, "witness.version must be 1");
  assert(Number.isInteger(value.sourceChainId), "witness.sourceChainId invalid");
  assert(Number.isInteger(value.sourceBlockNumber), "witness.sourceBlockNumber invalid");
  assert(isHex(value.sourceReceiptRoot, 32), "witness.sourceReceiptRoot invalid");
  assert(isHex(value.txHash, 32), "witness.txHash invalid");
  assert(Number.isInteger(value.logIndex), "witness.logIndex invalid");
  assert(isHex(value.lockId, 32), "witness.lockId invalid");
  assert(isHex(value.escrowContract, 20), "witness.escrowContract invalid");
  assert(isHex(value.senderAddress, 20), "witness.senderAddress invalid");
  assert(isHex(value.tokenAddress, 20), "witness.tokenAddress invalid");
  assert(/^(0|[1-9][0-9]*)$/.test(value.amount), "witness.amount invalid");
  assert(isHex(value.stellarNoteCommitment, 32), "witness.stellarNoteCommitment invalid");
  assert(isHex(value.complianceHint, 32), "witness.complianceHint invalid");
  assert(isHex(value.complianceRoot, 32), "witness.complianceRoot invalid");
  assert(
    ["disabled-demo", "allowlist-membership", "denylist-non-membership"].includes(
      value.complianceMode
    ),
    "witness.complianceMode invalid"
  );
  assert(value.complianceWitness?.valid === true, "witness compliance must be valid");
  validateCctpSettlement(value.cctpSettlement, "witness.cctpSettlement");
  assertEqual("expected sourceChainId", value.sourceChainId, value.expected.sourceChainId);
  assertEqual("expected escrowContract", value.escrowContract, value.expected.escrowContract);
  assertEqual("expected tokenAddress", value.tokenAddress, value.expected.tokenAddress);
  assertEqual("expected complianceRoot", value.complianceRoot, value.expected.complianceRoot);
  assertEqual("expected destinationChainId", value.destinationChainId, value.expected.destinationChainId);
  assertEqual(
    "expected CCTP source domain",
    value.cctpSettlement.sourceDomain,
    value.expected.cctpSourceDomain
  );
  assertEqual(
    "expected CCTP destination domain",
    value.cctpSettlement.destinationDomain,
    value.expected.cctpDestinationDomain
  );
  assertEqual(
    "expected CCTP mint recipient",
    value.cctpSettlement.mintRecipient,
    value.expected.cctpMintRecipient
  );
}

function validateCctpSettlement(value, label) {
  assert(value && typeof value === "object", `${label} missing`);
  assert(Number.isInteger(value.sourceDomain), `${label}.sourceDomain invalid`);
  assert(Number.isInteger(value.destinationDomain), `${label}.destinationDomain invalid`);
  assert(isHex(value.nonce, 32), `${label}.nonce invalid`);
  assert(isHexBytes(value.message), `${label}.message invalid`);
  assert(isHex(value.messageHash, 32), `${label}.messageHash invalid`);
  assert(isHex(value.attestationHash, 32), `${label}.attestationHash invalid`);
  assert(isHex(value.mintRecipient, 32), `${label}.mintRecipient invalid`);
  assertEqual(`${label}.messageHash`, hashHex(value.message), value.messageHash);
}

function validateProof(value) {
  assert(value.version === 1, "proof.version must be 1");
  assert(["dev", "local-groth16", "remote"].includes(value.proofMode), "proofMode invalid");
  assert(isHexBytes(value.sealHex), "proof.sealHex invalid");
  assert(isHex(value.imageIdHex, 32), "proof.imageIdHex invalid");
  assert(isHexBytes(value.journalHex), "proof.journalHex invalid");
  assert((value.journalHex.length - 2) / 2 === 425, "proof.journalHex must encode 425 bytes");
  assert(isHex(value.journalDigestHex, 32), "proof.journalDigestHex invalid");
  assert(isHex(value.witnessHash, 32), "proof.witnessHash invalid");
  validateJournal(value.publicOutputs);
}

function validateJournal(value) {
  assert(value.version === 1, "journal.version must be 1");
  assert(isHex(value.domain, 32), "journal.domain invalid");
  assert(Number.isInteger(value.sourceChainId), "journal.sourceChainId invalid");
  assert(Number.isInteger(value.sourceBlockNumber), "journal.sourceBlockNumber invalid");
  assert(isHex(value.sourceReceiptRoot, 32), "journal.sourceReceiptRoot invalid");
  assert(isHex(value.escrowContract, 20), "journal.escrowContract invalid");
  assert(isHex(value.token, 20), "journal.token invalid");
  assert(/^(0|[1-9][0-9]*)$/.test(value.amount), "journal.amount invalid");
  assert(Number.isInteger(value.amountBucket), "journal.amountBucket invalid");
  assert(isHex(value.stellarNoteCommitment, 32), "journal.stellarNoteCommitment invalid");
  assert(isHex(value.complianceRoot, 32), "journal.complianceRoot invalid");
  assert(Number.isInteger(value.complianceMode), "journal.complianceMode invalid");
  assert(isHex(value.claimNullifier, 32), "journal.claimNullifier invalid");
  assert(isHex(value.eventCommitment, 32), "journal.eventCommitment invalid");
  assert(Number.isInteger(value.destinationChainId), "journal.destinationChainId invalid");
  assert(Number.isInteger(value.expiresAtLedger), "journal.expiresAtLedger invalid");
  assert(Number.isInteger(value.cctpSourceDomain), "journal.cctpSourceDomain invalid");
  assert(Number.isInteger(value.cctpDestinationDomain), "journal.cctpDestinationDomain invalid");
  assert(isHex(value.cctpNonce, 32), "journal.cctpNonce invalid");
  assert(isHex(value.cctpMessageHash, 32), "journal.cctpMessageHash invalid");
  assert(isHex(value.cctpAttestationHash, 32), "journal.cctpAttestationHash invalid");
  assert(isHex(value.cctpMintRecipient, 32), "journal.cctpMintRecipient invalid");
}

function validateAuditorPacket(value) {
  assert(value.version === 1, "auditorPacket.version must be 1");
  assert(Number.isInteger(value.sourceChainId), "auditorPacket.sourceChainId invalid");
  assert(isHex(value.sourceTxHash, 32), "auditorPacket.sourceTxHash invalid");
  assert(Number.isInteger(value.sourceLogIndex), "auditorPacket.sourceLogIndex invalid");
  assert(isHex(value.noteCommitment, 32), "auditorPacket.noteCommitment invalid");
  assert(isHex(value.claimNullifier, 32), "auditorPacket.claimNullifier invalid");
  assert(isHex(value.eventCommitment, 32), "auditorPacket.eventCommitment invalid");
  assert(isHex(value.cctpMessageHash, 32), "auditorPacket.cctpMessageHash invalid");
  assert(isHex(value.cctpAttestationHash, 32), "auditorPacket.cctpAttestationHash invalid");
  assert(isHex(value.cctpNonce, 32), "auditorPacket.cctpNonce invalid");
  assert(isHex(value.proofImageId, 32), "auditorPacket.proofImageId invalid");
  assert(isHex(value.journalDigest, 32), "auditorPacket.journalDigest invalid");
  assert(Array.isArray(value.caveats) && value.caveats.length > 0, "auditorPacket.caveats missing");
  assert(
    Array.isArray(value.verificationInstructions) &&
      value.verificationInstructions.length > 0,
    "auditorPacket.verificationInstructions missing"
  );
}

function assertProofMatchesWitness(witness, proof) {
  const outputs = proof.publicOutputs;
  assertEqual("sourceChainId", witness.sourceChainId, outputs.sourceChainId);
  assertEqual("sourceBlockNumber", witness.sourceBlockNumber, outputs.sourceBlockNumber);
  assertEqual("sourceReceiptRoot", witness.sourceReceiptRoot, outputs.sourceReceiptRoot);
  assertEqual("escrowContract", witness.escrowContract, outputs.escrowContract);
  assertEqual("token", witness.tokenAddress, outputs.token);
  assertEqual("amount", witness.amount, outputs.amount);
  assertEqual(
    "stellarNoteCommitment",
    witness.stellarNoteCommitment,
    outputs.stellarNoteCommitment
  );
  assertEqual("complianceRoot", witness.complianceRoot, outputs.complianceRoot);
  assertEqual("destinationChainId", witness.destinationChainId, outputs.destinationChainId);
  assertEqual("cctpSourceDomain", witness.cctpSettlement.sourceDomain, outputs.cctpSourceDomain);
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

function assertPacketMatchesWitnessAndProof(packet, witness, proof) {
  assertEqual("packet.sourceChainId", packet.sourceChainId, witness.sourceChainId);
  assertEqual("packet.sourceTxHash", packet.sourceTxHash, witness.txHash);
  assertEqual("packet.sourceLogIndex", packet.sourceLogIndex, witness.logIndex);
  assertEqual("packet.noteCommitment", packet.noteCommitment, witness.stellarNoteCommitment);
  assertEqual(
    "packet.claimNullifier",
    packet.claimNullifier,
    proof.publicOutputs.claimNullifier
  );
  assertEqual(
    "packet.eventCommitment",
    packet.eventCommitment,
    proof.publicOutputs.eventCommitment
  );
  assertEqual("packet.proofImageId", packet.proofImageId, proof.imageIdHex);
  assertEqual("packet.journalDigest", packet.journalDigest, proof.journalDigestHex);
  assertEqual(
    "packet.cctpMessageHash",
    packet.cctpMessageHash,
    proof.publicOutputs.cctpMessageHash
  );
  assertEqual(
    "packet.cctpAttestationHash",
    packet.cctpAttestationHash,
    proof.publicOutputs.cctpAttestationHash
  );
  assertEqual("packet.cctpNonce", packet.cctpNonce, proof.publicOutputs.cctpNonce);
  if (proof.proofMode === "dev") {
    assert(
      packet.caveats.some((caveat) =>
        caveat.toLowerCase().includes("not a production groth16 proof")
      ),
      "dev proof caveat missing"
    );
  }
}

function validateDevSealIfNeeded(proof) {
  if (proof.proofMode !== "dev") {
    return;
  }
  const prefixHex = Buffer.from("NEBULA_DEV_SEAL_V1", "utf8").toString("hex");
  assert(
    proof.sealHex.toLowerCase() === `0x${prefixHex}${proof.journalDigestHex.slice(2).toLowerCase()}`,
    "dev seal must be NEBULA_DEV_SEAL_V1 || journalDigest"
  );
}

function validateJournalDigest(proof) {
  const journalBytes = Buffer.from(proof.journalHex.slice(2), "hex");
  const digest = `0x${crypto.createHash("sha256").update(journalBytes).digest("hex")}`;
  assertEqual("journalDigest", digest, proof.journalDigestHex);
}

function validateFixtureFailures(submission) {
  if (submission.cctpSettlement) {
    validateCctpSettlement(submission.cctpSettlement, "submission.cctpSettlement");
    if (submission.cctpSettlement.messageHex) {
      assertEqual(
        "submission CCTP message hash",
        hashHex(submission.cctpSettlement.messageHex),
        submission.proofArtifact.publicOutputs.cctpMessageHash
      );
    }
    if (submission.cctpSettlement.attestationHex) {
      assertEqual(
        "submission CCTP attestation hash",
        hashHex(submission.cctpSettlement.attestationHex),
        submission.proofArtifact.publicOutputs.cctpAttestationHash
      );
    }
  }
  if (!submission.stellarClaim) {
    return;
  }
  assert(
    submission.stellarClaim.nullifierStored === true,
    "fixture claim must show nullifierStored=true"
  );
  assert(
    String(submission.stellarClaim.replayFailure ?? "").includes(
      "NullifierAlreadyClaimed"
    ),
    "fixture replay failure must mention NullifierAlreadyClaimed"
  );
  assert(
    String(submission.stellarClaim.invalidTokenFailure ?? "")
      .toLowerCase()
      .includes("invalid token"),
    "fixture invalid-token failure missing"
  );
}

function hashHex(value) {
  assert(isHexBytes(value), "hex payload invalid");
  return `0x${crypto.createHash("sha256").update(Buffer.from(value.slice(2), "hex")).digest("hex")}`;
}
NODE
