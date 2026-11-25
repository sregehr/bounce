import { encodeM4a } from '@/dsp/aac';
import { encodeWav } from '@/dsp/wav';

import type { Tags } from '@/dsp/tags';

import { coverFor } from './coverImage';
import type { OutFile } from './files';
import type { ExportChoice, Profile, Project } from './model';
import { artistOf } from './songs';
import { activeTake, getLibrary } from './store';
import { dropStages, getMix, keepOnlyMix } from './studio';

export const LOUDNESS: Record<ExportChoice['loudness'], number | undefined> = { streaming: -14, loud: -9, mastered: undefined };

/** A name that is safe as a file name on every system. */
export const fileBase = (name: string) => name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Bounce';

/** The longest side of the cover kept inside a file: enough for a player's artwork without weighing on a small file. */
const COVER_SIDE = 1000;

/**
 * What a song's files say about themselves: its name, the artist, the producer, and everyone credited
 * with their share, so the credit goes wherever the file does.
 */
export function songTags(project: Project, profile: Profile, on = new Date()): Tags {
  const credits = creditsOf(project);
  const artist = artistOf(project, profile);
  const total = credits.reduce((n, c) => n + c.share, 0);
  return {
    title: project.name,
    artist: artist === 'You' ? undefined : artist,
    producer: profile.producer.trim() || credits.find((c) => c.role === 'Producer')?.name.trim() || undefined,
    writer: credits.filter((c) => c.role === 'Writer').map((c) => c.name.trim()).join(', ') || undefined,
    // The shares are only said when they have been filled in.
    comment: credits.length ? `Credits: ${credits.map((c) => `${c.name.trim()} (${c.role}${total ? `, ${c.share}%` : ''})`).join('; ')}` : undefined,
    year: on.getFullYear(),
  };
}

/** Renders everything the Export screen has ticked, in the format picked there. */
export async function exportFiles(project: Project, onStage?: (stage: string) => void): Promise<OutFile[]> {
  const choice = project.exporting;
  const target = LOUDNESS[choice.loudness];
  const bits = choice.format === 'wav16' ? 16 : 24;
  const base = fileBase(project.name);
  const take = activeTake(project);
  // A long song is about 90 MB a copy, so an export makes room first and then works on one file
  // at a time. Other mixes are let go of; the one that plays on the Export screen is the song
  // itself at the chosen loudness, so that one stays and is not rendered twice.
  keepOnlyMix(project, { targetLufs: target });
  const tags = songTags(project, getLibrary().profile);
  // Only the small format has a place for the cover.
  const picture = choice.format === 'm4a' ? await coverFor(project, COVER_SIDE) : null;
  if (picture) tags.cover = { data: new Uint8Array(await picture.arrayBuffer()), type: picture.type === 'image/png' ? 'image/png' : 'image/jpeg' };
  const make = async (suffix: string, include: 'mix' | 'instrumental' | 'vocals', stage: string): Promise<OutFile> => {
    onStage?.(stage);
    // Stems for mixing stay at their own level; everything else goes to the chosen loudness.
    // The extras are rendered for this file alone and not kept, so each is freed before the next.
    const mix = await getMix(project, { include, targetLufs: include === 'vocals' ? undefined : target }, undefined, { keep: include === 'mix' });
    // Each finished file is handed to the browser as a Blob straight away, which takes it out of the page's own memory.
    const named = { ...tags, title: `${project.name}${suffix}` };
    if (choice.format === 'm4a') {
      onStage?.(`${stage}: making it small`);
      return { name: `${base}${suffix}.m4a`, data: new Blob([await encodeM4a(mix.channels, mix.sampleRate, undefined, named)], { type: 'audio/mp4' }), type: 'audio/mp4' };
    }
    return { name: `${base}${suffix}.wav`, data: new Blob([encodeWav(mix.channels, mix.sampleRate, bits, named)], { type: 'audio/wav' }), type: 'audio/wav' };
  };
  const song = take ? await make('', 'mix', 'Rendering the song') : null;
  // The processed vocal and beat that renders share are each as long as the song too. The vocals
  // are the last file to need the processed vocal and the instrumental the last to need the beat,
  // so they are made in that order and each stage is let go of after its last use. The files
  // still come out song first, then instrumental, then vocals.
  const vocals = take && choice.vocals ? await make(' (vocals)', 'vocals', 'Rendering the vocals') : null;
  dropStages(['vocal']);
  const instrumental = !take || choice.instrumental ? await make(take ? ' (instrumental)' : '', 'instrumental', 'Rendering the instrumental') : null;
  dropStages();
  const out = [song, instrumental, vocals].filter((file): file is OutFile => !!file);
  // The credits are in the files themselves. The sheet to sign is only sent when it is asked for.
  const sheet = choice.sheet ? splitSheet(project) : null;
  if (sheet) out.push({ name: `${base} split sheet.txt`, data: new TextEncoder().encode(sheet).buffer as ArrayBuffer, type: 'text/plain' });
  return out;
}

/** The people credited on a song with a name filled in. */
export const creditsOf = (project: Pick<Project, 'credits'>) => (project.credits ?? []).filter((c) => c.name.trim());

/** A plain split sheet to send with the song: who did what, and each person's share. Null when nobody is credited. */
export function splitSheet(project: Pick<Project, 'name' | 'credits'>, on = new Date()): string | null {
  const credits = creditsOf(project);
  if (credits.length === 0) return null;
  const total = credits.reduce((n, c) => n + c.share, 0);
  const wide = Math.max(...credits.map((c) => c.name.trim().length), 4);
  return [
    `SPLIT SHEET`,
    `Song: ${project.name}`,
    `Date: ${on.toISOString().slice(0, 10)}`,
    ``,
    `${'Name'.padEnd(wide)}  ${'Role'.padEnd(9)}  Share`,
    ...credits.map((c) => `${c.name.trim().padEnd(wide)}  ${c.role.padEnd(9)}  ${c.share}%`),
    ``,
    `Total: ${total}%${total === 100 ? '' : '  (does not add up to 100%)'}`,
    ``,
    `Each person named above agrees to the share shown against their name.`,
    ...credits.map((c) => `\n${c.name.trim()}: ______________________   Date: __________`),
    ``,
  ].join('\n');
}
