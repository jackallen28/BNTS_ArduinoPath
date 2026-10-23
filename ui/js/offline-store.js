// A tiny key-value store in IndexedDB for code that couldn't reach the
// server yet. Falls back to memory if IndexedDB isn't available.

const DB_NAME = "arduinopath";
const STORE = "pending";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function memoryStore() {
  const map = new Map();
  return {
    async get(k) { return map.get(k); },
    async set(k, v) { map.set(k, v); },
    async del(k) { map.delete(k); },
  };
}

let dbPromise = null;

function tx(mode, fn) {
  dbPromise ??= openDb();
  return dbPromise.then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const offlineStore = typeof indexedDB === "undefined" ? memoryStore() : {
  get: (k) => tx("readonly", (s) => s.get(k)),
  set: (k, v) => tx("readwrite", (s) => s.put(v, k)),
  del: (k) => tx("readwrite", (s) => s.delete(k)),
};
