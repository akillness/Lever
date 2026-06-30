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
  /** Monotonic insertion order — breaks createdAt ties deterministically. */
  private order = new Map<string, number>();

  async saveDataset(name: string, rows: AdRow[]): Promise<StoredDataset> {
    const id = `ds-${++this.seq}`;
    const dataset: StoredDataset = { id, name, rows, createdAt: Date.now() };
    this.store.set(id, dataset);
    this.order.set(id, this.seq);
    return dataset;
  }

  async getDataset(id: string): Promise<StoredDataset | null> {
    return this.store.get(id) ?? null;
  }

  async listDatasets(): Promise<StoredDataset[]> {
    return [...this.store.values()].sort(
      (a, b) =>
        b.createdAt - a.createdAt ||
        (this.order.get(b.id) ?? 0) - (this.order.get(a.id) ?? 0),
    );
  }
}

/**
 * Production adapter — Google Firestore via `firebase-admin`.
 *
 * Layout:
 *   datasets/{id} -> { name, rows: AdRow[], createdAt }
 *
 * Credentials come from env vars (set these in Vercel project settings):
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * or a GOOGLE_APPLICATION_CREDENTIALS path (application-default credentials).
 *
 * Lazily imports firebase-admin so the in-memory demo never pays the cost.
 */
export class FirestoreStorage implements StorageAdapter {
  private dbPromise: Promise<import("firebase-admin/firestore").Firestore> | null =
    null;
  private readonly collection: string;

  constructor(collection = "datasets") {
    this.collection = collection;
  }

  private async db() {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const { getApps, initializeApp, cert, applicationDefault } =
          await import("firebase-admin/app");
        const { getFirestore } = await import("firebase-admin/firestore");
        if (getApps().length === 0) {
          const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } =
            process.env;
          initializeApp({
            credential:
              FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY
                ? cert({
                    projectId: FIREBASE_PROJECT_ID,
                    clientEmail: FIREBASE_CLIENT_EMAIL,
                    // Vercel stores newlines as literal "\n"; restore them.
                    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
                  })
                : applicationDefault(),
          });
        }
        return getFirestore();
      })();
    }
    return this.dbPromise;
  }

  async saveDataset(name: string, rows: AdRow[]): Promise<StoredDataset> {
    const db = await this.db();
    const ref = db.collection(this.collection).doc();
    const dataset: StoredDataset = {
      id: ref.id,
      name,
      rows,
      createdAt: Date.now(),
    };
    await ref.set(dataset);
    return dataset;
  }

  async getDataset(id: string): Promise<StoredDataset | null> {
    const db = await this.db();
    const snap = await db.collection(this.collection).doc(id).get();
    return snap.exists ? (snap.data() as StoredDataset) : null;
  }

  async listDatasets(): Promise<StoredDataset[]> {
    const db = await this.db();
    const snap = await db
      .collection(this.collection)
      .orderBy("createdAt", "desc")
      .get();
    return snap.docs.map((d) => d.data() as StoredDataset);
  }
}

/** True when Firebase service-account env vars are configured. */
export function hasFirebaseConfig(): boolean {
  return Boolean(
    (process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY) ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
  );
}

/**
 * Selects the backing store: Firestore in production (when configured),
 * in-memory otherwise. The engine and UI depend only on `StorageAdapter`,
 * so this swap is invisible to business logic.
 *
 * Memoized per process so the in-memory adapter actually persists across
 * requests within a running server (Firestore is stateless either way).
 */
let cached: StorageAdapter | null = null;

export function createStorage(): StorageAdapter {
  if (!cached) {
    cached = hasFirebaseConfig()
      ? new FirestoreStorage()
      : new InMemoryStorage();
  }
  return cached;
}

/** Test/maintenance hook: drop the memoized adapter so the next call rebuilds it. */
export function resetStorageCache(): void {
  cached = null;
}