import { signFreighterMessage } from "@/lib/freighter";

const DEFAULT_TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const AUTH_CACHE_MS = 4 * 60 * 1000;

const authCache = new Map<
  string,
  { timestamp: string; signature: string; expiresAt: number }
>();

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

export async function stellarAuthHeaders(input: {
  account: string;
  method: string;
  path: string;
  scope: string;
}): Promise<Record<string, string>> {
  const cacheKey = [
    input.account,
    input.method.toUpperCase(),
    input.path,
    input.scope,
  ].join("\n");
  const now = Date.now();
  const cached = authCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return headersFor(input.account, cached.timestamp, cached.signature);
  }

  const timestamp = String(now);
  const signed = await signFreighterMessage(
    buildStellarAuthMessage({ ...input, timestamp }),
    {
      address: input.account,
      networkPassphrase:
        process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
        DEFAULT_TESTNET_PASSPHRASE,
    }
  );
  if (signed.signerAddress && signed.signerAddress !== input.account) {
    throw new Error("Freighter signed API authorization with a different Stellar account");
  }

  authCache.set(cacheKey, {
    timestamp,
    signature: signed.signedMessage,
    expiresAt: now + AUTH_CACHE_MS,
  });
  return headersFor(input.account, timestamp, signed.signedMessage);
}

function headersFor(
  account: string,
  timestamp: string,
  signature: string
): Record<string, string> {
  return {
    "x-nebula-auth-account": account,
    "x-nebula-auth-timestamp": timestamp,
    "x-nebula-auth-signature": signature,
  };
}
