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
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Storage is not available in this browser.'));
    });
  }
  return opened;
}

async function run<T>(store: 'kv' | 'blobs', mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? new Error('Could not save.'));
    tx.onabort = () => reject(tx.error ?? new Error('Storage is full or unavailable.'));
  });
}

export const kv = {
  get: <T,>(key: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(key)),
  set: (key: string, value: unknown) => run('kv', 'readwrite', (s) => s.put(value, key)).then(() => {}),
};

export const blobs = {
  get: (key: string) => run<Blob | undefined>('blobs', 'readonly', (s) => s.get(key)),
  put: (key: string, blob: Blob) => run('blobs', 'readwrite', (s) => s.put(blob, key)).then(() => {}),
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
