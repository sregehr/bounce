// The phone build renders snippet videos natively; that arrives with the phone app.
export type SnippetVideo = { blob: Blob; extension: 'mp4' | 'webm' };
export type SnippetCard = { title: string; artist: string; caption: string | null; credit: string | null; peaks: number[]; coverUrl: string | null };
export const videoSupported = () => false;
export async function makeSnippetVideo(_audio: { channels: Float32Array[]; sampleRate: number }, _card: SnippetCard, _onProgress: (secondsLeft: number) => void): Promise<SnippetVideo> {
  throw new Error('Snippet videos are not available in this build yet.');
}
