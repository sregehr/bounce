import type { Settings } from './model';

/** What the sound travels through: the microphone in use and, where the browser says, what the beat plays out of. */
export type Route = { input: string; output: string };

// Wireless speakers and earbuds add a long delay that browsers often leave out of what they report.
const WIRELESS = /bluetooth|airpods|buds|beats|bose|jbl|sonos|sony|wh-|wf-|soundcore|anker|jabra|ue boom|megaboom|wireless|hands-free/i;
const WIRELESS_MS = 230;
/** A reported delay this long means a wireless link, whatever the device is called. */
const FAR_MS = 120;

const isWireless = (route: Route) => WIRELESS.test(route.input) || WIRELESS.test(route.output);

/**
 * Names a setup so its timing can be remembered. Phones often hide what the beat plays out of,
 * so a long reported delay counts as part of the name: the same mic through a wireless speaker
 * is a different setup from the same mic through the phone's own speaker.
 */
export function routeKey(route: Route, reportedMs: number): string {
  const far = reportedMs >= FAR_MS || isWireless(route);
  return [route.input.trim().toLowerCase() || 'input', route.output.trim().toLowerCase() || 'output', far ? 'far' : 'near'].join('|');
}

/** The best guess for a setup that has not been measured. */
export const estimateMs = (route: Route, reportedMs: number) => (isWireless(route) && reportedMs < FAR_MS ? WIRELESS_MS : reportedMs);

/** How far takes are moved for this setup: its own measurement when there is one, otherwise an estimate. */
export function timingFor(settings: Pick<Settings, 'latencyMs' | 'timing'>, route: Route, reportedMs: number): { ms: number; measured: boolean } {
  const known = settings.timing?.[routeKey(route, reportedMs)];
  if (known !== undefined) return { ms: known, measured: true };
  // A figure measured before setups were told apart stands in until one of them is measured.
  if (!settings.timing && settings.latencyMs !== null) return { ms: settings.latencyMs, measured: true };
  return { ms: estimateMs(route, reportedMs), measured: false };
}

/** Records a measurement for this setup, or forgets it when `ms` is null. */
export function withTiming(settings: Pick<Settings, 'latencyMs' | 'timing'>, route: Route, reportedMs: number, ms: number | null): Pick<Settings, 'latencyMs' | 'timing'> {
  const timing = { ...settings.timing };
  const key = routeKey(route, reportedMs);
  if (ms === null) delete timing[key];
  else timing[key] = Math.max(0, Math.min(500, Math.round(ms)));
  return { timing, latencyMs: ms === null ? null : timing[key] };
}
