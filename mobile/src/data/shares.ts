// Listening links: a song put up on the server behind a link nobody could guess, with a small
// player page where friends leave notes pinned to a moment in the song.
import { ConvexHttpClient } from 'convex/browser';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { aacSupported, encodeM4a } from '@/dsp/aac';
import { wavePeaks } from '@/dsp/core';
import { encodeWav } from '@/dsp/wav';

import { LOUDNESS } from './exporting';
import type { Project } from './model';
import { artistOf } from './songs';
import { getLibrary } from './store';
import { getMix } from './studio';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
const site = process.env.EXPO_PUBLIC_CONVEX_SITE_URL || (url ?? '').replace(/\.convex\.cloud$/, '.convex.site');
const client = url ? new ConvexHttpClient(url) : null;

export const linksAvailable = !!client && !!site;
export type Note = { atSec: number; name: string; text: string; at: number };

const owner = () => ({ deviceId: getLibrary().settings.deviceId, secret: getLibrary().settings.deviceSecret });
// The site built for bounce.stefanstudio.com passes /s/<code> through to the server (worker.js), so there a link carries
// the page's own address. Anywhere else, such as a dev server or the phone app, it is the server's address.
const here = process.env.EXPO_PUBLIC_LINKS_HERE && typeof window !== 'undefined' && window.location?.origin?.startsWith('http') ? window.location.origin : '';
const linkFor = (token: string) => `${here || site}/s/${token}`;

/**
 * Renders the song as it would be shared, puts it on the server and returns its link. Making a
 * link again for the same song replaces the audio behind the same link.
 */
export async function makeLink(project: Project, onStage?: (stage: string) => void): Promise<string> {
  if (!client) throw new Error('This build has no server to host a listening link.');
  onStage?.('Rendering the song');
  const mix = await getMix(project, { targetLufs: LOUDNESS[project.exporting.loudness] });
  onStage?.('Making it small');
  // The small format where the browser can make it; otherwise a 16-bit WAV, which every browser plays.
  const small = await aacSupported(mix.sampleRate, mix.channels.length);
  const blob = small ? new Blob([await encodeM4a(mix.channels, mix.sampleRate, 192_000)], { type: 'audio/mp4' }) : new Blob([encodeWav(mix.channels, mix.sampleRate, 16)], { type: 'audio/wav' });
  onStage?.('Uploading');
  const target = await client.mutation(api.backup.uploadUrl, owner());
  const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
  if (!response.ok) throw new Error(`The upload failed (${response.status}). Try again.`);
  const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };
  const token = await client.mutation(api.shares.create, {
    ...owner(),
    localId: project.id,
    title: project.name,
    artist: artistOf(project, getLibrary().profile),
    audio: storageId,
    durationSec: mix.durationSec,
    peaks: wavePeaks(mix.channels, 96),
  });
  if (!token) throw new Error('That song is too long for a listening link, or this device already has as many links as it can. Take an old link down and try again.');
  return linkFor(token);
}

/** The link a song already has, if any, and the notes left on it. */
export async function linkNotes(projectId: string): Promise<{ link: string; notes: Note[] } | null> {
  if (!client) return null;
  const found = await client.query(api.shares.notes, { ...owner(), localId: projectId });
  return found ? { link: linkFor(found.token), notes: found.notes } : null;
}

/** Takes a song's link down, with its audio and its notes. */
export async function removeLink(projectId: string) {
  await client?.mutation(api.shares.remove, { ...owner(), localId: projectId });
}
