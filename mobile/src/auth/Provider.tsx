import { useEffect, type ReactNode } from 'react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { useConvexAuth, useMutation } from 'convex/react';

import { api } from '../../convex/_generated/api';
import { useLibrary, useReady } from '@/data/store';

import { convex } from './backend';
import { sessionStorage } from './storage';

/** Once someone is signed in, this device's backup is linked to their account. */
function ClaimBackup() {
  const { isAuthenticated } = useConvexAuth();
  const ready = useReady();
  const deviceId = useLibrary((l) => l.settings.deviceId);
  const claim = useMutation(api.backup.claim);
  useEffect(() => {
    if (isAuthenticated && ready) void claim({ deviceId }).catch(() => {});
  }, [isAuthenticated, ready, deviceId, claim]);
  return null;
}

/** Gives the app its server connection and sign-in state, when the build has a server. */
export function Backend({ children }: { children: ReactNode }) {
  if (!convex) return <>{children}</>;
  return (
    <ConvexAuthProvider client={convex} storage={sessionStorage} api={{ refreshSession: api.auth.refreshSession, signOut: api.auth.signOut, isAuthenticated: api.auth.isAuthenticated }}>
      <ClaimBackup />
      {children}
    </ConvexAuthProvider>
  );
}
