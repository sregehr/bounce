import { useEffect, type ReactNode } from 'react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { useConvexAuth, useMutation } from 'convex/react';
import { router, useGlobalSearchParams, usePathname, type Href } from 'expo-router';

import { api } from '../../convex/_generated/api';
import { useLibrary, useReady } from '@/data/store';

import { convex } from './backend';
import { sessionStorage } from './storage';

/** Once someone is signed in, this device's backup is linked to their account. */
function ClaimBackup() {
  const { isAuthenticated } = useConvexAuth();
  const ready = useReady();
  const deviceId = useLibrary((l) => l.settings.deviceId);
  const secret = useLibrary((l) => l.settings.deviceSecret);
  const claim = useMutation(api.backup.claim);
  useEffect(() => {
    if (isAuthenticated && ready) void claim({ deviceId, secret }).catch(() => {});
  }, [isAuthenticated, ready, deviceId, secret, claim]);
  return null;
}

/**
 * Coming back from a sign-in leaves its one-time code in the address. The sign-in library
 * takes it out, but the router puts back the address it remembers, so it is dropped here too.
 */
function TidyAddress() {
  const { isLoading } = useConvexAuth();
  const { convexAuthCode, ...rest } = useGlobalSearchParams<Record<string, string>>();
  const pathname = usePathname();
  useEffect(() => {
    if (!convexAuthCode || isLoading) return;
    const query = new URLSearchParams(rest).toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as Href);
  }, [convexAuthCode, isLoading, pathname, rest]);
  return null;
}

/** Gives the app its server connection and sign-in state, when the build has a server. */
export function Backend({ children }: { children: ReactNode }) {
  if (!convex) return <>{children}</>;
  return (
    <ConvexAuthProvider client={convex} storage={sessionStorage} api={{ refreshSession: api.auth.refreshSession, signOut: api.auth.signOut, isAuthenticated: api.auth.isAuthenticated }}>
      <ClaimBackup />
      <TidyAddress />
      {children}
    </ConvexAuthProvider>
  );
}
