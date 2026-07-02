import type { SourceTransactionAction } from "@/lib/nebula-api";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export interface ConnectedEvmWallet {
  address: string;
  chainId: number;
}

export async function connectEvmWallet(): Promise<ConnectedEvmWallet> {
  const provider = requireEthereumProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const address = firstString(accounts, "No EVM account returned by wallet");
  const chainIdHex = await provider.request({ method: "eth_chainId" });
  const chainId = Number.parseInt(firstString(chainIdHex, "No EVM chain returned"), 16);
  persistWallet("nebula.evmAddress", address);
  return { address, chainId };
}

export async function switchEvmChain(chainId: number): Promise<void> {
  const provider = requireEthereumProvider();
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${chainId.toString(16)}` }],
  });
}

export async function sendEvmAction(input: {
  from: string;
  action: SourceTransactionAction;
}): Promise<string> {
  const provider = requireEthereumProvider();
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: input.from,
        to: input.action.to,
        data: input.action.calldata,
        value: "0x0",
      },
    ],
  });
  return firstString(hash, "Wallet did not return a transaction hash");
}

export async function waitForEvmReceipt(
  txHash: string,
  options: { label?: string; pollMs?: number; timeoutMs?: number } = {}
): Promise<void> {
  const provider = requireEthereumProvider();
  const started = Date.now();
  const label = options.label ?? "transaction";
  const pollMs = options.pollMs ?? 2_500;
  const timeoutMs = options.timeoutMs ?? 180_000;
  while (Date.now() - started < timeoutMs) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    });
    if (receipt && typeof receipt === "object") {
      assertSuccessfulReceipt(receipt, label);
      return;
    }
    await sleep(pollMs);
  }
  throw new Error(
    `Timed out waiting for the ${label} to be mined. Check the wallet transaction history and retry from Activity if the backend did not receive it.`
  );
}

export async function readErc20Allowance(input: {
  token: string;
  owner: string;
  spender: string;
}): Promise<bigint> {
  const provider = requireEthereumProvider();
  const data = `0xdd62ed3e${encodeAddress(input.owner)}${encodeAddress(input.spender)}`;
  const response = await provider.request({
    method: "eth_call",
    params: [{ to: input.token, data }, "latest"],
  });
  const value = firstString(response, "Wallet RPC did not return an allowance value");
  return BigInt(value);
}

export function storedWalletAddress(key: "nebula.evmAddress" | "nebula.stellarAddress"): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(key) ?? "";
}

export function persistWallet(key: "nebula.evmAddress" | "nebula.stellarAddress", value: string): void {
  if (typeof window !== "undefined" && value) {
    window.localStorage.setItem(key, value);
  }
}

function requireEthereumProvider(): EthereumProvider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No EVM wallet found. Install MetaMask or another EIP-1193 wallet.");
  }
  return window.ethereum;
}

function firstString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value) {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string" && value[0]) {
    return value[0];
  }
  throw new Error(fallback);
}

function encodeAddress(address: string): string {
  const normalized = address.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }
  return normalized.padStart(64, "0");
}

function assertSuccessfulReceipt(receipt: object, label: string): void {
  const status = (receipt as { status?: unknown }).status;
  if (
    status === "0x1" ||
    status === 1 ||
    status === "1" ||
    status === true
  ) {
    return;
  }
  if (status === "0x0" || status === 0 || status === "0" || status === false) {
    throw new Error(
      `The ${label} was mined but reverted. Do not attach this transaction; check the wallet details and retry.`
    );
  }
  throw new Error(
    `The ${label} returned an unknown receipt status (${String(status)}). Do not attach this transaction until the wallet confirms it succeeded.`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
