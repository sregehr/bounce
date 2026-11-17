import { encodeM4a } from '@/dsp/aac';
import { encodeWav } from '@/dsp/wav';

import type { OutFile } from './files';
import type { ExportChoice, Project } from './model';
import { activeTake } from './store';
import { getMix } from './studio';

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
  const out: OutFile[] = [];
  const add = async (suffix: string, include: 'mix' | 'instrumental' | 'vocals', stage: string) => {
    onStage?.(stage);
    // Stems for mixing stay at their own level; everything else goes to the chosen loudness.
    const mix = await getMix(project, { include, targetLufs: include === 'vocals' ? undefined : target });
    if (choice.format === 'm4a') {
      onStage?.(`${stage}: making it small`);
      out.push({ name: `${base}${suffix}.m4a`, data: await encodeM4a(mix.channels, mix.sampleRate), type: 'audio/mp4' });
    } else out.push({ name: `${base}${suffix}.wav`, data: encodeWav(mix.channels, mix.sampleRate, bits), type: 'audio/wav' });
  };
  if (take) await add('', 'mix', 'Rendering the song');
  if (!take || choice.instrumental) await add(take ? ' (instrumental)' : '', 'instrumental', 'Rendering the instrumental');
  if (take && choice.vocals) await add(' (vocals)', 'vocals', 'Rendering the vocals');
  return out;
}
