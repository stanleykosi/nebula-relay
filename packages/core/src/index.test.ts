import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuditorPacketSchema,
  LockWitnessSchema,
  NebulaJournalSchema,
  ProofArtifactSchema,
} from "./index";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function fixture(name: string) {
  return JSON.parse(readFileSync(resolve(root, "fixtures", name), "utf8"));
}

describe("Nebula schemas", () => {
  it.each([
    "valid-lock.json",
    "wrong-token.json",
    "wrong-escrow.json",
    "bad-compliance.json",
    "wrong-destination.json",
  ])("validates %s as a LockWitness shape", (name) => {
    expect(() => LockWitnessSchema.parse(fixture(name))).not.toThrow();
  });

  it("validates journal and proof artifact shapes", () => {
    const journal = {
      version: 1,
      domain:
        "0x4e4542554c415f5354454c4c41525f544553544e45545f563100000000000000",
      sourceChainId: 11155111,
      sourceBlockNumber: 123456,
      sourceReceiptRoot:
        "0x5555555555555555555555555555555555555555555555555555555555555555",
      escrowContract: "0x1111111111111111111111111111111111111111",
      token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      amount: "100000000",
      amountBucket: 100,
      stellarNoteCommitment:
        "0x7777777777777777777777777777777777777777777777777777777777777777",
      complianceRoot:
        "0x9999999999999999999999999999999999999999999999999999999999999999",
      complianceMode: 1,
      claimNullifier:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      eventCommitment:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      destinationChainId: 1501,
      expiresAtLedger: 999999,
      cctpSourceDomain: 0,
      cctpDestinationDomain: 27,
      cctpNonce:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      cctpMessageHash:
        "0x428f0dc1a457bec99fe9a1e8d375a01d4fc7c6b0691cef934fbbbfe30c300b67",
      cctpAttestationHash:
        "0xb23549dda157801533d1d272da5ff88683bf1fbe6ee46deb3066bf55f7d05507",
      cctpMintRecipient:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    };
    expect(() => NebulaJournalSchema.parse(journal)).not.toThrow();
    expect(() =>
      ProofArtifactSchema.parse({
        version: 1,
        proofMode: "dev",
        sealHex: "0x4e4556554c415f4445565f5345414c5f5631",
        imageIdHex:
          "0x4e4542554c415f4445565f494d4147455f49445f563100000000000000000000",
        journalHex: "0x0102",
        journalDigestHex:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        publicOutputs: journal,
        generatedAt: "2026-06-27T00:00:00Z",
        witnessHash:
          "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      })
    ).not.toThrow();
  });

  it("validates auditor packet shape", () => {
    expect(() =>
      AuditorPacketSchema.parse({
        version: 1,
        sourceChainId: 11155111,
        sourceTxHash:
          "0x4444444444444444444444444444444444444444444444444444444444444444",
        sourceLogIndex: 0,
        noteCommitment:
          "0x7777777777777777777777777777777777777777777777777777777777777777",
        claimNullifier:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        eventCommitment:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        proofImageId:
          "0x4e4542554c415f4445565f494d4147455f49445f563100000000000000000000",
        journalDigest:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        cctpMessageHash:
          "0x428f0dc1a457bec99fe9a1e8d375a01d4fc7c6b0691cef934fbbbfe30c300b67",
        cctpAttestationHash:
          "0xb23549dda157801533d1d272da5ff88683bf1fbe6ee46deb3066bf55f7d05507",
        cctpNonce:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        disclosureMode: "user-exported",
        caveats: ["dev-mode artifact"],
        verificationInstructions: [
          {
            title: "Validate schema",
            description: "Parse this packet with AuditorPacketSchema.",
            expected: "The packet is schema-valid.",
          },
        ],
      })
    ).not.toThrow();
  });

  it("validates generated dev proof artifact when present", () => {
    const artifactPath = resolve(root, "artifacts", "dev-proof.json");
    if (!existsSync(artifactPath)) {
      return;
    }

    expect(() =>
      ProofArtifactSchema.parse(JSON.parse(readFileSync(artifactPath, "utf8")))
    ).not.toThrow();
  });
});
