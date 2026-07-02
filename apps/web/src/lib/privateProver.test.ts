import { describe, expect, it } from "vitest";
import {
  decodeSignatureBytes,
  extractOutputCommitment,
  isLikelyStellarPublicKey,
  normalizeBaseUnitAmount,
  normalizeWithdrawRecipient,
  normalizeBaseUrl,
  privateProverAssetPaths,
  type PreparedProverTx,
} from "./privateProver";

describe("private prover helpers", () => {
  it("normalizes asset roots", () => {
    expect(normalizeBaseUrl("/private-prover-runtime/")).toBe(
      "/private-prover-runtime"
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
      })
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
      })
    ).toBe("0x123");
  });

  it("reports ASP registration when upstream returns null", () => {
    expect(() => extractOutputCommitment(null)).toThrow(
      "not registered in the ASP membership tree"
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
      "Stellar public key"
    );
  });
});
