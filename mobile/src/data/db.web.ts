// Browser storage: one IndexedDB database with a table for the library and one for files.

const NAME = 'bounce';
let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('kv');
        request.result.createObjectStore('blobs');
      };
      request.onsuccess = () => {
        const db = request.result;
        // A connection the browser closed (or another tab upgraded) is opened again on the next use.
        db.onclose = () => void (opened = null);
        db.onversionchange = () => {
          db.close();
          opened = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        opened = null;
        reject(request.error ?? new Error('Storage is not available in this browser.'));
      };
      request.onblocked = () => {
        opened = null;
        reject(new Error('Storage is busy in another tab. Close other Bounce tabs and try again.'));
      };
    });
  }
  return opened;
}

async function run<T>(store: 'kv' | 'blobs', mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    // A write is committed at once instead of when the browser gets round to it, so one started as the page goes away still lands.
    if (mode === 'readwrite') tx.commit?.();
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? new Error('Could not save.'));
    tx.onabort = () => reject(tx.error ?? new Error('Storage is full or unavailable.'));
  });
}

export const kv = {
  get: <T,>(key: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(key)),
  set: (key: string, value: unknown) => run('kv', 'readwrite', (s) => s.put(value, key)).then(() => {}),
};

/** A file kept as its bytes, for a browser that will not store it as a file. */
type Bytes = { bytes: ArrayBuffer; type: string };
const isBytes = (stored: unknown): stored is Bytes => !!stored && !(stored instanceof Blob) && (stored as Bytes).bytes instanceof ArrayBuffer;
const full = (e: unknown) => (e as { name?: string } | null)?.name === 'QuotaExceededError';

export const blobs = {
  get: (key: string) => run<Blob | Bytes | undefined>('blobs', 'readonly', (s) => s.get(key)).then((stored) => (isBytes(stored) ? new Blob([stored.bytes], { type: stored.type }) : stored)),
  // Some browsers refuse a file in this kind of storage while it has room: other browsers on an iPhone, and private windows.
  // There the same file is kept as its bytes, and read back as a file. Out of room is still out of room.
  put: (key: string, blob: Blob) =>
    run('blobs', 'readwrite', (s) => s.put(blob, key))
      .catch(async (e) => {
        if (full(e)) throw e;
        const kept: Bytes = { bytes: await blob.arrayBuffer(), type: blob.type };
        await run('blobs', 'readwrite', (s) => s.put(kept, key));
      })
      .then(() => {}),
  delete: (key: string) => run('blobs', 'readwrite', (s) => s.delete(key)).then(() => {}),
  keys: () => run<IDBValidKey[]>('blobs', 'readonly', (s) => s.getAllKeys()).then((k) => k.map(String)),
};

/** Asks the browser not to clear this site's storage when space runs short. */
export async function persist() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Best effort.
  }
}

export const makeBlob = (data: ArrayBuffer, type: string) => new Blob([data], { type });
export const blobBytes = (blob: Blob) => blob.arrayBuffer();
export const blobUrl = (blob: Blob) => URL.createObjectURL(blob);
