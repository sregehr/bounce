/** Which screens carry the navigation, and which part of it each one lights up. */
export type Tab = 'home' | 'song' | 'mic' | 'mix' | 'vault' | 'settings';

const TABS: Record<string, Tab> = {
  // Getting a beat in.
  '/': 'home',
  '/capture': 'home',
  '/record': 'home',
  // Recording over it: the mic button in the middle.
  '/vocals': 'mic',
  // The song being worked on: its takes and lyrics.
  '/song': 'song',
  // The sound of the chosen take, and the steps that finish a song.
  '/playback': 'mix',
  '/vault': 'vault',
  // Behind the personal menu in the top bar.
  '/profile': 'settings',
  '/settings': 'settings',
};

// Mastering works on a beat on its way to the Vault, and on a finished song opened from it.
// The player, the cover, sharing, the snippet and the demo songs are sheets over whichever
// screen opened them (see `SHEETS` in `nav.tsx`), with no navigation around them.
const EITHER = ['/master'];

/**
 * True on mastering. It has its own way back in the top corner, so the bottom bar steps aside
 * rather than float over its buttons.
 */
export const hidesTabBar = (pathname: string) => EITHER.includes(pathname);

/** Height of the top bar with the logo, not counting the status-bar inset above it. */
export const TOP_NAV_HEIGHT = 48;

/** The tab for a path, or null on the few screens without navigation (the welcome). `finished` says whether a finished song is open. */
export const tabFor = (pathname: string, finished = false): Tab | null => TABS[pathname] ?? (EITHER.includes(pathname) ? (finished ? 'vault' : 'mix') : null);
