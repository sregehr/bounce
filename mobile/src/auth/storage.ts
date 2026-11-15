// Where the phone keeps the session: the keychain, so signing in survives closing the app.
import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from '@convex-dev/auth/react';

export const sessionStorage: TokenStorage | undefined = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};
