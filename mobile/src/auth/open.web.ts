// In a browser the whole page goes to the provider and comes back, so there is nothing to open.
export const RETURN_PATH = '/auth/return';

export async function openSignIn(_url: string): Promise<{ code: string | null; error: string | null } | null> {
  return null;
}
