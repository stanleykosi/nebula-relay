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
        disclosureMode: "user-exported",
        caveats: ["dev-mode artifact"],
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
