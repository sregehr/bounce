import { encodeM4a } from '@/dsp/aac';
import { encodeWav } from '@/dsp/wav';

import type { OutFile } from './files';
import type { ExportChoice, Project } from './model';
import { activeTake } from './store';
import { dropStages, getMix, keepOnlyMix } from './studio';

export const LOUDNESS: Record<ExportChoice['loudness'], number | undefined> = { streaming: -14, loud: -9, mastered: undefined };

/** A name that is safe as a file name on every system. */
export const fileBase = (name: string) => name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Bounce';

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
  const make = async (suffix: string, include: 'mix' | 'instrumental' | 'vocals', stage: string): Promise<OutFile> => {
    onStage?.(stage);
    // Stems for mixing stay at their own level; everything else goes to the chosen loudness.
    // The extras are rendered for this file alone and not kept, so each is freed before the next.
    const mix = await getMix(project, { include, targetLufs: include === 'vocals' ? undefined : target }, undefined, { keep: include === 'mix' });
    // Each finished file is handed to the browser as a Blob straight away, which takes it out of the page's own memory.
    if (choice.format === 'm4a') {
      onStage?.(`${stage}: making it small`);
      return { name: `${base}${suffix}.m4a`, data: new Blob([await encodeM4a(mix.channels, mix.sampleRate)], { type: 'audio/mp4' }), type: 'audio/mp4' };
    }
    return { name: `${base}${suffix}.wav`, data: new Blob([encodeWav(mix.channels, mix.sampleRate, bits)], { type: 'audio/wav' }), type: 'audio/wav' };
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
  const sheet = splitSheet(project);
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
