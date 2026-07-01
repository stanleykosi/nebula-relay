import type { AppConfig } from "../config.js";
import { ApiError } from "../errors.js";
import type { BridgeQuote } from "../types.js";

export function quoteBridgeReceiveAmount(
  config: Pick<
    AppConfig,
    | "cctpFeeQuoteBaseUnits"
    | "cctpMaxFee"
    | "nebulaMinAmount"
    | "nebulaMaxAmount"
  >,
  receiveAmount: string
): BridgeQuote {
  const receive = parseAmount(receiveAmount, "receiveAmount");
  const expectedFee = parseAmount(
    config.cctpFeeQuoteBaseUnits,
    "CCTP_FEE_QUOTE_BASE_UNITS",
    { allowZero: true }
  );
  const maxCctpFee = parseAmount(config.cctpMaxFee, "CCTP_MAX_FEE", {
    allowZero: true,
  });
  if (expectedFee > maxCctpFee) {
    throw new ApiError(
      500,
      "fee_config_invalid",
      "configured CCTP fee quote exceeds CCTP max fee"
    );
  }

  const gross = receive + expectedFee;
  const min = parseAmount(config.nebulaMinAmount, "NEBULA_MIN_AMOUNT");
  const max = parseAmount(config.nebulaMaxAmount, "NEBULA_MAX_AMOUNT");
  if (gross < min || gross > max) {
    throw new ApiError(
      400,
      "amount_out_of_bounds",
      `gross source amount ${gross} must be between ${min} and ${max}`
    );
  }

  return {
    receiveAmount: receive.toString(),
    expectedCctpFee: expectedFee.toString(),
    grossAmount: gross.toString(),
    assetDecimals: 6,
    sourceNetwork: "ethereum-sepolia",
    destinationNetwork: "stellar-testnet",
    feePolicy: "configured-cctp-fast-transfer-fee",
  };
}

export function parseAmount(
  value: string,
  label: string,
  options: { allowZero?: boolean } = {}
): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new ApiError(400, "invalid_amount", `${label} must be a decimal string`);
  }
  const amount = BigInt(value);
  if (amount < 0n || (!options.allowZero && amount === 0n)) {
    throw new ApiError(
      400,
      "invalid_amount",
      `${label} must be ${options.allowZero ? "nonnegative" : "positive"}`
    );
  }
  return amount;
}
