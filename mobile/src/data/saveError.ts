/**
 * Why something could not be stored, in a sentence. Only a full device is called full: a browser that
 * refuses for another reason is named as that, with what it said, so the cause is not guessed at.
 */
export function whyNotSaved(e: unknown): string {
  const error = e as { name?: string; message?: string } | null;
  if (error?.name === 'QuotaExceededError') return 'Storage on this device is full.';
  const said = [error?.name && error.name !== 'Error' ? error.name : '', error?.message ?? ''].filter(Boolean).join(': ').slice(0, 160);
  return `This browser would not store it${said ? ` (${said})` : ''}.`;
}
