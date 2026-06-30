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
  assertCctpMessageMatchesSettlement,
  cctpTokenMessengerV2Abi,
  createCctpBurnToStellarCall,
  createCctpSettlementBinding,
  evmAddressToBytes32,
  encodeCctpBurnWithHookData,
  fetchCctpAttestationOnce,
  getIrisMessagesUrl,
  parseCctpMessageV2,
  parseStellarForwarderHookData,
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
const escrowAddress = "0x3333333333333333333333333333333333333333";
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

function hexByteLength(hex: Hex32 | `0x${string}`): number {
  return (hex.length - 2) / 2;
}

function u32Hex(value: number): string {
  return value.toString(16).padStart(8, "0");
}

function u256Hex(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function strip0x(hex: `0x${string}`): string {
  return hex.slice(2);
}

function buildCircleCctpV2Message(params?: {
  amount?: bigint;
  destinationCaller?: Hex32;
  hookData?: `0x${string}`;
}): `0x${string}` {
  const nonce =
    "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex32;
  const mintRecipient = stellarContractStrkeyToBytes32(forwarder);
  const hookData =
    params?.hookData ??
    buildStellarForwarderHookData({
      recipient: stellarRecipient,
      payload: "0x1234",
    });

  return `0x${[
    u32Hex(1),
    u32Hex(sourceDomain),
    u32Hex(CCTP_STELLAR_DOMAIN),
    strip0x(nonce),
    strip0x(evmAddressToBytes32(tokenMessenger)),
    "bb".repeat(32),
    strip0x(params?.destinationCaller ?? mintRecipient),
    u32Hex(CCTP_FINALITY_THRESHOLDS.standard),
    u32Hex(0),
    u32Hex(1),
    strip0x(evmAddressToBytes32(burnToken)),
    strip0x(mintRecipient),
    u256Hex(params?.amount ?? 10_000_000n),
    strip0x(evmAddressToBytes32(escrowAddress)),
    u256Hex(50_000n),
    u256Hex(0n),
    u256Hex(0n),
    strip0x(hookData),
  ].join("")}`;
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
    expect(version).toBe(0);
    expect(length).toBe(stellarRecipient.length);
    expect(String.fromCharCode(...encoded.slice(32, 32 + length))).toBe(
      stellarRecipient
    );
    expect(Array.from(encoded.slice(32 + length))).toEqual([0x12, 0x34]);
  });

  it("parses the CCTP Forwarder hook data layout", () => {
    const hook = buildStellarForwarderHookData({
      recipient: stellarRecipient,
      payload: "0x1234",
    });

    expect(parseStellarForwarderHookData(hook)).toEqual({
      version: 0,
      recipient: stellarRecipient,
      payload: "0x1234",
    });
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
      message: "0x010203040506",
      messageHash:
        "0x7192385c3c0605de55bb9476ce1d90748190ecb32a8eed7f5207b30cf6a1fe89",
      attestationHash:
        "0xb23549dda157801533d1d272da5ff88683bf1fbe6ee46deb3066bf55f7d05507",
      mintRecipient: stellarContractStrkeyToBytes32(forwarder),
    });
  });

  it("parses a Circle CCTP V2 message and enforces the Nebula settlement binding", () => {
    const message = buildCircleCctpV2Message();
    const parsed = parseCctpMessageV2(message);
    const mintRecipient = stellarContractStrkeyToBytes32(forwarder);

    expect(hexByteLength(message)).toBeGreaterThan(376);
    expect(parsed.version).toBe(1);
    expect(parsed.sourceDomain).toBe(sourceDomain);
    expect(parsed.destinationDomain).toBe(CCTP_STELLAR_DOMAIN);
    expect(parsed.destinationCaller).toBe(mintRecipient);
    expect(parsed.burnMessage.burnToken).toBe(evmAddressToBytes32(burnToken));
    expect(parsed.burnMessage.mintRecipient).toBe(mintRecipient);
    expect(parsed.burnMessage.amount).toBe(10_000_000n);
    expect(parsed.burnMessage.messageSender).toBe(
      evmAddressToBytes32(escrowAddress)
    );
    expect(parseStellarForwarderHookData(parsed.burnMessage.hookData)).toMatchObject({
      recipient: stellarRecipient,
    });

    expect(() =>
      assertCctpMessageMatchesSettlement({
        message,
        expectedSourceDomain: sourceDomain,
        expectedNonce: parsed.nonce,
        expectedBurnToken: burnToken,
        expectedAmount: 10_000_000n,
        expectedMessageSender: escrowAddress,
        expectedMintRecipient: mintRecipient,
      })
    ).not.toThrow();
  });

  it("rejects CCTP messages with wrong amount, token, caller, or malformed hook", () => {
    const valid = buildCircleCctpV2Message();
    const parsed = parseCctpMessageV2(valid);
    const mintRecipient = stellarContractStrkeyToBytes32(forwarder);
    const base = {
      message: valid,
      expectedSourceDomain: sourceDomain,
      expectedNonce: parsed.nonce,
      expectedBurnToken: burnToken,
      expectedAmount: 10_000_000n,
      expectedMessageSender: escrowAddress,
      expectedMintRecipient: mintRecipient,
    };

    expect(() =>
      assertCctpMessageMatchesSettlement({ ...base, expectedAmount: 9_000_000n })
    ).toThrow("amount mismatch");
    expect(() =>
      assertCctpMessageMatchesSettlement({
        ...base,
        expectedBurnToken: "0x4444444444444444444444444444444444444444",
      })
    ).toThrow("burn token mismatch");
    expect(() =>
      assertCctpMessageMatchesSettlement({
        ...base,
        message: buildCircleCctpV2Message({
          destinationCaller:
            "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        }),
      })
    ).toThrow("destination caller mismatch");
    expect(() =>
      assertCctpMessageMatchesSettlement({
        ...base,
        message: buildCircleCctpV2Message({ hookData: "0x" }),
      })
    ).toThrow("non-empty hook data");
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
