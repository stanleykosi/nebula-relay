import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import {
  createSourceAction,
  erc20ApproveAbi,
  nebulaCctpEscrowAbi,
} from "../bridge/source-action.js";

describe("source action", () => {
  it("returns exact approval and lockAndBurn calldata for the frontend wallet", () => {
    const noteCommitment =
      "0x0000000000000000000000000000000000000000000000000000000000989680";
    const action = createSourceAction(
      {
        evmChainId: 11155111,
        usdcAddress: "0x1111111111111111111111111111111111111111",
        escrowAddress: "0x2222222222222222222222222222222222222222",
        complianceHint:
          "0x3333333333333333333333333333333333333333333333333333333333333333",
        cctpStellarForwarderHookData: "0x1234",
      },
      {
        receiveAmount: "10000000",
        expectedCctpFee: "1000",
        grossAmount: "10001000",
        assetDecimals: 6,
        sourceNetwork: "ethereum-sepolia",
        destinationNetwork: "stellar-testnet",
        feePolicy: "configured-cctp-fast-transfer-fee",
      },
      noteCommitment
    );

    const approval = decodeFunctionData({
      abi: erc20ApproveAbi,
      data: action.approval.calldata,
    });
    expect(approval.functionName).toBe("approve");
    expect(approval.args).toEqual([
      "0x2222222222222222222222222222222222222222",
      10001000n,
    ]);

    const lock = decodeFunctionData({
      abi: nebulaCctpEscrowAbi,
      data: action.lockAndBurn.calldata,
    });
    expect(lock.functionName).toBe("lockAndBurn");
    expect(lock.args).toEqual([
      10001000n,
      noteCommitment,
      "0x3333333333333333333333333333333333333333333333333333333333333333",
      "0x1234",
    ]);
  });
});
