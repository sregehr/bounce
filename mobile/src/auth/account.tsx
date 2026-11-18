// Signing in and out. Everything here needs the server connection, so screens only render
// these when `backendAvailable` is true.
import { Platform, View } from 'react-native';
import { useAuthActions } from '@convex-dev/auth/react';
import { useSignInWithApple } from '@convex-dev/auth/methods/apple/react';
import { useOauth, useSignInWithGoogle, type OauthFlowError } from '@convex-dev/auth/methods/google/react';
import { useConvexAuth, useQuery } from 'convex/react';

import { api } from '../../convex/_generated/api';
import { Btn, Card, Foot, Muted, NavLink, Txt } from '@/ui/kit';
import { useTask } from '@/ui/hooks';
import { C } from '@/ui/theme';

import { siteUrl } from './backend';
import { openSignIn, RETURN_PATH } from './open';

export function useAccount() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : 'skip');
  return { loading: isLoading || (isAuthenticated && me === undefined), signedIn: isAuthenticated && !!me, me: me ?? null };
}

const WHY: Record<OauthFlowError['error'], string> = {
  ACCESS_DENIED: 'Sign-in was cancelled.',
  EXPIRED: 'That sign-in took too long. Try again.',
  INVALID_FLOW: 'Sign-in did not finish. Try again.',
  OTHER_ERROR: 'Sign-in did not finish. Try again.',
};

/**
 * The Google and Apple buttons. In a browser the page leaves for the provider and comes back
 * to `returnTo` (or to where it was); on a phone it happens in a sheet over the app.
 */
export function SignIn({ returnTo }: { returnTo?: string }) {
  const methods = useQuery(api.users.methods);
  const google = useSignInWithGoogle(api.auth);
  const apple = useSignInWithApple(api.auth);
  const { flowError } = useOauth();
  const task = useTask();
  const web = Platform.OS === 'web';

  const start = (signIn: typeof google.signIn) =>
    task.run(async () => {
      const started = await signIn({ redirectTo: web ? (returnTo ? window.location.origin + returnTo : undefined) : siteUrl + RETURN_PATH });
      if (started.status === 'error') throw new Error('Sign-in could not be started. Check the connection and try again.');
      if (web) {
        // The page is on its way to the provider; keep the buttons busy until it goes.
        await new Promise((r) => setTimeout(r, 8000));
        return;
      }
      const back = await openSignIn(started.redirect.toString());
      if (!back) return;
      if (!back.code) throw new Error(back.error === 'access_denied' ? WHY.ACCESS_DENIED : WHY.OTHER_ERROR);
      const done = await signIn({ code: back.code });
      if (done.status === 'error') throw new Error(WHY[done.userError.error]);
    });

  if (!methods) return <Muted size={13}>Checking sign-in…</Muted>;
  if (!methods.google && !methods.apple) return <Muted size={13}>Sign-in is not set up on this server yet.</Muted>;
  const problem = task.error ?? (flowError ? WHY[flowError.error] : null);
  return (
    <View style={{ gap: 8 }}>
      {methods.apple && <Btn kind="light" size={17} style={{ minHeight: 52 }} label="Continue with Apple" busy={task.busy} onPress={() => start(apple.signIn)} />}
      {methods.google && <Btn kind="outline" label="Continue with Google" busy={task.busy} onPress={() => start(google.signIn)} />}
      {problem && (
        <Txt size={13} color={C.recText}>
          {problem}
        </Txt>
      )}
    </View>
  );
}

/** Who is signed in, with a way out; or the sign-in buttons. */
export function AccountPanel({ returnTo }: { returnTo?: string }) {
  const { loading, signedIn, me } = useAccount();
  const { signOut } = useAuthActions();
  if (loading) return <Muted size={13}>Checking sign-in…</Muted>;
  if (!signedIn || !me) return <SignIn returnTo={returnTo} />;
  return (
    <Card style={{ padding: 16, gap: 6 }}>
      <Txt size={16} w="semi">
        {me.name ?? me.email ?? 'Signed in'}
      </Txt>
      {me.name && me.email ? <Muted size={13}>{me.email}</Muted> : null}
      <Muted size={13}>{me.aiLeft === null ? 'AI covers: no limit.' : `AI covers: ${me.aiLeft} free left.`}</Muted>
      <NavLink size={14} onPress={() => void signOut()}>
        Sign out
      </NavLink>
    </Card>
  );
}

/** The optional account step of the welcome. */
export function AccountStep({ onNext }: { onNext: () => void }) {
  const { signedIn, me } = useAccount();
  return (
    <>
      <View style={{ gap: 8, paddingTop: 24 }}>
        <Txt size={34} w="display" lh={1.05}>
          {signedIn ? `Signed in${me?.name ? `, ${me.name.split(' ')[0]}` : ''}.` : 'Keep it yours'}
        </Txt>
        <Muted size={15}>An account lets you make cover art with AI and puts your name on your backup. Recording, mixing and exporting all work without one.</Muted>
      </View>
      <AccountPanel returnTo="/onboarding?step=account" />
      <Foot>
        {signedIn ? <Btn label="Continue" onPress={onNext} /> : <Btn kind="outline" label="Not now" onPress={onNext} />}
      </Foot>
    </>
  );
}
