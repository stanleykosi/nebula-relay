import type { IncomingMessage } from "node:http";
import { Keypair } from "@stellar/stellar-sdk";
import { ApiError } from "../errors.js";

const MAX_AUTH_AGE_MS = 5 * 60 * 1000;
const MAX_AUTH_FUTURE_SKEW_MS = 30 * 1000;

export interface StellarAuthMessageInput {
  account: string;
  method: string;
  path: string;
  scope: string;
  timestamp: string;
}

export function buildStellarAuthMessage(input: StellarAuthMessageInput): string {
  return [
    "Nebula Relay API Authorization",
    "Version: 1",
    `Account: ${input.account}`,
    `Method: ${input.method.toUpperCase()}`,
    `Path: ${input.path}`,
    `Scope: ${input.scope}`,
    `Timestamp: ${input.timestamp}`,
  ].join("\n");
}

export function requireStellarAuth(
  request: IncomingMessage,
  expected: {
    account: string;
    scope: string;
    path: string;
    nowMs?: number;
  }
): void {
  const account = readSingleHeader(request, "x-nebula-auth-account");
  const timestamp = readSingleHeader(request, "x-nebula-auth-timestamp");
  const signature = readSingleHeader(request, "x-nebula-auth-signature");

  if (!account || !timestamp || !signature) {
    throw new ApiError(
      401,
      "missing_stellar_auth",
      "wallet signature is required for this Stellar account scoped request"
    );
  }
  if (account !== expected.account) {
    throw new ApiError(
      403,
      "stellar_auth_account_mismatch",
      "wallet signature account does not match the requested Stellar account"
    );
  }
  if (!/^[0-9]+$/.test(timestamp)) {
    throw new ApiError(
      401,
      "invalid_stellar_auth_timestamp",
      "wallet signature timestamp must be a unix epoch millisecond value"
    );
  }

  const signedAt = Number(timestamp);
  const now = expected.nowMs ?? Date.now();
  if (!Number.isSafeInteger(signedAt)) {
    throw new ApiError(
      401,
      "invalid_stellar_auth_timestamp",
      "wallet signature timestamp is outside the supported range"
    );
  }
  if (signedAt > now + MAX_AUTH_FUTURE_SKEW_MS || now - signedAt > MAX_AUTH_AGE_MS) {
    throw new ApiError(
      401,
      "expired_stellar_auth",
      "wallet signature expired; reconnect your Stellar wallet and retry"
    );
  }

  const message = buildStellarAuthMessage({
    account,
    method: request.method ?? "",
    path: expected.path,
    scope: expected.scope,
    timestamp,
  });

  let verified = false;
  try {
    verified = Keypair.fromPublicKey(account).verify(
      Buffer.from(message, "utf8"),
      decodeSignature(signature)
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new ApiError(
      401,
      "invalid_stellar_auth_signature",
      "wallet signature could not be verified for this request"
    );
  }
}

function readSingleHeader(
  request: IncomingMessage,
  name: string
): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decodeSignature(value: string): Buffer {
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed.slice(2), "hex");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new Error("signature must be base64 or 0x-prefixed hex");
  }
  return Buffer.from(trimmed, "base64");
}
