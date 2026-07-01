type FreighterError = { message?: string } | string;

type FreighterApi = {
  isConnected: () => Promise<{
    isConnected?: boolean;
    error?: FreighterError;
  }>;
  isAllowed: () => Promise<{
    isAllowed?: boolean;
    error?: FreighterError;
  }>;
  setAllowed: () => Promise<{
    isAllowed?: boolean;
    error?: FreighterError;
  } | void>;
  requestAccess: () => Promise<{
    address?: string;
    error?: FreighterError;
  }>;
  signMessage: (
    message: string,
    options?: { address?: string; networkPassphrase?: string }
  ) => Promise<{
    signedMessage?: string;
    signerAddress?: string;
    error?: FreighterError;
  }>;
};

export async function requestFreighterAddress(): Promise<string> {
  const freighter = await loadFreighter();
  await ensureFreighterReady(freighter);

  const access = await freighter.requestAccess();
  if (access.error) {
    throw normalizeFreighterError(access.error, "Freighter access rejected");
  }
  if (!access.address) {
    throw new Error("Freighter did not return a Stellar address");
  }
  return access.address;
}

export async function signFreighterMessage(
  message: string,
  options: { address?: string; networkPassphrase?: string } = {}
): Promise<{ signedMessage: string; signerAddress?: string }> {
  const freighter = await loadFreighter();
  await ensureFreighterReady(freighter);

  const result = await freighter.signMessage(message, options);
  if (result.error) {
    throw normalizeFreighterError(result.error, "Freighter message signing failed");
  }
  if (!result.signedMessage) {
    throw new Error("Freighter did not return a signed message");
  }
  return {
    signedMessage: result.signedMessage,
    signerAddress: result.signerAddress,
  };
}

async function loadFreighter(): Promise<FreighterApi> {
  const module = (await import("@stellar/freighter-api")) as unknown;
  if (!isFreighterApi(module)) {
    throw new Error("Freighter API package did not expose the expected methods");
  }
  return module;
}

async function ensureFreighterReady(freighter: FreighterApi) {
  const connected = await freighter.isConnected();
  if (connected.error) {
    throw normalizeFreighterError(
      connected.error,
      "Failed to check Freighter installation"
    );
  }
  if (!connected.isConnected) {
    throw new Error("Freighter extension not detected. Install Freighter and refresh this page.");
  }

  const allowed = await freighter.isAllowed();
  if (allowed.error) {
    throw normalizeFreighterError(
      allowed.error,
      "Failed to check Freighter origin access"
    );
  }
  if (!allowed.isAllowed) {
    const set = await freighter.setAllowed();
    if (set?.error) {
      throw normalizeFreighterError(set.error, "Freighter origin access rejected");
    }
  }
}

function isFreighterApi(value: unknown): value is FreighterApi {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.isConnected === "function" &&
    typeof candidate.isAllowed === "function" &&
    typeof candidate.setAllowed === "function" &&
    typeof candidate.requestAccess === "function" &&
    typeof candidate.signMessage === "function"
  );
}

function normalizeFreighterError(error: FreighterError, fallback: string): Error {
  const message = typeof error === "string" ? error : error.message ?? fallback;
  return new Error(message);
}
