// The hand-editable processing chains, shown on the song page.
import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { Project } from '@/data/model';
import { activeTake, patchProject, setSettings, useLibrary } from '@/data/store';
import type { useSong } from '@/data/song';
import { biquad, responseDb } from '@/dsp/core';
import { MASTER_STYLES, summarise, type Band, type Chain, type MasterSettings } from '@/dsp/presets';
import { Btn, Chip, Disclosure, Muted, NavLink, Segmented, SliderRow, s } from './kit';
import { C, db } from './theme';

type Tab = 'Vocal' | 'Beat' | 'Master';
type Section = 'eq' | 'comp' | 'deess' | 'lim' | '';
const KEY = { Vocal: 'vocal', Beat: 'beat', Master: 'master' } as const;

const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')} kHz` : `${Math.round(v)} Hz`);
// Frequency sliders move evenly by pitch: 20 Hz at one end, 20 kHz at the other.
const freqToPos = (f: number) => (100 * Math.log(f / 20)) / Math.log(1000);
const posToFreq = (p: number) => 20 * Math.pow(1000, p / 100);

/** The combined curve of the four bands, drawn across 20 Hz to 20 kHz and ±12 dB. */
function Curve({ bands }: { bands: Band[] }) {
  const W = 342, H = 92, RATE = 48000;
  const filters = bands.map((b) => biquad(b.type, b.freq, RATE, b.q, b.gain));
  const y = (gain: number) => H / 2 - (Math.max(-12, Math.min(12, gain)) / 12) * (H / 2 - 8);
  const total = (f: number) => filters.reduce((sum, c) => sum + responseDb(c, f, RATE), 0);
  let d = '';
  for (let i = 0; i <= 80; i++) {
    const f = posToFreq((i / 80) * 100);
    d += `${i ? 'L' : 'M'}${((i / 80) * W).toFixed(1)} ${y(total(f)).toFixed(1)}`;
  }
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ backgroundColor: C.surface, borderRadius: 14 }}>
      <Path d={`M0 ${H / 2}h${W}`} stroke={C.dim} strokeWidth={1} />
      <Path d={`M0 ${H / 4}h${W}M0 ${(H * 3) / 4}h${W}`} stroke={C.line} strokeWidth={1} />
      <Path d={d} stroke={C.accent} strokeWidth={2.5} fill="none" />
      {bands.map((b, i) => (
        <Circle key={i} cx={(freqToPos(b.freq) / 100) * W} cy={y(total(b.freq))} r={6} fill={C.text} />
      ))}
    </Svg>
  );
}

/**
 * The processing chains behind a mix, editable by hand: EQ, compressor, de-esser and limiter
 * for the vocal, the beat and the master. Each starts from what the automatic polish chose.
 */
export function ChainEditor({ project, song }: { project: Project; song: Pick<ReturnType<typeof useSong>, 'mix' | 'error'> }) {
  const preset = useLibrary((l) => l.settings.vocalPreset);
  const take = activeTake(project);
  const tabs: Tab[] = take ? ['Vocal', 'Beat', 'Master'] : ['Beat', 'Master'];
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const [open, setOpen] = useState<Section>('eq');
  const [band, setBand] = useState(1);
  // Values being dragged: applied to the sound when the slider is let go.
  const [draft, setDraft] = useState<Chain | null>(null);
  const [amount, setAmount] = useState<number | null>(null);

  const key = KEY[tab];
  const resolved = project.overrides[key] ?? song.mix?.chains[key] ?? null;
  const chain = draft ?? resolved;
  const edited = !!project.overrides[key];
  const commit = (next: Chain) => {
    setDraft(null);
    patchProject(project.id, (p) => ({ overrides: { ...p.overrides, [key]: next } }));
  };
  const reset = () => {
    setDraft(null);
    patchProject(project.id, (p) => ({ overrides: { ...p.overrides, [key]: undefined } }));
  };
  // Choosing a master style or its intensity replaces any master chain set by hand below.
  const setMaster = (patch: Partial<MasterSettings>) => {
    setDraft(null);
    setAmount(null);
    patchProject(project.id, (p) => ({ master: { ...p.master, ...patch }, overrides: { ...p.overrides, master: undefined } }));
  };
  const toggle = (sec: Section) => () => setOpen(open === sec ? '' : sec);

  /** A slider bound to one value in the chain. */
  const row = (label: string, value: number, min: number, max: number, step: number, display: string, apply: (c: Chain, v: number) => Chain) =>
    chain && <SliderRow key={`${tab}-${label}`} label={label} value={value} min={min} max={max} step={step} display={display} onChange={(v) => setDraft(apply(chain, v))} onCommit={(v) => commit(apply(chain, v))} />;
  const setBandValue = (c: Chain, patch: Partial<Band>): Chain => ({ ...c, eq: c.eq.map((b, i) => (i === band ? { ...b, ...patch } : b)) });
  const sums = chain ? summarise(chain) : null;
  const b = chain?.eq[Math.min(band, (chain?.eq.length ?? 1) - 1)];

  return (
    <View style={{ gap: 10 }}>
      <Segmented options={tabs} value={tab} onChange={(v) => (setDraft(null), setTab(v))} />

      {tab === 'Master' && (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {MASTER_STYLES.map((style) => (
              <Chip key={style} label={style} on={style === project.master.style && !edited} onPress={() => setMaster({ style })} />
            ))}
          </View>
          <SliderRow label="Intensity" value={amount ?? project.master.amount} min={0} max={100} step={1} display={`${amount ?? project.master.amount}%`} onChange={setAmount} onCommit={(v) => setMaster({ amount: v })} />
          {!edited && song.mix?.note ? <Muted size={13}>{song.mix.note}</Muted> : null}
        </View>
      )}

      <View style={[s.row, s.between, { minHeight: 28 }]}>
        <Muted size={13} style={{ flex: 1 }}>
          {song.error ?? (edited ? 'Set by hand. Reset goes back to what Auto chose.' : tab === 'Vocal' ? 'Starting from what Auto chose for this take' : tab === 'Beat' ? 'Starting from what Auto chose for this beat' : `Starting from the ${project.master.style} master`)}
        </Muted>
        {edited && (
          <NavLink size={13} w="semi" style={{ minHeight: 28 }} onPress={reset}>
            Reset
          </NavLink>
        )}
      </View>

      {!chain || !sums || !b ? (
        <Muted>{song.error ? 'The chain could not be worked out.' : 'Listening to the track to work out a starting point…'}</Muted>
      ) : (
        <View>
          <Disclosure title="EQ" summary={sums.eq} open={open === 'eq'} onToggle={toggle('eq')}>
            <View style={{ gap: 8, paddingBottom: 8 }}>
              <Curve bands={chain.eq} />
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {chain.eq.map((x, i) => (
                  <Chip key={i} square label={hz(x.freq)} on={i === band} onPress={() => setBand(i)} />
                ))}
              </View>
              <View>
                {row('Frequency', freqToPos(b.freq), 0, 100, 0.5, hz(b.freq), (c, v) => setBandValue(c, { freq: Math.round(posToFreq(v)) }))}
                {row('Gain', b.gain, -12, 12, 0.5, db(b.gain, 1), (c, v) => setBandValue(c, { gain: v }))}
                {b.type === 'peaking' ? row('Width', b.q, 0.3, 2.8, 0.1, `Q ${b.q.toFixed(1)}`, (c, v) => setBandValue(c, { q: v })) : <Muted size={13}>{b.type === 'lowshelf' ? 'Low shelf: everything below moves together.' : 'High shelf: everything above moves together.'}</Muted>}
              </View>
            </View>
          </Disclosure>

          <Disclosure title="Compressor" summary={sums.comp} open={open === 'comp'} onToggle={toggle('comp')}>
            <View style={{ paddingBottom: 8 }}>
              {row('Threshold', chain.comp.threshold, -40, 0, 1, db(chain.comp.threshold), (c, v) => ({ ...c, comp: { ...c.comp, threshold: v } }))}
              {row('Ratio', chain.comp.ratio, 1, 8, 0.5, `${chain.comp.ratio.toFixed(1).replace(/\.0$/, '')} : 1`, (c, v) => ({ ...c, comp: { ...c.comp, ratio: v } }))}
              {row('Attack', chain.comp.attack, 1, 42, 1, `${Math.round(chain.comp.attack)} ms`, (c, v) => ({ ...c, comp: { ...c.comp, attack: v } }))}
              {row('Release', chain.comp.release, 20, 270, 10, `${Math.round(chain.comp.release)} ms`, (c, v) => ({ ...c, comp: { ...c.comp, release: v } }))}
              {row('Make-up', chain.comp.makeup, -5, 15, 0.5, db(chain.comp.makeup, 1), (c, v) => ({ ...c, comp: { ...c.comp, makeup: v } }))}
            </View>
          </Disclosure>

          <Disclosure title="De-esser" summary={sums.deess} open={open === 'deess'} onToggle={toggle('deess')}>
            <View style={{ paddingBottom: 8 }}>
              {row('Frequency', chain.deess.freq, 2000, 9500, 100, hz(chain.deess.freq), (c, v) => ({ ...c, deess: { ...c.deess, freq: v } }))}
              {row('Amount', chain.deess.amount, 0, 12, 0.5, chain.deess.amount > 0 ? db(-chain.deess.amount, 1) : 'Off', (c, v) => ({ ...c, deess: { ...c.deess, amount: v } }))}
            </View>
          </Disclosure>

          <Disclosure title="Limiter" summary={sums.limiter} open={open === 'lim'} onToggle={toggle('lim')} last>
            <View style={{ paddingBottom: 8 }}>
              {row('Ceiling', chain.limiter.ceiling, -10, 0, 0.1, db(chain.limiter.ceiling, 1), (c, v) => ({ ...c, limiter: { ...c.limiter, ceiling: v } }))}
              {row('Release', chain.limiter.release, 10, 210, 10, `${Math.round(chain.limiter.release)} ms`, (c, v) => ({ ...c, limiter: { ...c.limiter, release: v } }))}
              {tab === 'Master' && song.mix && <Muted size={13}>The limiter is holding back up to {db(song.mix.did.limiterDb, 1)} on the loudest peaks.</Muted>}
            </View>
          </Disclosure>
        </View>
      )}

      {tab === 'Vocal' && chain && (
          <View style={[s.row, { gap: 10 }]}>
            <Btn kind="outline" label={preset && JSON.stringify(preset) === JSON.stringify(chain) ? 'Saved as my preset' : 'Save as my preset'} style={{ flex: 1 }} onPress={() => setSettings({ vocalPreset: chain })} />
            {preset && <Btn kind="outline" label="Use my preset" style={{ flex: 1 }} onPress={() => commit(preset)} />}
          </View>
      )}
    </View>
  );
}
