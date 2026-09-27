import { api, ApiError } from "./api";

export type OfflineMutation = {
  id: string;
  path: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
};

const databaseName = "rasd-offline";
const storeName = "mutations";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(database.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function enqueueMutation(input: Pick<OfflineMutation, "path" | "method" | "body">) {
  const item: OfflineMutation = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), attempts: 0 };
  await withStore("readwrite", store => store.put(item));
  window.dispatchEvent(new Event("rasd:queue"));
  return item;
}

export async function listMutations() {
  const rows = await withStore<OfflineMutation[]>("readonly", store => store.getAll());
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const removeMutation = (id: string) => withStore("readwrite", store => store.delete(id));

/**
 * Replays queued mutations in order. Network/server failures stop the replay (retried later);
 * a request the server rejects as invalid is dropped so it cannot block everything queued behind it.
 * Returns the number of dropped mutations.
 */
export async function replayMutations() {
  let dropped = 0;
  for (const row of await listMutations()) {
    try {
      await api(row.path, { method: row.method, body: row.body, source: "mobile" });
    } catch (error) {
      const permanent = error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);
      if (!permanent) {
        await withStore("readwrite", store => store.put({ ...row, attempts: row.attempts + 1 }));
        throw error;
      }
      dropped += 1;
    }
    await removeMutation(row.id);
  }
  window.dispatchEvent(new Event("rasd:queue"));
  return dropped;
}
