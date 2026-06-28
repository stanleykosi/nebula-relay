import * as StellarSdk from "@stellar/stellar-sdk";
import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import {
  buildCctpMintAndForwardOperation,
  buildCctpMintAndForwardTransaction,
  buildStellarForwarderHookData,
  CCTP_DOMAIN_IDS,
  CCTP_FINALITY_THRESHOLDS,
  CCTP_STELLAR_DOMAIN,
  cctpTokenMessengerV2Abi,
  createCctpBurnToStellarCall,
  createCctpSettlementBinding,
  encodeCctpBurnWithHookData,
  fetchCctpAttestationOnce,
  getIrisMessagesUrl,
  parseIrisMessagesResponse,
  pollCctpAttestation,
  STELLAR_CCTP_CONTRACTS,
  stellarContractStrkeyToBytes32,
  type FetchLike,
  type Hex32,
} from "./index";

const txHash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex32;
const tokenMessenger = "0x1111111111111111111111111111111111111111";
const burnToken = "0x2222222222222222222222222222222222222222";
const sourceDomain = CCTP_DOMAIN_IDS.base;
const stellarRecipient = StellarSdk.Keypair.random().publicKey();
const forwarder = STELLAR_CCTP_CONTRACTS.testnet.cctpForwarder;

function response(status: number, body: unknown): Awaited<ReturnType<FetchLike>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Not Ready",
    async json() {
      return body;
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2 - 1);
  for (let i = 2; i < hex.length; i += 2) {
    out[(i - 2) / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

describe("@nebula/cctp-client", () => {
  it("defines the Stellar CCTP domain and current Stellar contract IDs", () => {
    expect(CCTP_STELLAR_DOMAIN).toBe(27);
    expect(CCTP_DOMAIN_IDS.stellar).toBe(27);

    for (const contracts of Object.values(STELLAR_CCTP_CONTRACTS)) {
      expect(StellarSdk.StrKey.isValidContract(contracts.messageTransmitter)).toBe(
        true
      );
      expect(
        StellarSdk.StrKey.isValidContract(contracts.tokenMessengerMinter)
      ).toBe(true);
      expect(StellarSdk.StrKey.isValidContract(contracts.cctpForwarder)).toBe(
        true
      );
    }
  });

  it("encodes the CCTP Forwarder hook data layout for a Stellar recipient", () => {
    const hook = buildStellarForwarderHookData({
      recipient: stellarRecipient,
      payload: "0x1234",
    });
    const encoded = bytes(hook);
    const version =
      (encoded[24] << 24) |
      (encoded[25] << 16) |
      (encoded[26] << 8) |
      encoded[27];
    const length =
      (encoded[28] << 24) |
      (encoded[29] << 16) |
      (encoded[30] << 8) |
      encoded[31];

    expect(encoded.slice(0, 24)).toEqual(new Uint8Array(24));
    expect(version).toBe(1);
    expect(length).toBe(stellarRecipient.length);
    expect(String.fromCharCode(...encoded.slice(32, 32 + length))).toBe(
      stellarRecipient
    );
    expect(Array.from(encoded.slice(32 + length))).toEqual([0x12, 0x34]);
  });

  it("builds a depositForBurnWithHook call that forwards minting through Stellar CCTP", () => {
    const call = createCctpBurnToStellarCall({
      tokenMessenger,
      burnToken,
      amount: 10_000_000n,
      maxFee: 50_000n,
      cctpForwarder: forwarder,
      stellarRecipient,
      sourceDomain,
      minFinalityThreshold: CCTP_FINALITY_THRESHOLDS.fast,
    });
    const decoded = decodeFunctionData({
      abi: cctpTokenMessengerV2Abi,
      data: encodeCctpBurnWithHookData(call),
    });
    const forwarderBytes = stellarContractStrkeyToBytes32(forwarder);

    expect(call.sourceDomain).toBe(sourceDomain);
    expect(call.args[0]).toBe(10_000_000n);
    expect(call.args[1]).toBe(CCTP_STELLAR_DOMAIN);
    expect(call.args[2]).toBe(forwarderBytes);
    expect(call.args[3]).toBe("0x2222222222222222222222222222222222222222");
    expect(call.args[4]).toBe(forwarderBytes);
    expect(call.args[5]).toBe(50_000n);
    expect(call.args[6]).toBe(CCTP_FINALITY_THRESHOLDS.fast);
    expect(decoded.functionName).toBe("depositForBurnWithHook");
    expect(decoded.args[1]).toBe(CCTP_STELLAR_DOMAIN);
  });

  it("creates a proof-friendly settlement binding from CCTP message bytes", () => {
    const binding = createCctpSettlementBinding({
      sourceDomain,
      nonce:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      message: "0x010203040506",
      attestation: "0x0a0b0c0d",
      mintRecipient: forwarder,
    });

    expect(binding).toEqual({
      sourceDomain,
      destinationDomain: CCTP_STELLAR_DOMAIN,
      nonce:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      messageHash:
        "0x7192385c3c0605de55bb9476ce1d90748190ecb32a8eed7f5207b30cf6a1fe89",
      attestationHash:
        "0xb23549dda157801533d1d272da5ff88683bf1fbe6ee46deb3066bf55f7d05507",
      mintRecipient: stellarContractStrkeyToBytes32(forwarder),
    });
  });

  it("rejects unsupported Stellar CCTP destination shapes", () => {
    expect(() =>
      createCctpBurnToStellarCall({
        tokenMessenger,
        burnToken,
        amount: 0n,
        maxFee: 0n,
        cctpForwarder: forwarder,
        stellarRecipient,
        sourceDomain,
      })
    ).toThrow("amount must be positive");

    expect(() =>
      createCctpBurnToStellarCall({
        tokenMessenger,
        burnToken,
        amount: 1n,
        maxFee: 0n,
        cctpForwarder: "not-a-contract",
        stellarRecipient,
        sourceDomain,
      })
    ).toThrow("invalid Stellar contract ID");

    expect(() =>
      createCctpBurnToStellarCall({
        tokenMessenger,
        burnToken,
        amount: 1n,
        maxFee: 0n,
        cctpForwarder: forwarder,
        stellarRecipient: "not-a-stellar-recipient",
        sourceDomain,
      })
    ).toThrow("invalid Stellar forward recipient");
  });

  it("constructs the Iris attestation URL and parses a complete response", async () => {
    const urls: string[] = [];
    const fetcher: FetchLike = async (url) => {
      urls.push(url);
      return response(200, {
        messages: [
          {
            status: "complete",
            message: "0x0102",
            attestation: "0x0304",
            eventNonce: "7",
            cctpVersion: 2,
          },
        ],
      });
    };

    const result = await fetchCctpAttestationOnce(fetcher, {
      irisBaseUrl: "https://iris-api-sandbox.circle.com/",
      sourceDomain,
      transactionHash: txHash,
    });

    expect(urls).toEqual([
      `https://iris-api-sandbox.circle.com/v2/messages/${sourceDomain}?transactionHash=${txHash}`,
    ]);
    expect(getIrisMessagesUrl({ sourceDomain, transactionHash: txHash })).toContain(
      `/v2/messages/${sourceDomain}`
    );
    expect(result).toMatchObject({
      status: "complete",
      message: "0x0102",
      attestation: "0x0304",
      eventNonce: "7",
      cctpVersion: 2,
    });
  });

  it("polls until attestation is complete and times out if Circle Iris stays pending", async () => {
    let attempts = 0;
    const fetcher: FetchLike = async () => {
      attempts += 1;
      if (attempts === 1) {
        return response(404, "pending");
      }
      return response(200, {
        messages: [{ status: "complete", message: "0xaa", attestation: "0xbb" }],
      });
    };

    await expect(
      pollCctpAttestation({
        fetch: fetcher,
        sourceDomain,
        transactionHash: txHash,
        pollIntervalMs: 0,
        sleep: async () => {},
      })
    ).resolves.toMatchObject({ status: "complete", message: "0xaa" });

    await expect(
      pollCctpAttestation({
        fetch: async () => response(404, "pending"),
        sourceDomain,
        transactionHash: txHash,
        maxAttempts: 2,
        pollIntervalMs: 0,
        sleep: async () => {},
      })
    ).rejects.toThrow("not complete after 2 attempts");
  });

  it("rejects malformed complete Iris responses", () => {
    expect(() =>
      parseIrisMessagesResponse({
        messages: [{ status: "complete", message: "0xaa" }],
      })
    ).toThrow("omitted message or attestation");
  });

  it("builds a Stellar mint_and_forward operation and transaction", () => {
    const source = new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), "1");
    const operation = buildCctpMintAndForwardOperation({
      cctpForwarderContractId: forwarder,
      message: "0x0102",
      attestation: "0x0304",
    });
    const tx = buildCctpMintAndForwardTransaction({
      cctpForwarderContractId: forwarder,
      sourceAccount: source,
      networkPassphrase: StellarSdk.Networks.TESTNET,
      message: "0x0102",
      attestation: "0x0304",
    });

    expect(operation.body().switch().name).toBe("invokeHostFunction");
    expect(tx.operations).toHaveLength(1);
    expect(tx.toXDR()).toEqual(expect.any(String));
  });
});
