import { describe, expect, it } from "vitest";
import {
  decodeSignatureBytes,
  extractOutputCommitment,
  findAspMembershipLeafEvent,
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

  it("finds a registered ASP membership leaf in raw Stellar RPC events", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "nebula-asp-0",
          result: {
            cursor: "0014509383073398783-4294967295",
            events: [
              {
                id: "0014508897742127104-0000000000",
                ledger: 3378116,
                contractId: "CCCZVCAZJNJBXESBNA5NSO2DUWXB3EAE2WASTTAWJL3TI7ATYEMP6HSB",
                txHash:
                  "89e3d7388a9a9265899b85cf2d4c07ec773aa69628cc000a9334de0f8dad5153",
                value:
                  "AAAAEQAAAAEAAAADAAAADwAAAAVpbmRleAAAAAAAAAUAAAAAAAAAAAAAAA8AAAAEbGVhZgAAAAsiS7iXwkmv8g8oX0xWaV/j8EqtfjosIHK1D8PePxxJnwAAAA8AAAAEcm9vdAAAAAsd4KZsQ1EgPNiOtCol0WbcYbwTO0qEzowPQmCWttbJCQ==",
              },
            ],
          },
        }),
        { status: 200 }
      );

    try {
      await expect(
        findAspMembershipLeafEvent({
          rpcUrl: "https://soroban-testnet.stellar.org",
          contractId: "CCCZVCAZJNJBXESBNA5NSO2DUWXB3EAE2WASTTAWJL3TI7ATYEMP6HSB",
          startLedger: 3369482,
          leaf: "0x224bb897c249aff20f285f4c56695fe3f04aad7e3a2c2072b50fc3de3f1c499f",
        })
      ).resolves.toMatchObject({
        index: "0",
        leaf: "15512424394430090008354503089307654523564750332006071462299399179645868591519",
        root: "13513994960082187451543450515948533455801785531258806348506385143374416365833",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
