import { setupConvexAuth } from "@convex-dev/auth/server";
import { setupApple } from "@convex-dev/auth/methods/apple/server";
import { setupGoogle } from "@convex-dev/auth/methods/google/server";

import { components, internal } from "./_generated/api";

/**
 * Where a sign-in is allowed to come back to: the web app's own addresses (APP_ORIGINS, a
 * comma-separated list) and this server, which passes a phone sign-in on to the app
 * (see http.ts).
 */
const origins = [
  ...(process.env.APP_ORIGINS ?? "http://localhost:8081").split(",").map((o: string) => o.trim()).filter(Boolean),
  ...(process.env.CONVEX_SITE_URL ? [process.env.CONVEX_SITE_URL] : []),
];

const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;

export const { startSignInWithGoogle, completeSignInWithGoogle } = setupGoogle(auth, {
  component: components.authGoogle,
  allowedRedirectOrigins: origins,
}).attachUserCallbacks({ createUser: internal.users.createFromGoogle, onSignIn: internal.users.signedInWithGoogle });

export const { startSignInWithApple, completeSignInWithApple } = setupApple(auth, {
  component: components.authApple,
  allowedRedirectOrigins: origins,
}).attachUserCallbacks({ createUser: internal.users.createFromApple, onSignIn: internal.users.signedInWithApple });
