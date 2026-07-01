import { encodeFunctionData, getAddress, type Abi, type Hex } from "viem";
import type { AppConfig } from "../config.js";
import type { BridgeQuote, SourceAction } from "../types.js";

export const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "ok", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const satisfies Abi;

export const nebulaCctpEscrowAbi = [
  {
    type: "function",
    name: "lockAndBurn",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "stellarNoteCommitment", type: "bytes32" },
      { name: "complianceHint", type: "bytes32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "lockId", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
] as const satisfies Abi;

export function createSourceAction(
  config: Pick<
    AppConfig,
    | "evmChainId"
    | "usdcAddress"
    | "escrowAddress"
    | "complianceHint"
    | "cctpStellarForwarderHookData"
  >,
  quote: BridgeQuote,
  noteCommitment: Hex
): SourceAction {
  const amount = BigInt(quote.grossAmount);
  const approvalCalldata = encodeFunctionData({
    abi: erc20ApproveAbi,
    functionName: "approve",
    args: [config.escrowAddress, amount],
  });
  const lockCalldata = encodeFunctionData({
    abi: nebulaCctpEscrowAbi,
    functionName: "lockAndBurn",
    args: [
      amount,
      noteCommitment,
      config.complianceHint,
      config.cctpStellarForwarderHookData,
    ],
  });

  return {
    chainId: config.evmChainId,
    token: getAddress(config.usdcAddress),
    escrow: getAddress(config.escrowAddress),
    spender: getAddress(config.escrowAddress),
    receiveAmount: quote.receiveAmount,
    expectedCctpFee: quote.expectedCctpFee,
    grossAmount: quote.grossAmount,
    noteCommitment,
    complianceHint: config.complianceHint,
    hookData: config.cctpStellarForwarderHookData,
    approval: {
      to: getAddress(config.usdcAddress),
      spender: getAddress(config.escrowAddress),
      amount: quote.grossAmount,
      calldata: approvalCalldata,
      abi: erc20ApproveAbi,
    },
    lockAndBurn: {
      to: getAddress(config.escrowAddress),
      functionName: "lockAndBurn",
      args: {
        amount: quote.grossAmount,
        stellarNoteCommitment: noteCommitment,
        complianceHint: config.complianceHint,
        hookData: config.cctpStellarForwarderHookData,
      },
      calldata: lockCalldata,
      abi: nebulaCctpEscrowAbi,
    },
  };
}
