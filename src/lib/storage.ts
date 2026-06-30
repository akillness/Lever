import type { AdRow } from "./types";

export interface StoredDataset {
  id: string;
  name: string;
  rows: AdRow[];
  createdAt: number;
}

/**
 * Persistence seam. The engine and UI depend only on this interface, so the
 * backing store can swap from in-memory (demo) to Firestore/Supabase (production)
 * without touching business logic.
 */
export interface StorageAdapter {
  saveDataset(name: string, rows: AdRow[]): Promise<StoredDataset>;
  getDataset(id: string): Promise<StoredDataset | null>;
  listDatasets(): Promise<StoredDataset[]>;
}

/** Zero-config implementation used for the runnable demo. */
export class InMemoryStorage implements StorageAdapter {
  private store = new Map<string, StoredDataset>();
  private seq = 0;

  async saveDataset(name: string, rows: AdRow[]): Promise<StoredDataset> {
    const id = `ds-${++this.seq}`;
    const dataset: StoredDataset = { id, name, rows, createdAt: Date.now() };
    this.store.set(id, dataset);
    return dataset;
  }

  async getDataset(id: string): Promise<StoredDataset | null> {
    return this.store.get(id) ?? null;
  }

  async listDatasets(): Promise<StoredDataset[]> {
    return [...this.store.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
}

/**
 * Production adapter (Firebase). Wire this up by installing `firebase-admin`,
 * providing service-account creds via Vercel env vars, and mapping the same
 * three methods onto Firestore collections:
 *
 *   datasets/{id}            -> { name, createdAt }
 *   datasets/{id}/rows/{rid} -> AdRow
 *
 * The interface is identical, so the engine and UI need zero changes.
 * Left unconfigured by default to keep the demo dependency-free and runnable.
 */
export function createStorage(): StorageAdapter {
  // Swap to FirestoreStorage when FIREBASE_* env vars are present.
  return new InMemoryStorage();
}
