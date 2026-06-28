import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildLockWitnessFromReceipt,
  createLockCall,
  fetchTransactionReceipt,
  parseLockedEventFromReceipt,
  submitLock,
  type BuildLockWitnessConfig,
  type EvmReceiptLike,
  type LockContractCall,
  type NebulaWalletClient,
} from "./index";
import type { Address, Hex } from "viem";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fixture(name: string): unknown {
  return readJson(resolve(root, "fixtures", name));
}

function receiptFixture(name: string): EvmReceiptLike {
  return readJson(resolve(root, "packages/evm-client/fixtures", name)) as EvmReceiptLike;
}

const validWitness = fixture("valid-lock.json") as {
  sourceChainId: number;
  sourceReceiptRoot: Hex;
  escrowContract: Address;
  tokenAddress: Address;
  complianceRoot: Hex;
  complianceMode: "allowlist-membership";
  cctpSettlement: BuildLockWitnessConfig["cctpSettlement"];
  expected: BuildLockWitnessConfig["expected"];
};

const witnessConfig: BuildLockWitnessConfig = {
  sourceChainId: validWitness.sourceChainId,
  escrowContract: validWitness.escrowContract,
  sourceReceiptRoot: validWitness.sourceReceiptRoot,
  complianceRoot: validWitness.complianceRoot,
  complianceMode: validWitness.complianceMode,
  cctpSettlement: validWitness.cctpSettlement,
  expected: validWitness.expected,
};

describe("@nebula/evm-client", () => {
  it("parses the canonical Locked event from a fixture receipt", () => {
    const parsed = parseLockedEventFromReceipt(
      receiptFixture("valid-lock-receipt.json"),
      validWitness.escrowContract
    );

    expect(parsed.lockId).toBe(
      "0x6666666666666666666666666666666666666666666666666666666666666666"
    );
    expect(parsed.senderAddress).toBe(
      "0x3333333333333333333333333333333333333333"
    );
    expect(parsed.tokenAddress).toBe(validWitness.tokenAddress);
    expect(parsed.amount).toBe(100_000_000n);
    expect(parsed.destinationChainId).toBe(1_501n);
  });

  it("builds schema-valid LockWitness JSON from a fixture receipt", () => {
    const witness = buildLockWitnessFromReceipt(
      receiptFixture("valid-lock-receipt.json"),
      witnessConfig
    );

    expect(witness).toEqual(fixture("valid-lock.json"));
  });

  it("rejects receipts without the configured escrow Locked event", () => {
    const receipt = receiptFixture("valid-lock-receipt.json");
    const wrongEscrow = "0x2222222222222222222222222222222222222222";

    expect(() =>
      parseLockedEventFromReceipt(receipt, wrongEscrow)
    ).toThrow("receipt does not contain");
    expect(() =>
      parseLockedEventFromReceipt({ ...receipt, logs: [] }, validWitness.escrowContract)
    ).toThrow("receipt does not contain");
  });

  it("creates a viem-compatible lock call", () => {
    const call = createLockCall({
      escrowContract: validWitness.escrowContract,
      token: validWitness.tokenAddress,
      amount: 100_000_000n,
      stellarNoteCommitment:
        "0x7777777777777777777777777777777777777777777777777777777777777777",
      complianceHint:
        "0x8888888888888888888888888888888888888888888888888888888888888888",
      destinationChainId: 1_501n,
    });

    expect(call.address).toBe(validWitness.escrowContract);
    expect(call.functionName).toBe("lock");
    expect(call.args).toEqual([
      validWitness.tokenAddress,
      100_000_000n,
      "0x7777777777777777777777777777777777777777777777777777777777777777",
      "0x8888888888888888888888888888888888888888888888888888888888888888",
      1_501n,
    ]);
  });

  it("submits lock transactions through an injected wallet client", async () => {
    const calls: Array<LockContractCall & { account?: Address }> = [];
    const wallet: NebulaWalletClient = {
      async writeContract(call) {
        calls.push(call);
        return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      },
    };

    const txHash = await submitLock(
      wallet,
      {
        escrowContract: validWitness.escrowContract,
        token: validWitness.tokenAddress,
        amount: 100_000_000n,
        stellarNoteCommitment:
          "0x7777777777777777777777777777777777777777777777777777777777777777",
        complianceHint:
          "0x8888888888888888888888888888888888888888888888888888888888888888",
        destinationChainId: 1_501n,
      },
      { account: "0x3333333333333333333333333333333333333333" }
    );

    expect(txHash).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.account).toBe(
      "0x3333333333333333333333333333333333333333"
    );
  });

  it("fetches receipts through an injected public client", async () => {
    const receipt = receiptFixture("valid-lock-receipt.json");
    const fetched = await fetchTransactionReceipt(
      {
        getTransactionReceipt: async ({ hash }) => {
          expect(hash).toBe(receipt.transactionHash);
          return receipt;
        },
      },
      receipt.transactionHash
    );

    expect(fetched).toEqual(receipt);
  });
});
