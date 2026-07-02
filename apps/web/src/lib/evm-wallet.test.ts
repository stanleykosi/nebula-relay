import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForEvmReceipt } from "./evm-wallet";

describe("waitForEvmReceipt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves when the mined EVM receipt succeeded", async () => {
    stubEthereumReceipt({ status: "0x1" });

    await expect(
      waitForEvmReceipt("0xabc", { label: "source lock transaction" })
    ).resolves.toBeUndefined();
  });

  it("throws when the mined EVM receipt reverted", async () => {
    stubEthereumReceipt({ status: "0x0" });

    await expect(
      waitForEvmReceipt("0xabc", { label: "source lock transaction" })
    ).rejects.toThrow("mined but reverted");
  });
});

function stubEthereumReceipt(receipt: Record<string, unknown>) {
  vi.stubGlobal("window", {
    ethereum: {
      request: vi.fn().mockResolvedValue(receipt),
    },
    setTimeout,
  });
}
