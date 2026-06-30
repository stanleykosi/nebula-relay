import * as StellarSdk from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  buildAndPrepareClaimTransaction,
  buildClaimTransaction,
  claimArgsToScVals,
  NebulaRelayClient,
  signPreparedTransaction,
  signTransactionXdr,
  simulateAndAssembleTransaction,
  StellarClientError,
  submitSignedTransaction,
  toReadableStellarError,
  type ClaimArgs,
  type GetTransactionResponse,
  type SendTransactionResponse,
  type SimulationResponse,
  type StellarRpcClient,
} from "./index";

const source = StellarSdk.Keypair.random().publicKey();
const claimant = StellarSdk.Keypair.random().publicKey();
const contractId = StellarSdk.StrKey.encodeContract(new Uint8Array(32).fill(7));
const networkPassphrase = StellarSdk.Networks.TESTNET;

const claim: ClaimArgs = {
  claimant,
  seal: "0x4e4542554c415f4445565f5345414c5f5631",
  imageId: "0x79b0ae7f3c792a2a9b2a8c3786cc7be70c1fa81e06e7f7adc33faf4c9273fe4f",
  journal: "0x01020304",
  cctpMessage: "0x010203040506",
  cctpAttestation: "0x0a0b0c0d",
  poolPayload: "0x",
};

function sourceAccount(sequence = "1") {
  return new StellarSdk.Account(source, sequence);
}

const successfulSimulation = {} as SimulationResponse;

describe("@nebula/stellar-client", () => {
  it("builds claim ScVals and a Soroban claim transaction", () => {
    const vals = claimArgsToScVals(claim);
    expect(vals).toHaveLength(7);
    expect(vals[0]?.switch().name).toBe("scvAddress");
    expect(vals[1]?.switch().name).toBe("scvBytes");
    expect(vals[1]?.bytes().length).toBe(18);
    expect(vals[4]?.bytes().length).toBe(6);
    expect(vals[5]?.bytes().length).toBe(4);

    const tx = buildClaimTransaction({
      sourceAccount: sourceAccount(),
      contractId,
      networkPassphrase,
      claim,
    });

    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]?.type).toBe("invokeHostFunction");
    expect(tx.toXDR()).toEqual(expect.any(String));
  });

  it("provides a small NebulaRelay client binding", () => {
    const client = new NebulaRelayClient(contractId);
    const operation = client.claimOperation(claim);
    const tx = client.buildClaimTransaction({
      sourceAccount: sourceAccount(),
      networkPassphrase,
      claim,
    });

    expect(operation.body().switch().name).toBe("invokeHostFunction");
    expect(tx.operations[0]?.type).toBe("invokeHostFunction");
  });

  it("simulates and assembles claim transactions through an injected RPC client", async () => {
    const base = buildClaimTransaction({
      sourceAccount: sourceAccount(),
      contractId,
      networkPassphrase,
      claim,
    });
    const prepared = await simulateAndAssembleTransaction(
      {
        async simulateTransaction(transaction) {
          expect(transaction.toXDR()).toBe(base.toXDR());
          return successfulSimulation;
        },
      },
      base,
      {
        assembleTransaction(transaction, simulation) {
          expect(simulation).toBe(successfulSimulation);
          return transaction;
        },
      }
    );

    expect(prepared.transaction.toXDR()).toBe(base.toXDR());
    expect(prepared.simulation).toBe(successfulSimulation);
  });

  it("builds from RPC account, then simulates before returning a transaction", async () => {
    const prepared = await buildAndPrepareClaimTransaction(
      {
        async getAccount(accountId) {
          expect(accountId).toBe(source);
          return sourceAccount("5");
        },
        async simulateTransaction() {
          return successfulSimulation;
        },
      },
      {
        sourceAddress: source,
        contractId,
        networkPassphrase,
        claim,
      },
      {
        assembleTransaction(transaction) {
          return transaction;
        },
      }
    );

    expect(prepared.transaction.sequence).toBe("6");
  });

  it("surfaces simulation errors readably", async () => {
    const tx = buildClaimTransaction({
      sourceAccount: sourceAccount(),
      contractId,
      networkPassphrase,
      claim,
    });

    await expect(
      simulateAndAssembleTransaction(
        {
          async simulateTransaction() {
            return { error: "HostError: Error(Contract, #15)" } as SimulationResponse;
          },
        },
        tx
      )
    ).rejects.toThrow("Simulation failed");
  });

  it("signs with Freighter/Wallets-Kit-compatible signer shapes", async () => {
    const tx = buildClaimTransaction({
      sourceAccount: sourceAccount(),
      contractId,
      networkPassphrase,
      claim,
    });
    const signed = await signTransactionXdr(
      tx.toXDR(),
      {
        async signTransaction(xdr, options) {
          expect(options.networkPassphrase).toBe(networkPassphrase);
          return { signedTxXdr: xdr };
        },
      },
      { networkPassphrase, address: source }
    );

    expect(signed).toBe(tx.toXDR());
    await expect(
      signPreparedTransaction(
        { transaction: tx, simulation: successfulSimulation },
        async () => ({ error: { message: "user rejected" } }),
        networkPassphrase
      )
    ).rejects.toThrow("user rejected");
  });

  it("submits signed transactions and polls until success", async () => {
    const tx = buildClaimTransaction({
      sourceAccount: sourceAccount(),
      contractId,
      networkPassphrase,
      claim,
    });
    const statuses: GetTransactionResponse[] = [
      { status: "NOT_FOUND" },
      { status: "SUCCESS" },
    ];
    const rpc: Pick<StellarRpcClient, "sendTransaction" | "getTransaction"> = {
      async sendTransaction(transaction): Promise<SendTransactionResponse> {
        expect(transaction.toXDR()).toBe(tx.toXDR());
        return { status: "PENDING", hash: "abc123" };
      },
      async getTransaction() {
        return statuses.shift() ?? { status: "SUCCESS" };
      },
    };

    const result = await submitSignedTransaction(rpc, tx.toXDR(), networkPassphrase, {
      pollIntervalMs: 0,
      sleep: async () => {},
    });

    expect(result).toEqual({ hash: "abc123", status: "SUCCESS", returnValue: undefined });
  });

  it("maps NebulaRelay contract errors and invalid hex", () => {
    expect(toReadableStellarError("HostError: Error(Contract, #15)")).toBe(
      "NebulaRelay NullifierAlreadyClaimed (#15)"
    );
    expect(toReadableStellarError("HostError: Error(Contract, #21)")).toBe(
      "NebulaRelay InvalidCctpSettlement (#21)"
    );
    expect(() =>
      claimArgsToScVals({
        ...claim,
        journal: "0x123",
      })
    ).toThrow(StellarClientError);
  });
});
