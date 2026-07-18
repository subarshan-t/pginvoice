// Minimal IndexedDB key-value helper. Client Invoicing's parsed ClickUp export
// can run several MB as JSON (18k+ rows isn't unusual for a full org export) —
// too close to localStorage's ~5-10MB per-origin quota to risk sharing it with
// everything else the app already stores there. IndexedDB has no such practical
// ceiling for data this size, so the two large datasets live here; small settings
// (filters, name matches) still use localStorage elsewhere.
const DB_NAME = "pg-invoice-store";
const STORE = "kv";

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("indexedDB unavailable")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { return undefined; }
}

export async function idbSet(key, value) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { /* ignore — persistence is best-effort */ }
}

export async function idbDel(key) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { /* ignore */ }
}
