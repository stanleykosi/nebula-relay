import * as StellarSdk from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { normalizeAndValidatePrivatePoolProof } from "../bridge/private-pool.js";

const poolId = StellarSdk.StrKey.encodeContract(new Uint8Array(32).fill(9));
const note0 =
  "0x0000000000000000000000000000000000000000000000000000000000989680" as const;
const note1 =
  "0x0000000000000000000000000000000000000000000000000000000000000004" as const;
const upstream = {
  proofUncompressed: Array.from({ length: 256 }, (_, index) => index % 251),
  extData: {
    recipient: poolId,
    extAmount: "10000000",
    encryptedOutput0: [1, 2, 3, 4],
    encryptedOutput1: [],
  },
  prepared: {
    poolRoot: "0x0000000000000000000000000000000000000000000000000000000000000001",
    inputNullifiers: [
      "0x0000000000000000000000000000000000000000000000000000000000000002",
      "0x0000000000000000000000000000000000000000000000000000000000000003",
    ],
    outputCommitments: [note0, note1],
    publicAmount: note0,
    extDataHashBe: new Array(32).fill(5),
    aspMembershipRoot:
      "0x0000000000000000000000000000000000000000000000000000000000000006",
    aspNonMembershipRoot:
      "0x0000000000000000000000000000000000000000000000000000000000000007",
  },
};

describe("private pool payload", () => {
  it("unwraps Nebula frontend PreparedProverTx JSON and validates amount, pool, and selected note", () => {
    const result = normalizeAndValidatePrivatePoolProof(
      {
        privatePaymentsPoolId: poolId,
        privatePoolNoteOutputIndex: 0,
      },
      { receiveAmount: "10000000" },
      {
        preparedProverTx: upstream,
        outputCommitment: note0,
        amount: "10000000",
        poolId,
        generatedAt: "2026-07-01T00:00:00.000Z",
      }
    );

    expect(result.upstream).toBe(upstream);
    expect(result.inspection.selectedNoteCommitment).toBe(note0);
    expect(result.inspection.extAmount).toBe("10000000");
  });

  it("rejects a wrapper that points to the wrong selected output commitment", () => {
    expect(() =>
      normalizeAndValidatePrivatePoolProof(
        {
          privatePaymentsPoolId: poolId,
          privatePoolNoteOutputIndex: 0,
        },
        { receiveAmount: "10000000" },
        {
          preparedProverTx: upstream,
          outputCommitment:
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          amount: "10000000",
          poolId,
        }
      )
    ).toThrow("outputCommitment");
  });
});
