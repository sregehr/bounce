// On a phone, sign-in happens in the system's sign-in sheet. The server sends it back to the
// app through the bounce:// link (convex/http.ts), carrying a one-time code.
import * as WebBrowser from 'expo-web-browser';

export const RETURN_PATH = '/auth/return';

const param = (url: string, name: string) => {
  const found = new RegExp(`[?&]${name}=([^&#]*)`).exec(url);
  return found ? decodeURIComponent(found[1]) : null;
};

/** Opens the provider's page and resolves with what came back, or null when the sheet was closed. */
export async function openSignIn(url: string): Promise<{ code: string | null; error: string | null } | null> {
  const result = await WebBrowser.openAuthSessionAsync(url, 'bounce://auth');
  if (result.type !== 'success') return null;
  return { code: param(result.url, 'convexAuthCode'), error: param(result.url, 'convexAuthError') };
}
