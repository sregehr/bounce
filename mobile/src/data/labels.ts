import type { Project } from './model';

/** "92 BPM · F minor", with whichever parts are known. */
export const tempoLine = (p: Project) => [p.beat.bpm ? `${Math.round(p.beat.bpm)} BPM` : null, p.beat.musicalKey].filter(Boolean).join(' · ');
