import { Hex32Schema } from "@nebula/core";
import { inspectPrivatePoolPreparedTx } from "@nebula/stellar-client";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { ApiError } from "../errors.js";
import type { BridgeQuote } from "../types.js";

const decimalSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);

const preparedWrapperSchema = z
  .object({
    preparedProverTx: z.unknown(),
    outputCommitment: Hex32Schema.optional(),
    amount: decimalSchema.optional(),
    poolId: z.string().optional(),
    generatedAt: z.string().optional(),
  })
  .passthrough();

export interface NormalizedPrivatePoolProof {
  upstream: unknown;
  inspection: ReturnType<typeof inspectPrivatePoolPreparedTx>;
  wrapperMetadata: {
    outputCommitment?: string;
    amount?: string;
    poolId?: string;
    generatedAt?: string;
  };
}

export function normalizeAndValidatePrivatePoolProof(
  config: Pick<
    AppConfig,
    "privatePaymentsPoolId" | "privatePoolNoteOutputIndex"
  >,
  quote: Pick<BridgeQuote, "receiveAmount">,
  payload: unknown
): NormalizedPrivatePoolProof {
  const wrapper = tryParseWrapper(payload);
  const upstream = wrapper ? wrapper.preparedProverTx : payload;
  const inspection = inspectPrivatePoolPreparedTx({
    upstream,
    expectedPoolId: config.privatePaymentsPoolId,
    expectedSettlementAmount: quote.receiveAmount,
    noteOutputIndex: config.privatePoolNoteOutputIndex,
  });

  if (wrapper?.amount && wrapper.amount !== quote.receiveAmount) {
    throw new ApiError(
      400,
      "private_pool_amount_mismatch",
      `PreparedProverTx wrapper amount ${wrapper.amount} does not match requested receive amount ${quote.receiveAmount}`
    );
  }
  if (wrapper?.poolId && wrapper.poolId !== config.privatePaymentsPoolId) {
    throw new ApiError(
      400,
      "private_pool_mismatch",
      `PreparedProverTx wrapper pool ${wrapper.poolId} does not match configured pool`
    );
  }
  if (
    wrapper?.outputCommitment &&
    wrapper.outputCommitment.toLowerCase() !==
      inspection.selectedNoteCommitment.toLowerCase()
  ) {
    throw new ApiError(
      400,
      "private_pool_note_mismatch",
      "PreparedProverTx wrapper outputCommitment does not match selected private-pool output"
    );
  }

  return {
    upstream,
    inspection,
    wrapperMetadata: {
      outputCommitment: wrapper?.outputCommitment,
      amount: wrapper?.amount,
      poolId: wrapper?.poolId,
      generatedAt: wrapper?.generatedAt,
    },
  };
}

function tryParseWrapper(payload: unknown): z.infer<typeof preparedWrapperSchema> | null {
  const parsed = preparedWrapperSchema.safeParse(payload);
  if (parsed.success) {
    return parsed.data;
  }
  if (hasPreparedProverTx(payload)) {
    throw new ApiError(
      400,
      "invalid_private_pool_wrapper",
      parsed.error.issues.map((issue) => issue.message).join("; ")
    );
  }
  return null;
}

function hasPreparedProverTx(value: unknown): value is { preparedProverTx: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "preparedProverTx" in value
  );
}
