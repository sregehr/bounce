import type { Project } from './model';

/**
 * What to call the thing a beat is played from. A connected sampler or interface goes by its
 * own name ("MPC LIVE III", "Scarlett 2i2"); a built-in microphone, or nothing yet, is "your gear".
 */
export const gearName = (label?: string | null) => (label && !/microphone|\bmic\b|built-in|default|audio input|airpods|headset|webcam/i.test(label) ? label : 'your gear');

/** "92 BPM · F minor", with whichever parts are known. */
export const tempoLine = (p: Project) => [p.beat.bpm ? `${Math.round(p.beat.bpm)} BPM` : null, p.beat.musicalKey].filter(Boolean).join(' · ');
