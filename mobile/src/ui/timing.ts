import { timingFor, withTiming, type Route } from '@/data/timing';
import { setSettings, useLibrary } from '@/data/store';
import { reportedLatencyMs, useEngine } from '@/engine/engine';

/** The timing correction for whatever is connected right now, and a way to set or forget it. */
export function useTiming() {
  const settings = useLibrary((l) => l.settings);
  const input = useEngine((e) => e.input.label);
  const output = useEngine((e) => e.input.output);
  const route: Route = { input, output };
  const reported = reportedLatencyMs();
  return {
    ...timingFor(settings, route, reported),
    route,
    /** Null goes back to the estimate for this setup. */
    set: (ms: number | null) => setSettings(withTiming(settings, route, reported, ms)),
  };
}
