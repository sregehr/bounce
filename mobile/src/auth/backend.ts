// The connection to the Bounce server, shared by everything that needs to know who is signed
// in. A build with no server address (the static site) has none, and the app runs without it.
import { ConvexReactClient } from 'convex/react';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;

export const convex = url ? new ConvexReactClient(url, { unsavedChangesWarning: false }) : null;
export const backendAvailable = !!convex;
/** Where the server answers plain web requests; a phone sign-in comes back through it. */
export const siteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL ?? '';
