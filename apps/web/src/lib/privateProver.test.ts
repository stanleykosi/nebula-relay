import { describe, expect, it } from "vitest";
import {
  decodeSignatureBytes,
  estimateStellarWithdrawFee,
  findSpendablePrivateNote,
  extractOutputCommitment,
  isLikelyStellarPublicKey,
  normalizeBaseUnitAmount,
  normalizeStepCount,
  normalizeWithdrawRecipient,
  normalizeBaseUrl,
  privateProverAssetPaths,
  stroopsToXlm,
  type PreparedProverTx,
} from "./privateProver";

describe("private prover helpers", () => {
  it("normalizes asset roots", () => {
    expect(normalizeBaseUrl("/private-prover-runtime/")).toBe(
      "/private-prover-runtime",
    );
    expect(normalizeBaseUrl("")).toBe("/private-prover-runtime");
  });

  it("lists the upstream browser prover assets Nebula expects", () => {
    expect(privateProverAssetPaths("/private-prover-runtime")).toEqual([
      {
        name: "wasm-facade",
        path: "/private-prover-runtime/js/wasm-facade.js",
      },
      { name: "web-module", path: "/private-prover-runtime/js/web.js" },
      {
        name: "storage-worker",
        path: "/private-prover-runtime/js/storage-worker.js",
      },
      {
        name: "prover-worker",
        path: "/private-prover-runtime/js/prover-worker.js",
      },
      {
        name: "policy-wasm",
        path: "/private-prover-runtime/circuits/policy_tx_2_2.wasm",
      },
      {
        name: "policy-r1cs",
        path: "/private-prover-runtime/circuits/policy_tx_2_2.r1cs",
      },
      {
        name: "disclosure-wasm",
        path: "/private-prover-runtime/circuits/selectiveDisclosure_1.wasm",
      },
      {
        name: "disclosure-r1cs",
        path: "/private-prover-runtime/circuits/selectiveDisclosure_1.r1cs",
      },
    ]);
  });

  it("extracts the Nebula note commitment from the first output", () => {
    const prepared = {
      proofUncompressed: [],
      extData: {},
      prepared: {
        outputCommitments: ["123", "0"],
      },
    } satisfies PreparedProverTx;

    expect(extractOutputCommitment(prepared)).toBe("123");
  });

  it("extracts the commitment from upstream snake_case prepared outputs", () => {
    expect(
      extractOutputCommitment({
        proof_uncompressed: [],
        ext_data: {},
        prepared: {
          output_commitments: ["0xabc", "0xdef"],
        },
      }),
    ).toBe("0xabc");
  });

  it("extracts the commitment from individual prepared output fields", () => {
    expect(
      extractOutputCommitment({
        proofUncompressed: [],
        extData: {},
        prepared: {
          output_commitment0: "0x123",
          output_commitment1: "0x456",
        },
      }),
    ).toBe("0x123");
  });

  it("reports ASP registration when upstream returns null", () => {
    expect(() => extractOutputCommitment(null)).toThrow(
      "not registered in the ASP membership tree",
    );
  });

  it("decodes Freighter base64 and manual hex signatures", () => {
    expect(decodeSignatureBytes("AQID")).toEqual([1, 2, 3]);
    expect(decodeSignatureBytes("0x010203")).toEqual([1, 2, 3]);
  });

  it("validates private pool withdrawal amounts", () => {
    expect(normalizeBaseUnitAmount(" 10000000 ")).toBe("10000000");
    expect(() => normalizeBaseUnitAmount("0")).toThrow("greater than zero");
    expect(() => normalizeBaseUnitAmount("1.5")).toThrow("integer");
  });

  it("validates Stellar public-key withdrawal recipients", () => {
    const recipient = `G${"A".repeat(55)}`;
    expect(isLikelyStellarPublicKey(recipient)).toBe(true);
    expect(normalizeWithdrawRecipient(` ${recipient} `)).toBe(recipient);
    expect(isLikelyStellarPublicKey(`C${"A".repeat(55)}`)).toBe(false);
    expect(() => normalizeWithdrawRecipient("not-a-stellar-key")).toThrow(
      "Stellar public key",
    );
  });

  it("formats Stellar stroops as XLM", () => {
    expect(stroopsToXlm("100")).toBe("0.00001");
    expect(stroopsToXlm("10000000")).toBe("1");
    expect(stroopsToXlm("10000100")).toBe("1.00001");
  });

  it("estimates private withdrawal Stellar fees per planned tx", () => {
    const fee = estimateStellarWithdrawFee({
      stepCount: 3,
      resourceFeeStroopsPerStep: "100000",
      source: "runtime-plan-estimate",
    });

    expect(fee.stepCount).toBe(3);
    expect(fee.inclusionFeeStroops).toBe("300");
    expect(fee.resourceFeeStroops).toBe("300000");
    expect(fee.totalFeeStroops).toBe("300300");
    expect(fee.totalFeeXlm).toBe("0.03003");
    expect(fee.source).toBe("runtime-plan-estimate");
  });

  it("normalizes unsafe private withdrawal plan counts", () => {
    expect(normalizeStepCount(undefined)).toBe(1);
    expect(normalizeStepCount(0)).toBe(1);
    expect(normalizeStepCount(2.5)).toBe(1);
    expect(normalizeStepCount(101)).toBe(100);
  });

  it("matches private note recovery by exact spendable commitment", () => {
    const notes = [
      {
        id: "0xdead",
        pool_contract_id: "pool-a",
        amount: "500",
        spent: false,
      },
      {
        id: "0xabc123",
        pool_contract_id: "pool-a",
        amount: "1000",
        spent: false,
      },
    ];

    expect(
      findSpendablePrivateNote(notes, {
        noteCommitment: "ABC123",
        poolId: "pool-a",
        amount: "1000",
      }),
    ).toMatchObject({
      spendable: true,
      count: 2,
      recognized: true,
    });
  });

  it("does not treat unrelated unspent runtime notes as recovered", () => {
    const notes = [
      {
        id: "0xdead",
        pool_contract_id: "pool-a",
        amount: "1000",
        spent: false,
      },
    ];

    expect(
      findSpendablePrivateNote(notes, {
        noteCommitment: "0xabc123",
        poolId: "pool-a",
        amount: "1000",
      }),
    ).toEqual({
      spendable: false,
      count: 1,
      recognized: true,
    });
  });

  it("ignores spent notes during private note recovery", () => {
    expect(
      findSpendablePrivateNote(
        [
          {
            id: "0xabc123",
            pool_contract_id: "pool-a",
            amount: "1000",
            spent: true,
          },
        ],
        {
          noteCommitment: "0xabc123",
          poolId: "pool-a",
          amount: "1000",
        },
      ),
    ).toEqual({
      spendable: false,
      count: 0,
      recognized: true,
    });
  });
});
