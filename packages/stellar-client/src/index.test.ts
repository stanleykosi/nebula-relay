import * as StellarSdk from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  buildAndPreparePrivatePoolClaimTransaction,
  buildPrivatePoolDepositScVal,
  buildPrivatePoolClaimTransaction,
  inspectPrivatePoolPreparedTx,
  NebulaRelayClient,
  privatePoolDepositScValToXdr,
  privatePoolClaimArgsToScVals,
  signPreparedTransaction,
  signTransactionXdr,
  simulateAndAssembleTransaction,
  StellarClientError,
  submitSignedTransaction,
  toReadableStellarError,
  type GetTransactionResponse,
  type SendTransactionResponse,
  type SimulationResponse,
  type StellarRpcClient,
} from "./index";

const source = StellarSdk.Keypair.random().publicKey();
const contractId = StellarSdk.StrKey.encodeContract(new Uint8Array(32).fill(7));
const networkPassphrase = StellarSdk.Networks.TESTNET;

const proofInputs = {
  seal: "0x4e4542554c415f4445565f5345414c5f5631",
  imageId: "0x79b0ae7f3c792a2a9b2a8c3786cc7be70c1fa81e06e7f7adc33faf4c9273fe4f",
  journal: "0x01020304",
  cctpMessage: "0x010203040506",
  cctpAttestation: "0x0a0b0c0d",
};
const privatePoolClaim = {
  ...proofInputs,
  privateDeposit: StellarSdk.nativeToScVal("upstream-private-pool-deposit"),
};
const privatePoolId = StellarSdk.StrKey.encodeContract(new Uint8Array(32).fill(9));
const privateNoteCommitment =
  "0x0000000000000000000000000000000000000000000000000000000005f5e100" as const;
const upstreamPrivateDeposit = {
  proof_uncompressed: Array.from({ length: 256 }, (_, index) => index % 251),
  ext_data: {
    recipient: privatePoolId,
    ext_amount: "100000000",
    encrypted_output0: [1, 2, 3, 4],
    encrypted_output1: [],
  },
  prepared: {
    poolRoot: "0x0000000000000000000000000000000000000000000000000000000000000001",
    inputNullifiers: [
      "0x0000000000000000000000000000000000000000000000000000000000000002",
      "0x0000000000000000000000000000000000000000000000000000000000000003",
    ],
    outputCommitments: [
      privateNoteCommitment,
      "0x0000000000000000000000000000000000000000000000000000000000000004",
    ],
    publicAmount: privateNoteCommitment,
    extDataHashBe: new Array(32).fill(5),
    aspMembershipRoot:
      "0x0000000000000000000000000000000000000000000000000000000000000006",
    aspNonMembershipRoot:
      "0x0000000000000000000000000000000000000000000000000000000000000007",
  },
};

function sourceAccount(sequence = "1") {
  return new StellarSdk.Account(source, sequence);
}

const successfulSimulation = {} as SimulationResponse;

describe("@nebula/stellar-client", () => {
  it("builds private-pool claim ScVals and a Soroban claim transaction", () => {
    const vals = privatePoolClaimArgsToScVals(privatePoolClaim);
    expect(vals).toHaveLength(6);
    expect(vals[0]?.switch().name).toBe("scvBytes");
    expect(vals[0]?.bytes().length).toBe(18);
    expect(vals[3]?.bytes().length).toBe(6);
    expect(vals[4]?.bytes().length).toBe(4);
    expect(vals[5]).toBe(privatePoolClaim.privateDeposit);

    const tx = buildPrivatePoolClaimTransaction({
      sourceAccount: sourceAccount(),
      contractId,
      networkPassphrase,
      claim: privatePoolClaim,
    });

    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]?.type).toBe("invokeHostFunction");
    expect(tx.toXDR()).toEqual(expect.any(String));
  });

  it("provides a small NebulaRelay client binding", () => {
    const client = new NebulaRelayClient(contractId);
    const privateOperation = client.privatePoolClaimOperation(privatePoolClaim);
    const tx = client.buildPrivatePoolClaimTransaction({
      sourceAccount: sourceAccount(),
      networkPassphrase,
      claim: privatePoolClaim,
    });

    expect(privateOperation.body().switch().name).toBe("invokeHostFunction");
    expect(tx.operations[0]?.type).toBe("invokeHostFunction");
  });

  it("builds private-pool claim operations with an upstream deposit ScVal", () => {
    const vals = privatePoolClaimArgsToScVals(privatePoolClaim);
    expect(vals).toHaveLength(6);
    expect(vals[0]?.switch().name).toBe("scvBytes");
    expect(vals[5]).toBe(privatePoolClaim.privateDeposit);

    const tx = buildPrivatePoolClaimTransaction({
      sourceAccount: sourceAccount(),
      contractId,
      networkPassphrase,
      claim: privatePoolClaim,
    });
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]?.type).toBe("invokeHostFunction");
  });

  it("encodes upstream Private Payments prover output as Nebula PrivatePoolDeposit", () => {
    const inspection = inspectPrivatePoolPreparedTx({
      upstream: upstreamPrivateDeposit,
      expectedPoolId: privatePoolId,
      expectedSettlementAmount: "100000000",
    });
    expect(inspection).toMatchObject({
      proofUncompressedBytes: 256,
      recipient: privatePoolId,
      extAmount: "100000000",
      selectedOutputIndex: 0,
      selectedNoteCommitment: privateNoteCommitment,
    });

    const scVal = buildPrivatePoolDepositScVal({
      upstream: upstreamPrivateDeposit,
      expectedPoolId: privatePoolId,
      expectedSettlementAmount: "100000000",
      expectedNoteCommitment: privateNoteCommitment,
    });
    expect(scVal.switch().name).toBe("scvMap");

    const xdr = privatePoolDepositScValToXdr({
      upstream: upstreamPrivateDeposit,
      expectedPoolId: privatePoolId,
      expectedSettlementAmount: 100000000n,
      expectedNoteCommitment: privateNoteCommitment,
    });
    expect(StellarSdk.xdr.ScVal.fromXDR(xdr, "base64").toXDR("base64")).toBe(xdr);
  });

  it("can select the second private-pool output commitment for the Nebula note", () => {
    const inspection = inspectPrivatePoolPreparedTx({
      upstream: upstreamPrivateDeposit,
      expectedPoolId: privatePoolId,
      expectedSettlementAmount: "100000000",
      noteOutputIndex: 1,
    });

    expect(inspection.selectedOutputIndex).toBe(1);
    expect(inspection.selectedNoteCommitment).toBe(
      upstreamPrivateDeposit.prepared.outputCommitments[1]
    );
  });

  it("rejects upstream private deposits that are not bound to Nebula outputs", () => {
    expect(() =>
      buildPrivatePoolDepositScVal({
        upstream: {
          ...upstreamPrivateDeposit,
          ext_data: {
            ...upstreamPrivateDeposit.ext_data,
            recipient: contractId,
          },
        },
        expectedPoolId: privatePoolId,
        expectedSettlementAmount: "100000000",
        expectedNoteCommitment: privateNoteCommitment,
      })
    ).toThrow("recipient mismatch");

    expect(() =>
      buildPrivatePoolDepositScVal({
        upstream: upstreamPrivateDeposit,
        expectedPoolId: privatePoolId,
        expectedSettlementAmount: "99999999",
        expectedNoteCommitment: privateNoteCommitment,
      })
    ).toThrow("ext_amount mismatch");

    expect(() =>
      buildPrivatePoolDepositScVal({
        upstream: upstreamPrivateDeposit,
        expectedPoolId: privatePoolId,
        expectedSettlementAmount: "100000000",
        expectedNoteCommitment:
          "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      })
    ).toThrow("output commitments");
  });

  it("simulates and assembles claim transactions through an injected RPC client", async () => {
    const base = buildPrivatePoolClaimTransaction({
      sourceAccount: sourceAccount(),
      contractId,
      networkPassphrase,
      claim: privatePoolClaim,
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
    const prepared = await buildAndPreparePrivatePoolClaimTransaction(
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
        claim: privatePoolClaim,
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
    const tx = buildPrivatePoolClaimTransaction({
      sourceAccount: sourceAccount(),
      contractId,
      networkPassphrase,
      claim: privatePoolClaim,
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
    const tx = buildPrivatePoolClaimTransaction({
      sourceAccount: sourceAccount(),
      contractId,
      networkPassphrase,
      claim: privatePoolClaim,
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
    const tx = buildPrivatePoolClaimTransaction({
      sourceAccount: sourceAccount(),
      contractId,
      networkPassphrase,
      claim: privatePoolClaim,
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
    expect(toReadableStellarError("HostError: Error(Contract, #24)")).toBe(
      "NebulaRelay InvalidPrivatePoolDeposit (#24)"
    );
    expect(() =>
      privatePoolClaimArgsToScVals({
        ...privatePoolClaim,
        journal: "0x123",
      })
    ).toThrow(StellarClientError);
  });
});
