// The phone build renders snippet videos natively; that arrives with the phone app.
export type SnippetVideo = { blob: Blob; extension: 'mp4' | 'webm' };
import type { TimedLine } from './lyricTiming';

export type SnippetCard = { title: string; artist: string; caption: string | null; credit: string | null; peaks: number[]; coverUrl: string | null; lines?: TimedLine[] | null };
export type SnippetShape = 'tall' | 'square' | 'wide';
export const videoSupported = () => false;
export const SCRIM: [number, number][] = [
  [0, 0.8],
  [0.4, 0.55],
  [0.62, 0.6],
  [1, 0.88],
];
export async function makeSnippetVideo(_audio: { channels: Float32Array[]; sampleRate: number }, _card: SnippetCard, _onProgress: (secondsLeft: number) => void, _shape?: SnippetShape): Promise<SnippetVideo> {
  throw new Error('Snippet videos are not available in this build yet.');
}
