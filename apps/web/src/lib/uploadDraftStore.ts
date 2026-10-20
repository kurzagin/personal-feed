import type { TagCategory } from "@personal-feed/shared";

const DB_NAME = "personal_feed_uploads";
const DB_VERSION = 1;
const STORE_NAME = "drafts";
const DRAFT_KEY = "current";
export const ACTIVE_UPLOAD_STORAGE_KEY = "pf_active_upload_id";

export type PersistedDraftPhase = "draft" | "uploading" | "processing";

interface StoredFileEntry {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
}

interface RawPersistedRecord {
  id: string;
  phase: PersistedDraftPhase;
  uploadId: string | null;
  files: StoredFileEntry[];
  tags: Array<{ name: string; category: TagCategory }>;
  updatedAt: number;
}

export interface RestoredUploadDraft {
  phase: PersistedDraftPhase;
  uploadId: string | null;
  files: File[];
  tags: Array<{ name: string; category: TagCategory }>;
  updatedAt: number;
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not supported"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function setActiveUploadIdInStorage(uploadId: string | null) {
  try {
    if (uploadId) {
      localStorage.setItem(ACTIVE_UPLOAD_STORAGE_KEY, uploadId);
    } else {
      localStorage.removeItem(ACTIVE_UPLOAD_STORAGE_KEY);
    }
  } catch {}
}

export function getActiveUploadIdFromStorage(): string | null {
  try {
    return localStorage.getItem(ACTIVE_UPLOAD_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function saveUploadDraft(params: {
  phase: PersistedDraftPhase;
  uploadId: string | null;
  files: File[];
  tags: Array<{ name: string; category: TagCategory }>;
}): Promise<void> {
  setActiveUploadIdInStorage(params.uploadId);

  if (params.files.length === 0) {
    await clearUploadDraft();
    return;
  }

  try {
    const storedFiles: StoredFileEntry[] = await Promise.all(
      params.files.map(async (f) => {
        const buf = await f.arrayBuffer();
        return {
          name: f.name,
          type: f.type,
          lastModified: f.lastModified,
          blob: new Blob([buf], { type: f.type }),
        };
      })
    );

    const record: RawPersistedRecord = {
      id: DRAFT_KEY,
      phase: params.phase,
      uploadId: params.uploadId,
      files: storedFiles,
      tags: params.tags,
      updatedAt: Date.now(),
    };

    const db = await openDraftDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn("Failed to persist upload draft in IndexedDB:", err);
  }
}

export async function updateUploadDraftStatus(patch: {
  phase: PersistedDraftPhase;
  uploadId: string | null;
  tags?: Array<{ name: string; category: TagCategory }>;
}): Promise<void> {
  setActiveUploadIdInStorage(patch.uploadId);

  try {
    const db = await openDraftDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(DRAFT_KEY);
      getReq.onsuccess = () => {
        const existing = getReq.result as RawPersistedRecord | undefined;
        if (existing) {
          existing.phase = patch.phase;
          existing.uploadId = patch.uploadId;
          if (patch.tags !== undefined) {
            existing.tags = patch.tags;
          }
          existing.updatedAt = Date.now();
          store.put(existing);
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn("Failed to update upload draft status:", err);
  }
}

export async function loadUploadDraft(): Promise<RestoredUploadDraft | null> {
  try {
    const db = await openDraftDb();
    const record = await new Promise<RawPersistedRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(DRAFT_KEY);
      req.onsuccess = () => {
        db.close();
        resolve(req.result as RawPersistedRecord | undefined);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });

    if (!record || !record.files || record.files.length === 0) {
      return null;
    }

    const restoredFiles = record.files.map(
      (entry) =>
        new File([entry.blob], entry.name, {
          type: entry.type,
          lastModified: entry.lastModified,
        })
    );

    return {
      phase: record.phase,
      uploadId: record.uploadId,
      files: restoredFiles,
      tags: record.tags || [],
      updatedAt: record.updatedAt,
    };
  } catch (err) {
    console.warn("Failed to load upload draft from IndexedDB:", err);
    return null;
  }
}

export async function clearUploadDraft(): Promise<void> {
  setActiveUploadIdInStorage(null);
  try {
    const db = await openDraftDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(DRAFT_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn("Failed to clear upload draft from IndexedDB:", err);
  }
}
