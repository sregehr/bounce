/** Which screens carry the navigation, and which part of it each one lights up. */
export type Tab = 'home' | 'mix' | 'mic' | 'vault' | 'player' | 'settings';

const TABS: Record<string, Tab> = {
  // Getting a beat in.
  '/': 'home',
  '/beat': 'home',
  '/capture': 'home',
  '/record': 'home',
  '/demos': 'home',
  // Recording over it: the mic button in the middle.
  '/vocals': 'mic',
  // The song page: takes, mix, and the steps that finish a song.
  '/playback': 'mix',
  '/vault': 'vault',
  '/player': 'player',
  '/settings': 'settings',
};

// These work on a beat on its way to the Vault, and on a finished song opened from the Player.
const EITHER = ['/master', '/cover', '/export', '/snippet'];

/** Height of the bar's row of tabs, not counting the home-indicator inset below it. */
export const TAB_BAR_HEIGHT = 54;
/** Height of the top bar with the logo, not counting the status-bar inset above it. */
export const TOP_NAV_HEIGHT = 48;

/** The tab for a path, or null on the few screens without navigation (the welcome). `finished` says whether a finished song is open. */
export const tabFor = (pathname: string, finished = false): Tab | null => TABS[pathname] ?? (EITHER.includes(pathname) ? (finished ? 'player' : 'mix') : null);
