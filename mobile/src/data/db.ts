// Phone storage goes here (files on disk). Until the phone build is wired up this keeps
// everything in memory so the app runs, without saving between launches.

type FileLike = { data: ArrayBuffer; type: string };
const memory = new Map<string, unknown>();
const files = new Map<string, FileLike>();

export const kv = {
  get: async <T,>(key: string) => memory.get(key) as T | undefined,
  set: async (key: string, value: unknown) => void memory.set(key, value),
};

export const blobs = {
  get: async (key: string) => files.get(key) as unknown as Blob | undefined,
  put: async (key: string, blob: Blob) => void files.set(key, blob as unknown as FileLike),
  delete: async (key: string) => void files.delete(key),
  keys: async () => [...files.keys()],
};

export async function persist() {}
export const makeBlob = (data: ArrayBuffer, type: string) => ({ data, type }) as unknown as Blob;
export const blobBytes = async (blob: Blob) => (blob as unknown as FileLike).data;
export const blobUrl = (_blob: Blob) => '';
