import { ProofArtifactSchema, type LockWitness, type ProofArtifact } from "@nebula/core";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AppConfig } from "../config.js";
import { ApiError } from "../errors.js";

export interface RemoteProofResult {
  proof: ProofArtifact;
  boundlessRequestId: `0x${string}` | null;
  log: string;
}

export async function proveWitnessRemotely(
  config: Pick<
    AppConfig,
    | "nebulaHostBin"
    | "boundlessRpcUrl"
    | "boundlessPrivateKey"
    | "boundlessProgramUrl"
    | "pinataJwt"
    | "nebulaImageId"
  >,
  intentId: string,
  witness: LockWitness
): Promise<RemoteProofResult> {
  if (!config.boundlessProgramUrl && !config.pinataJwt) {
    throw new ApiError(
      500,
      "boundless_storage_missing",
      "set BOUNDLESS_PROGRAM_URL or PINATA_JWT so Boundless provers can fetch the Nebula guest"
    );
  }

  const dir = await mkdtemp(path.join(tmpdir(), `nebula-${intentId}-`));
  const witnessPath = path.join(dir, "witness.json");
  const proofPath = path.join(dir, "remote-proof.json");
  await writeFile(witnessPath, `${JSON.stringify(witness, null, 2)}\n`);

  const { stdout, stderr } = await runCommand(config.nebulaHostBin, [
    "prove",
    "--fixture",
    witnessPath,
    "--mode",
    "remote",
    "--out",
    proofPath,
  ], {
    ...process.env,
    BOUNDLESS_RPC_URL: config.boundlessRpcUrl,
    BOUNDLESS_PRIVATE_KEY: config.boundlessPrivateKey,
    BOUNDLESS_PROGRAM_URL: config.boundlessProgramUrl ?? undefined,
    PINATA_JWT: config.pinataJwt ?? undefined,
    NEBULA_IMAGE_ID: config.nebulaImageId,
    RISC0_PROVER_MODE: "remote",
  });

  const proof = ProofArtifactSchema.parse(
    JSON.parse(await readFile(proofPath, "utf8"))
  );
  if (proof.proofMode !== "remote") {
    throw new ApiError(
      502,
      "wrong_proof_mode",
      `expected remote proof mode, got ${proof.proofMode}`
    );
  }
  if (proof.imageIdHex.toLowerCase() !== config.nebulaImageId.toLowerCase()) {
    throw new ApiError(
      502,
      "wrong_image_id",
      `remote proof image ID ${proof.imageIdHex} does not match configured Nebula image ID`
    );
  }

  const log = `${stdout}\n${stderr}`;
  const requestId =
    /Boundless request submitted:\s*(0x[0-9a-fA-F]+)/.exec(log)?.[1]
      ?.toLowerCase() as `0x${string}` | undefined;

  return {
    proof,
    boundlessRequestId: requestId ?? null,
    log,
  };
}

function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new ApiError(
          502,
          "prover_failed",
          `remote prover command exited with ${code}: ${stderr || stdout}`
        )
      );
    });
  });
}
