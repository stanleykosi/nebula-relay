import { describe, expect, it } from "vitest";
import { AuditorPacketSchema } from "@nebula/core";
import {
  FORBIDDEN_AUDITOR_CLAIMS,
  REQUIRED_AUDITOR_CAVEATS,
  buildAuditorPacket,
  serializeAuditorPacket,
} from "./auditor";
import { devProofArtifact, validLockWitness } from "./fixtures";

const fixtureClaimTx =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("auditor packet generator", () => {
  it("exports a schema-valid packet with required disclosure fields", () => {
    const packet = buildAuditorPacket({
      witness: validLockWitness,
      proof: devProofArtifact,
      stellarClaimTxHash: fixtureClaimTx,
    });

    expect(() => AuditorPacketSchema.parse(packet)).not.toThrow();
    expect(packet.sourceTxHash).toBe(validLockWitness.txHash);
    expect(packet.sourceLogIndex).toBe(validLockWitness.logIndex);
    expect(packet.stellarClaimTxHash).toBe(fixtureClaimTx);
    expect(packet.noteCommitment).toBe(validLockWitness.stellarNoteCommitment);
    expect(packet.claimNullifier).toBe(
      devProofArtifact.publicOutputs.claimNullifier
    );
    expect(packet.proofImageId).toBe(devProofArtifact.imageIdHex);
    expect(packet.journalDigest).toBe(devProofArtifact.journalDigestHex);
    expect(packet.verificationInstructions.length).toBeGreaterThan(0);
  });

  it("serializes to JSON that round-trips through the schema", () => {
    const packet = buildAuditorPacket({
      witness: validLockWitness,
      proof: devProofArtifact,
      stellarClaimTxHash: fixtureClaimTx,
    });
    const parsed = JSON.parse(serializeAuditorPacket(packet));

    expect(AuditorPacketSchema.parse(parsed)).toEqual(packet);
  });

  it("rejects a proof artifact that is not bound to the witness", () => {
    const mismatchedProof = {
      ...devProofArtifact,
      publicOutputs: {
        ...devProofArtifact.publicOutputs,
        token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    };

    expect(() =>
      buildAuditorPacket({
        witness: validLockWitness,
        proof: mismatchedProof,
      })
    ).toThrow(/token/);
  });

  it("keeps caveats explicit without claiming production view-key powers", () => {
    const packet = buildAuditorPacket({
      witness: validLockWitness,
      proof: devProofArtifact,
      stellarClaimTxHash: fixtureClaimTx,
    });
    const text = JSON.stringify(packet).toLowerCase();

    expect(packet.caveats).toEqual(
      expect.arrayContaining([...REQUIRED_AUDITOR_CAVEATS])
    );
    expect(text).toContain("not a production view-key system");
    expect(text).toContain("does not reveal private keys");
    for (const forbidden of FORBIDDEN_AUDITOR_CLAIMS) {
      expect(text).not.toContain(forbidden);
    }
  });
});
