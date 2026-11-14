// The phone build hands files to the system share sheet; that is wired up with the phone app.
export type OutFile = { name: string; data: ArrayBuffer | Blob; type: string };
export async function saveFiles(_files: OutFile[], _bundle?: string): Promise<string> {
  return '';
}
export const canShareFiles = () => false;
export async function shareFiles(_files: OutFile[], _title: string): Promise<'shared' | 'saved' | 'cancelled'> {
  return 'cancelled';
}
export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  return null;
}
