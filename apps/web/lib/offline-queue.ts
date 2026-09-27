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

export async function enqueueMutation(input: Omit<OfflineMutation, "id" | "createdAt" | "attempts">) {
  const database = await openDatabase();
  const item: OfflineMutation = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), attempts: 0 };
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(storeName, "readwrite").objectStore(storeName).put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
  window.dispatchEvent(new Event("rasd:queue"));
  return item;
}

export async function listMutations(): Promise<OfflineMutation[]> {
  const database = await openDatabase();
  const rows = await new Promise<OfflineMutation[]>((resolve, reject) => {
    const request = database.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result as OfflineMutation[]).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
  });
  database.close();
  return rows;
}

export async function removeMutation(id: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(storeName, "readwrite").objectStore(storeName).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
}

export async function replayMutations() {
  const rows = await listMutations();
  const token=localStorage.getItem("rasd:token");
  for (const row of rows) {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000"}/api/v1${row.path}`, {
      method: row.method,
      headers: { "content-type": "application/json", ...(token?{authorization:`Bearer ${token}`}:{}) },
      body: JSON.stringify(row.body),
    });
    if (!response.ok) throw new Error("تعذّرت مزامنة التغييرات");
    await removeMutation(row.id);
  }
  window.dispatchEvent(new Event("rasd:queue"));
}
