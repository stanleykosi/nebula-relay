import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import { quoteBridgeReceiveAmount } from "../bridge/quote.js";

const config = {
  cctpFeeQuoteBaseUnits: "1000",
  cctpMaxFee: "1000000",
  nebulaMinAmount: "1000000",
  nebulaMaxAmount: "500000000",
};

describe("bridge quote", () => {
  it("quotes gross source amount as receive amount plus configured CCTP fee", () => {
    expect(quoteBridgeReceiveAmount(config, "10000000")).toMatchObject({
      receiveAmount: "10000000",
      expectedCctpFee: "1000",
      grossAmount: "10001000",
      sourceNetwork: "ethereum-sepolia",
      destinationNetwork: "stellar-testnet",
    });
  });

  it("rejects amounts outside the escrow bounds after adding the fee", () => {
    expect(() => quoteBridgeReceiveAmount(config, "1")).toThrow(ApiError);
    expect(() => quoteBridgeReceiveAmount(config, "500000000")).toThrow(
      "gross source amount"
    );
  });
});
