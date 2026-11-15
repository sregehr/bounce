/** Which screens carry the bottom tab bar, and which part of it each one lights up. */
export type Tab = 'home' | 'vault' | 'mic' | 'player' | 'settings';

const TABS: Record<string, Tab> = {
  // Getting a beat in.
  '/': 'home',
  '/beat': 'home',
  '/capture': 'home',
  '/record': 'home',
  '/demos': 'home',
  '/vault': 'vault',
  // Recording over it: the mic button in the middle.
  '/vocals': 'mic',
  // Everything done to the song once there is something to hear.
  '/playback': 'player',
  '/advanced': 'player',
  '/master': 'player',
  '/export': 'player',
  '/cover': 'player',
  '/snippet': 'player',
  '/player': 'player',
  '/settings': 'settings',
};

/** Height of the bar's row of tabs, not counting the home-indicator inset below it. */
export const TAB_BAR_HEIGHT = 54;

/** The tab for a path, or null on the few screens without the bar (the welcome). */
export const tabFor = (pathname: string): Tab | null => TABS[pathname] ?? null;
