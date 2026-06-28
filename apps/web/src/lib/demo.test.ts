import { describe, expect, it } from "vitest";
import { AuditorPacketSchema, LockWitnessSchema } from "@nebula/core";
import { demoConfig } from "./config";
import {
  buildFixtureWitness,
  createInitialDemoState,
  demoModeSummary,
  runFullFixtureDemo,
  runInvalidTokenFailure,
  runReplayFailure,
} from "./demo";

describe("frontend demo state", () => {
  it("builds a schema-valid witness from the fixture receipt", () => {
    const state = buildFixtureWitness(createInitialDemoState());

    expect(() => LockWitnessSchema.parse(state.witness)).not.toThrow();
    expect(state.witness?.lockId).toBe(
      "0x6666666666666666666666666666666666666666666666666666666666666666"
    );
  });

  it("runs the complete fixture demo through auditor export", () => {
    const state = runFullFixtureDemo();

    expect(state.completed).toHaveLength(12);
    expect(state.nullifierStored).toBe(true);
    expect(state.replayFailure).toContain("NullifierAlreadyClaimed");
    expect(state.invalidTokenFailure).toContain("Invalid token rejected");
    expect(state.handoffStatus).toContain("Mode A");
    expect(() => AuditorPacketSchema.parse(state.auditorPacket)).not.toThrow();
  });

  it("keeps failure lab outcomes readable before and after claim", () => {
    const emptyReplay = runReplayFailure(createInitialDemoState());
    expect(emptyReplay.replayFailure).toContain("unavailable");

    const invalidToken = runInvalidTokenFailure(createInitialDemoState());
    expect(invalidToken.invalidTokenFailure).toContain("rejected");
  });

  it("summarizes active modes for UI badges", () => {
    expect(demoModeSummary(demoConfig)).toContain("proof=");
    expect(demoModeSummary(demoConfig)).toContain("verifier=");
  });
});
