import type { BridgeIntentRecord, BridgeQuote } from "@/lib/nebula-api";
import type { PrivateProverResult } from "@/lib/privateProver";

export type NoteBackupStatus = "local_only" | "backed_up" | "restored";
export type NoteRuntimeState =
  | "same_browser_runtime_required"
  | "runtime_recovery_pending"
  | "runtime_recovered";

export interface NebulaNoteRecord {
  storageKey: string;
  schemaVersion: 1;
  draftId: string;
  intentId: string | null;
  ownerAddress: string;
  poolId: string;
  amount: string;
  noteCommitment: string;
  preparedProverResult: PrivateProverResult;
  quote?: BridgeQuote;
  backupStatus: NoteBackupStatus;
  runtimeState: NoteRuntimeState;
  createdAt: string;
  updatedAt: string;
  remoteBackedUpAt?: string;
  restoredAt?: string;
}

const DB_NAME = "nebula-note-vault";
const DB_VERSION = 1;
const STORE_NAME = "notes";

export function createDraftNoteRecord(input: {
  ownerAddress: string;
  preparedProverResult: PrivateProverResult;
  quote?: BridgeQuote;
}): NebulaNoteRecord {
  const now = new Date().toISOString();
  const draftId = crypto.randomUUID();
  return {
    storageKey: `draft:${draftId}`,
    schemaVersion: 1,
    draftId,
    intentId: null,
    ownerAddress: input.ownerAddress,
    poolId: input.preparedProverResult.poolId,
    amount: input.preparedProverResult.amount,
    noteCommitment: input.preparedProverResult.outputCommitment,
    preparedProverResult: input.preparedProverResult,
    quote: input.quote,
    backupStatus: "local_only",
    runtimeState: "same_browser_runtime_required",
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveDraftNote(record: NebulaNoteRecord): Promise<void> {
  await putNote(record);
}

export async function promoteDraftNoteToIntent(input: {
  draftId: string;
  intent: BridgeIntentRecord;
  quote?: BridgeQuote;
}): Promise<NebulaNoteRecord> {
  const draft = await getNoteByStorageKey(`draft:${input.draftId}`);
  if (!draft) {
    throw new Error(
      "Prepared private note was not found in the local note vault",
    );
  }
  if (
    draft.noteCommitment.toLowerCase() !==
    input.intent.noteCommitment.toLowerCase()
  ) {
    throw new Error(
      "Prepared note commitment does not match the backend bridge intent",
    );
  }
  if (draft.poolId !== input.intent.poolId) {
    throw new Error(
      "Prepared note pool does not match the backend bridge intent",
    );
  }
  const promoted: NebulaNoteRecord = {
    ...draft,
    storageKey: `intent:${input.intent.id}`,
    intentId: input.intent.id,
    ownerAddress: input.intent.stellarAccount ?? draft.ownerAddress,
    quote: input.quote ?? draft.quote,
    backupStatus: "local_only",
    updatedAt: new Date().toISOString(),
  };
  await putNote(promoted);
  await deleteNote(draft.storageKey);
  return promoted;
}

export async function markNoteBackupSaved(
  intentId: string,
  backedUpAt: string,
): Promise<NebulaNoteRecord | null> {
  const record = await getNoteByIntentId(intentId);
  if (!record) {
    return null;
  }
  const updated: NebulaNoteRecord = {
    ...record,
    backupStatus: "backed_up",
    remoteBackedUpAt: backedUpAt,
    updatedAt: new Date().toISOString(),
  };
  await putNote(updated);
  return updated;
}

export async function storeRestoredNote(
  record: NebulaNoteRecord,
): Promise<NebulaNoteRecord> {
  if (!record.intentId) {
    throw new Error("Restored note backup is missing an intent id");
  }
  const restored: NebulaNoteRecord = {
    ...record,
    storageKey: `intent:${record.intentId}`,
    backupStatus: "restored",
    runtimeState: "runtime_recovery_pending",
    restoredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await putNote(restored);
  return restored;
}

export async function markNoteRuntimeState(
  intentId: string,
  runtimeState: NoteRuntimeState,
): Promise<NebulaNoteRecord | null> {
  const record = await getNoteByIntentId(intentId);
  if (!record) {
    return null;
  }
  const updated: NebulaNoteRecord = {
    ...record,
    runtimeState,
    updatedAt: new Date().toISOString(),
  };
  await putNote(updated);
  return updated;
}

export async function getNoteByIntentId(
  intentId: string,
): Promise<NebulaNoteRecord | null> {
  return getByIndex("intentId", intentId);
}

export async function getNoteByCommitment(
  noteCommitment: string,
): Promise<NebulaNoteRecord | null> {
  return getByIndex("noteCommitment", noteCommitment);
}

async function putNote(record: NebulaNoteRecord): Promise<void> {
  const db = await openVault();
  await requestToPromise(
    db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(record),
  );
  db.close();
}

async function deleteNote(storageKey: string): Promise<void> {
  const db = await openVault();
  await requestToPromise(
    db
      .transaction(STORE_NAME, "readwrite")
      .objectStore(STORE_NAME)
      .delete(storageKey),
  );
  db.close();
}

async function getNoteByStorageKey(
  storageKey: string,
): Promise<NebulaNoteRecord | null> {
  const db = await openVault();
  const result = await requestToPromise<NebulaNoteRecord | undefined>(
    db
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .get(storageKey),
  );
  db.close();
  return result ?? null;
}

async function getByIndex(
  indexName: "intentId" | "noteCommitment",
  value: string,
): Promise<NebulaNoteRecord | null> {
  const db = await openVault();
  const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
  const result = await requestToPromise<NebulaNoteRecord | undefined>(
    store.index(indexName).get(value),
  );
  db.close();
  return result ?? null;
}

function openVault(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is unavailable in this browser"),
    );
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: "storageKey" });
      if (!store) {
        throw new Error("Unable to initialize note vault");
      }
      if (!store.indexNames.contains("intentId")) {
        store.createIndex("intentId", "intentId", { unique: false });
      }
      if (!store.indexNames.contains("noteCommitment")) {
        store.createIndex("noteCommitment", "noteCommitment", {
          unique: false,
        });
      }
      if (!store.indexNames.contains("ownerAddress")) {
        store.createIndex("ownerAddress", "ownerAddress", { unique: false });
      }
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open note vault"));
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
    request.onsuccess = () => resolve(request.result);
  });
}
