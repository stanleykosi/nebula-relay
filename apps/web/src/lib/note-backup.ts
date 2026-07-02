import {
  type BridgeNoteBackupRecord,
} from "@/lib/nebula-api";
import { signFreighterMessage } from "@/lib/freighter";
import { decodeSignatureBytes } from "@/lib/privateProver";
import type { NebulaNoteRecord } from "@/lib/note-vault";

export const NOTE_BACKUP_FORMAT = "nebula.note.backup.v1" as const;
export const NOTE_BACKUP_KDF_VERSION =
  "freighter-signature-hkdf-sha256-aes-256-gcm-v1" as const;

export interface EncryptedNoteBackupPayload {
  stellarAccount: string;
  noteCommitment: string;
  poolId: string;
  backupFormat: typeof NOTE_BACKUP_FORMAT;
  schemaVersion: 1;
  kdfVersion: typeof NOTE_BACKUP_KDF_VERSION;
  salt: string;
  iv: string;
  ciphertext: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encryptNoteBackup(input: {
  record: NebulaNoteRecord;
  networkPassphrase: string;
}): Promise<EncryptedNoteBackupPayload> {
  if (!input.record.intentId) {
    throw new Error("A bridge intent is required before encrypted note backup");
  }
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const metadata = backupMetadata(input.record);
  const key = await deriveBackupKey({
    metadata,
    ownerAddress: input.record.ownerAddress,
    networkPassphrase: input.networkPassphrase,
    salt,
  });
  const plaintext = encoder.encode(JSON.stringify(input.record));
  const aad = encoder.encode(canonicalMetadata(metadata));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: webCryptoBytes(iv), additionalData: webCryptoBytes(aad) },
      key,
      webCryptoBytes(plaintext)
    )
  );

  return {
    stellarAccount: input.record.ownerAddress,
    noteCommitment: input.record.noteCommitment,
    poolId: input.record.poolId,
    backupFormat: NOTE_BACKUP_FORMAT,
    schemaVersion: 1,
    kdfVersion: NOTE_BACKUP_KDF_VERSION,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
}

export async function decryptNoteBackup(input: {
  backup: BridgeNoteBackupRecord;
  networkPassphrase: string;
}): Promise<NebulaNoteRecord> {
  if (input.backup.backupFormat !== NOTE_BACKUP_FORMAT) {
    throw new Error("Unsupported note backup format");
  }
  if (input.backup.kdfVersion !== NOTE_BACKUP_KDF_VERSION) {
    throw new Error("Unsupported note backup key derivation version");
  }
  const metadata = backupMetadata(input.backup);
  const salt = base64ToBytes(input.backup.salt);
  const iv = base64ToBytes(input.backup.iv);
  const ciphertext = base64ToBytes(input.backup.ciphertext);
  const key = await deriveBackupKey({
    metadata,
    ownerAddress: input.backup.stellarAccount,
    networkPassphrase: input.networkPassphrase,
    salt,
  });
  const aad = encoder.encode(canonicalMetadata(metadata));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: webCryptoBytes(iv), additionalData: webCryptoBytes(aad) },
    key,
    webCryptoBytes(ciphertext)
  );
  const parsed = JSON.parse(decoder.decode(plaintext)) as unknown;
  return validateRestoredNote(parsed, input.backup);
}

function backupMetadata(input: {
  intentId?: string | null;
  ownerAddress?: string;
  stellarAccount?: string;
  noteCommitment: string;
  poolId: string;
}) {
  const intentId = input.intentId;
  if (!intentId) {
    throw new Error("Note backup metadata is missing intent id");
  }
  return {
    format: NOTE_BACKUP_FORMAT,
    schemaVersion: 1,
    intentId,
    stellarAccount: input.ownerAddress ?? input.stellarAccount ?? "",
    noteCommitment: input.noteCommitment.toLowerCase(),
    poolId: input.poolId,
    origin:
      typeof window === "undefined"
        ? "server"
        : window.location.origin.toLowerCase(),
  };
}

async function deriveBackupKey(input: {
  metadata: ReturnType<typeof backupMetadata>;
  ownerAddress: string;
  networkPassphrase: string;
  salt: Uint8Array;
}): Promise<CryptoKey> {
  const signed = await signFreighterMessage(backupSigningMessage(input.metadata), {
    address: input.ownerAddress,
    networkPassphrase: input.networkPassphrase,
  });
  if (
    signed.signerAddress &&
    signed.signerAddress !== input.ownerAddress
  ) {
    throw new Error("Freighter signed note backup with a different Stellar account");
  }
  const signatureBytes = Uint8Array.from(
    decodeSignatureBytes(signed.signedMessage)
  );
  const baseKey = await crypto.subtle.importKey(
    "raw",
    webCryptoBytes(signatureBytes),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: webCryptoBytes(input.salt),
      info: webCryptoBytes(encoder.encode(canonicalMetadata(input.metadata))),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function backupSigningMessage(
  metadata: ReturnType<typeof backupMetadata>
): string {
  return [
    "Nebula Relay encrypted note backup",
    "Version: 1",
    `Intent: ${metadata.intentId}`,
    `Stellar owner: ${metadata.stellarAccount}`,
    `Note commitment: ${metadata.noteCommitment}`,
    `Private pool: ${metadata.poolId}`,
    `Origin: ${metadata.origin}`,
    "This signature encrypts or decrypts your local private-note backup.",
    "Nebula never receives this signature or any plaintext note material.",
  ].join("\n");
}

function canonicalMetadata(metadata: ReturnType<typeof backupMetadata>): string {
  return JSON.stringify({
    format: metadata.format,
    schemaVersion: metadata.schemaVersion,
    intentId: metadata.intentId,
    stellarAccount: metadata.stellarAccount,
    noteCommitment: metadata.noteCommitment,
    poolId: metadata.poolId,
    origin: metadata.origin,
  });
}

function validateRestoredNote(
  value: unknown,
  backup: BridgeNoteBackupRecord
): NebulaNoteRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Encrypted backup did not contain a note record");
  }
  const record = value as Partial<NebulaNoteRecord>;
  if (record.schemaVersion !== 1) {
    throw new Error("Encrypted note backup schema is unsupported");
  }
  if (record.intentId !== backup.intentId) {
    throw new Error("Encrypted note backup intent mismatch");
  }
  if (record.ownerAddress !== backup.stellarAccount) {
    throw new Error("Encrypted note backup owner mismatch");
  }
  if (
    typeof record.noteCommitment !== "string" ||
    record.noteCommitment.toLowerCase() !== backup.noteCommitment.toLowerCase()
  ) {
    throw new Error("Encrypted note backup commitment mismatch");
  }
  if (record.poolId !== backup.poolId) {
    throw new Error("Encrypted note backup pool mismatch");
  }
  if (!record.preparedProverResult) {
    throw new Error("Encrypted note backup is missing prepared proof metadata");
  }
  return record as NebulaNoteRecord;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function webCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}
