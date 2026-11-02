import type { CaptureRecord, CaptureSummary } from '../types';

/**
 * Capture storage. Image data lives in IndexedDB (never chrome.storage), which
 * is shared by every context of the extension origin: service worker,
 * offscreen document and pages.
 */
const DB_NAME = 'localcapture';
const DB_VERSION = 1;
const CAPTURES = 'captures';
const BLOBS = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CAPTURES)) {
        const s = db.createObjectStore(CAPTURES, { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export function newId(): string {
  return `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(BLOBS, 'readwrite');
  tx.objectStore(BLOBS).put(blob, key);
  await txDone(tx);
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const db = await openDb();
  return done(db.transaction(BLOBS).objectStore(BLOBS).get(key) as IDBRequest<Blob | undefined>);
}

export async function putCapture(rec: CaptureRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(CAPTURES, 'readwrite');
  tx.objectStore(CAPTURES).put(rec);
  await txDone(tx);
}

export async function getCapture(id: string): Promise<CaptureRecord | undefined> {
  const db = await openDb();
  return done(db.transaction(CAPTURES).objectStore(CAPTURES).get(id) as IDBRequest<CaptureRecord | undefined>);
}

/** Read-modify-write in a single transaction. */
export async function updateCapture(
  id: string,
  fn: (rec: CaptureRecord) => CaptureRecord | void,
): Promise<CaptureRecord> {
  const db = await openDb();
  const tx = db.transaction(CAPTURES, 'readwrite');
  const store = tx.objectStore(CAPTURES);
  const rec = (await done(store.get(id))) as CaptureRecord | undefined;
  if (!rec) throw new Error(`Capture ${id} not found`);
  const next = fn(rec) ?? rec;
  store.put(next);
  await txDone(tx);
  return next;
}

export async function listCaptures(limit = 20): Promise<CaptureSummary[]> {
  const db = await openDb();
  const out: CaptureSummary[] = [];
  const tx = db.transaction(CAPTURES);
  const cursorReq = tx.objectStore(CAPTURES).index('createdAt').openCursor(null, 'prev');
  await new Promise<void>((resolve, reject) => {
    cursorReq.onsuccess = () => {
      const c = cursorReq.result;
      if (!c || out.length >= limit) return resolve();
      const r = c.value as CaptureRecord;
      out.push({ id: r.id, createdAt: r.createdAt, title: r.title, url: r.url, width: r.width, height: r.height, thumbKey: r.thumbKey, status: r.status });
      c.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
  return out;
}

export async function deleteCapture(id: string): Promise<void> {
  const rec = await getCapture(id);
  const db = await openDb();
  const tx = db.transaction([CAPTURES, BLOBS], 'readwrite');
  tx.objectStore(CAPTURES).delete(id);
  if (rec) {
    for (const t of rec.tiles) tx.objectStore(BLOBS).delete(t.key);
    if (rec.thumbKey) tx.objectStore(BLOBS).delete(rec.thumbKey);
  }
  await txDone(tx);
}
