/** Which screens carry the bottom tab bar, and which tab each one lights up. */
export type Tab = 'home' | 'vault' | 'player' | 'settings';

const TABS: Record<string, Tab> = {
  '/': 'home',
  '/beat': 'home',
  '/vault': 'vault',
  '/player': 'player',
  '/settings': 'settings',
};

/** Height of the bar's row of tabs, not counting the home-indicator inset below it. */
export const TAB_BAR_HEIGHT = 54;

/** The tab for a path, or null on the focused screens that hide the bar. */
export const tabFor = (pathname: string): Tab | null => TABS[pathname] ?? null;
