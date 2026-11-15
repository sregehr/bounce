import type { TokenStorage } from '@convex-dev/auth/react';

// In a browser the session lives in the site's own storage, which is the library's default.
export const sessionStorage: TokenStorage | undefined = undefined;
