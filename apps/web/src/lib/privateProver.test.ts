import { describe, expect, it } from "vitest";
import {
  decodeSignatureBytes,
  extractOutputCommitment,
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

  it("decodes Freighter base64 and manual hex signatures", () => {
    expect(decodeSignatureBytes("AQID")).toEqual([1, 2, 3]);
    expect(decodeSignatureBytes("0x010203")).toEqual([1, 2, 3]);
  });
});
