// The hand-editable processing chains, shown on the song page.
import { useRef, useState, type ReactNode } from 'react';
import { Platform, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { Project } from '@/data/model';
import { artistById } from '@/data/artists';
import { activeTake, patchProject, saveArtist, setArtistSound, setSettings, useLibrary } from '@/data/store';
import type { useSong } from '@/data/song';
import { biquad, responseDb } from '@/dsp/core';
import { BEAT_STYLES, DEFAULT_ROOM_CUT, LEVEL_REST, MASTER_STYLES, VOCAL_STYLES, styleReverb, summarise, type Band, type Chain, type MasterSettings, type Polish, type Send } from '@/dsp/presets';
import { Btn, Chip, Chips, Disclosure, Eyebrow, Muted, NavLink, Option, Segmented, SliderRow, Txt, s } from './kit';
import { actionDir, stepFrequency, stepValue } from './spoken';
import { C, db } from './theme';
import { useWide } from './wide';

type Tab = 'Vocal' | 'Beat' | 'Master';
type Section = 'space' | 'eq' | 'comp' | 'deess' | 'lim' | '';
const KEY = { Vocal: 'vocal', Beat: 'beat', Master: 'master' } as const;
// The tab and section last open, and the song and take they were open for: a new take opens on Vocal.
let left: { id: string; tab: Tab; open: Section } | null = null;

const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')} kHz` : `${Math.round(v)} Hz`);
// Frequency sliders move evenly by pitch: 20 Hz at one end, 20 kHz at the other.
const freqToPos = (f: number) => (100 * Math.log(f / 20)) / Math.log(1000);
const posToFreq = (p: number) => 20 * Math.pow(1000, p / 100);

const GAIN = 12;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
type Move = { freq: number; gain: number };
// The touch target around each point on the curve.
const HANDLE = 44;

/**
 * The combined curve of the four bands, drawn across 20 Hz to 20 kHz and ±12 dB. Each band has a
 * point on it: pressing one picks that band, dragging it moves the band's frequency (across) and gain (up and down).
 */
function Curve({ bands, selected, height = 92, onSelect, onMove, onDone }: { bands: Band[]; selected: number; height?: number; onSelect: (i: number) => void; onMove: (i: number, to: Move) => void; onDone: (i: number, to: Move) => void }) {
  const RATE = 48000, H = height;
  // Drawn at the width it is given, so a point sits exactly where the finger finds it.
  const [W, setW] = useState(342);
  const drag = useRef<{ i: number; x: number; y: number; pos: number; gain: number; to: Move | null } | null>(null);
  const filters = bands.map((b) => biquad(b.type, b.freq, RATE, b.q, b.gain));
  const span = H / 2 - 8;
  const y = (gain: number) => H / 2 - (clamp(gain, -GAIN, GAIN) / GAIN) * span;
  const total = (f: number) => filters.reduce((sum, c) => sum + responseDb(c, f, RATE), 0);
  let d = '';
  for (let i = 0; i <= 80; i++) {
    const f = posToFreq((i / 80) * 100);
    d += `${i ? 'L' : 'M'}${((i / 80) * W).toFixed(1)} ${y(total(f)).toFixed(1)}`;
  }
  const points = bands.map((b) => ({ x: (freqToPos(b.freq) / 100) * W, y: y(total(b.freq)) }));

  const move = (e: GestureResponderEvent) => {
    const g = drag.current;
    if (!g) return;
    const dx = e.nativeEvent.pageX - g.x, dy = e.nativeEvent.pageY - g.y;
    // A press that barely moves only picks the band.
    if (!g.to && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    // Moved from where the band was, not from the finger: the point shows the whole curve's height there, not this band's gain alone.
    const pos = clamp(g.pos + (dx / W) * 100, 0, 100);
    const gain = clamp(Math.round((g.gain - (dy / span) * GAIN) * 2) / 2, -GAIN, GAIN);
    g.to = { freq: Math.round(posToFreq(pos)), gain };
    onMove(g.i, g.to);
  };
  const end = () => {
    const g = drag.current;
    drag.current = null;
    if (g?.to) onDone(g.i, g.to);
  };
  // Without a finger on the point: VoiceOver's flick up and down changes the gain by half a dB,
  // and its actions move the frequency a third of an octave. A keyboard's arrows do the same.
  const nudge = (i: number, by: { gain?: 1 | -1; freq?: 1 | -1 }) => {
    const band = bands[i];
    onSelect(i);
    onDone(i, { freq: by.freq ? stepFrequency(band.freq, by.freq) : band.freq, gain: by.gain ? stepValue(band.gain, by.gain, 0.5, -GAIN, GAIN) : band.gain });
  };

  return (
    <View style={{ height: H }} onLayout={(e) => e.nativeEvent.layout.width > 0 && setW(e.nativeEvent.layout.width)}>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ backgroundColor: C.surface, borderRadius: 14 }}>
        <Path d={`M0 ${H / 2}h${W}`} stroke={C.dim} strokeWidth={1} />
        <Path d={`M0 ${H / 4}h${W}M0 ${(H * 3) / 4}h${W}`} stroke={C.line} strokeWidth={1} />
        <Path d={d} stroke={C.accent} strokeWidth={2.5} fill="none" />
        {points.map((p, i) => (i === selected ? <Circle key={i} cx={p.x} cy={p.y} r={7} fill={C.accent} stroke={C.text} strokeWidth={2} /> : <Circle key={i} cx={p.x} cy={p.y} r={6} fill={C.text} />))}
      </Svg>
      {/* A finger-sized target over each point, kept inside the curve's box so it never covers the controls around it. */}
      {points.map((p, i) => (
        <View
          key={i}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Curve point ${i + 1} of ${bands.length}`}
          accessibilityHint="Swipe up or down to change the gain. The actions move the frequency."
          accessibilityValue={{ text: `${hz(bands[i].freq)}, ${db(bands[i].gain, 1)}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'higher', label: 'Higher frequency' }, { name: 'lower', label: 'Lower frequency' }, { name: 'activate' }]}
          onAccessibilityAction={(e) => {
            const name = e.nativeEvent.actionName;
            const dir = actionDir(name);
            if (dir) nudge(i, { gain: dir });
            else if (name === 'higher' || name === 'lower') nudge(i, { freq: name === 'higher' ? 1 : -1 });
            else onSelect(i);
          }}
          {...((Platform.OS === 'web'
            ? {
                tabIndex: 0,
                'aria-valuetext': `${hz(bands[i].freq)}, ${db(bands[i].gain, 1)}`,
                onFocus: () => onSelect(i),
                onKeyDown: (e: { key: string; preventDefault: () => void }) => {
                  const move = ({ ArrowUp: { gain: 1 }, ArrowDown: { gain: -1 }, ArrowRight: { freq: 1 }, ArrowLeft: { freq: -1 } } as const)[e.key as 'ArrowUp'];
                  if (move) (e.preventDefault(), nudge(i, move));
                },
              }
            : {}) as object)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(e) => {
            drag.current = { i, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, pos: freqToPos(bands[i].freq), gain: bands[i].gain, to: null };
            onSelect(i);
          }}
          onResponderMove={move}
          onResponderRelease={end}
          onResponderTerminate={end}
          style={[
            { position: 'absolute', width: HANDLE, height: HANDLE, left: clamp(p.x - HANDLE / 2, 0, Math.max(0, W - HANDLE)), top: clamp(p.y - HANDLE / 2, 0, Math.max(0, H - HANDLE)), zIndex: i === selected ? 1 : 0 },
            Platform.OS === 'web' && ({ cursor: 'grab', userSelect: 'none', touchAction: 'none' } as object),
          ]}
        />
      ))}
    </View>
  );
}

/** One section of the chain as a card, for the wide layout where they are all open at once. */
function Panel({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16 }}>
      <View style={[s.row, s.between, { paddingBottom: 4 }]}>
        <Txt size={15} w="semi">
          {title}
        </Txt>
        <Txt size={12} color={C.muted} numberOfLines={2} right style={{ flex: 1 }}>
          {summary}
        </Txt>
      </View>
      {children}
    </View>
  );
}

/**
 * The processing chains behind a mix, editable by hand: EQ, compressor, de-esser and limiter
 * for the vocal, the beat and the master. Each starts from what the automatic polish chose.
 * Each tab opens on its broad strokes: the sound it starts from and, for the vocal and the beat, its level.
 */
export function ChainEditor({ project, song }: { project: Project; song: Pick<ReturnType<typeof useSong>, 'mix' | 'error'> }) {
  const preset = useLibrary((l) => l.settings.vocalPreset);
  // The artist on this song, when they have a profile: their vocal sound is kept there, the way "my preset" is kept in Settings.
  const artist = useLibrary((l) => artistById(l, project.artistId));
  const named = project.artist?.trim() ?? '';
  const wide = useWide();
  const take = activeTake(project);
  // With no vocal on it the beat is the whole track, so the master is the one place it is shaped: a Beat tab beside it would be the same audio twice.
  const tabs: Tab[] = take ? ['Vocal', 'Beat', 'Master'] : ['Master'];
  // Which tab and section were open is kept past leaving the page, so Mix comes back as it was left.
  const leftFor = `${project.id}:${take?.id ?? ''}`;
  const kept = left?.id === leftFor ? left : null;
  const [tab, setTab] = useState<Tab>(kept && tabs.includes(kept.tab) ? kept.tab : tabs[0]);
  // Every section starts closed on a phone, so a tab opens on its sound and level.
  const [open, setOpen] = useState<Section>(kept?.open ?? '');
  // Kept when it is changed, not on every draw: a Mix page still alive underneath must not write its own over it.
  const keep = (next: { tab?: Tab; open?: Section }) => void (left = { id: leftFor, tab, open, ...next });
  const [band, setBand] = useState(1);
  // Values being dragged: applied to the sound when the slider is let go.
  const [draft, setDraft] = useState<Chain | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [spaceDraft, setSpaceDraft] = useState<{ send: Send; roomCut: number } | null>(null);

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
  // Reverb and echo for this part of the mix. The vocal's reverb follows its style until it is set here.
  const space = spaceDraft ?? {
    send: { reverb: project.space?.[key]?.reverb ?? (tab === 'Vocal' ? styleReverb(project.polish.style) : 0), echo: project.space?.[key]?.echo ?? 0 },
    roomCut: project.space?.roomCut ?? DEFAULT_ROOM_CUT,
  };
  const commitSpace = (next: typeof space) => {
    setSpaceDraft(null);
    patchProject(project.id, (p) => ({ space: { ...p.space, [key]: next.send, ...(tab === 'Vocal' ? { roomCut: next.roomCut } : null) } }));
  };
  const pct = (v: number) => (v > 0 ? `${Math.round(v)}%` : 'Off');
  const spaceRow = (label: string, value: number, display: string, apply: (v: number) => typeof space) => (
    <SliderRow key={`${tab}-space-${label}`} label={label} value={value} min={0} max={100} step={1} display={display} onChange={(v) => setSpaceDraft(apply(v))} onCommit={(v) => commitSpace(apply(v))} />
  );
  const toggle = (sec: Section) => () => (keep({ open: open === sec ? '' : sec }), setOpen(open === sec ? '' : sec));

  /** A slider bound to one value in the chain. */
  const row = (label: string, value: number, min: number, max: number, step: number, display: string, apply: (c: Chain, v: number) => Chain) =>
    chain && <SliderRow key={`${tab}-${label}`} label={label} value={value} min={min} max={max} step={step} reset={min < 0 && max > 0 ? 0 : undefined} display={display} onChange={(v) => setDraft(apply(chain, v))} onCommit={(v) => commit(apply(chain, v))} />;
  const setBandAt = (c: Chain, i: number, patch: Partial<Band>): Chain => ({ ...c, eq: c.eq.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setBandValue = (c: Chain, patch: Partial<Band>): Chain => setBandAt(c, band, patch);
  const sums = chain ? summarise(chain) : null;
  const b = chain?.eq[Math.min(band, (chain?.eq.length ?? 1) - 1)];
  const ready = chain && sums && b ? { chain, sums, b } : null;

  // Each piece is built once and laid out twice: one at a time on the phone, all open as cards when wide.
  const tabBar = tabs.length > 1 && <Segmented options={tabs} value={tab} onChange={(v) => (setDraft(null), setSpaceDraft(null), setLevel(null), keep({ tab: v }), setTab(v))} />;

  const polish = project.polish;
  const setPolish = (patch: Partial<Polish>) => (setLevel(null), patchProject(project.id, (p) => ({ polish: { ...p.polish, ...patch } })));
  const levelRow = (label: string, value: number, apply: (v: number) => Partial<Polish>) => (
    <SliderRow key={label} label={label} value={level ?? value} reset={LEVEL_REST} onChange={setLevel} onCommit={(v) => setPolish(apply(v))} labelWidth={92} minHeight={44} fontSize={15} display={`${level ?? value}`} valueWidth={30} />
  );
  // The vocal's broad strokes. Choosing a sound replaces a vocal chain set by hand below, and puts the reverb back where that sound has it.
  const vocalSound = tab === 'Vocal' && (
    <View style={{ gap: 6 }}>
      <Eyebrow>Vocal sound</Eyebrow>
      <Chips wrap options={VOCAL_STYLES} value={polish.style} onChange={(style) => (setDraft(null), patchProject(project.id, (p) => ({ polish: { ...p.polish, style }, overrides: { ...p.overrides, vocal: undefined }, space: p.space && { ...p.space, vocal: { ...p.space.vocal, reverb: undefined } } })))} />
      <View>
        {levelRow('Vocal level', polish.vocalLevel, (vocalLevel) => ({ vocalLevel }))}
        <Option label="Double the vocal" sub="A second copy of your voice, nudged and panned" w="regular" checked={polish.double} onChange={(double) => setPolish({ double })} minHeight={46} />
      </View>
    </View>
  );
  // The beat's. Under a vocal it has a level of its own; alone, the master sets how loud it is.
  const beatStyle = polish.beatStyle ?? 'Auto';
  const beatSound = tab === 'Beat' && (
    <View style={{ gap: 6 }}>
      <Eyebrow>Beat sound</Eyebrow>
      <Chips wrap options={BEAT_STYLES} value={beatStyle} onChange={(next) => (setDraft(null), patchProject(project.id, (p) => ({ polish: { ...p.polish, beatStyle: next }, overrides: { ...p.overrides, beat: undefined } })))} />
      {take && levelRow('Beat level', polish.beatLevel ?? LEVEL_REST, (beatLevel) => ({ beatLevel }))}
    </View>
  );

  const master = tab === 'Master' && (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {MASTER_STYLES.map((style) => (
          <Chip key={style} label={style} on={style === project.master.style && !edited} onPress={() => setMaster({ style })} />
        ))}
      </View>
      <SliderRow label="Intensity" value={amount ?? project.master.amount} min={0} max={100} step={1} display={`${amount ?? project.master.amount}%`} onChange={setAmount} onCommit={(v) => setMaster({ amount: v })} />
      {!edited && song.mix?.note ? <Muted size={13}>{song.mix.note}</Muted> : null}
    </View>
  );

  const from = (
    <View style={[s.row, s.between, { minHeight: 28 }, wide && { flex: 1 }]}>
      <Muted size={13} style={{ flex: 1 }}>
        {song.error ?? (edited ? 'Set by hand. Reset goes back to what Auto chose.' : tab === 'Vocal' ? 'Starting from what Auto chose for this take' : tab === 'Beat' ? (beatStyle === 'Auto' ? 'Starting from what Auto chose for this beat' : `Starting from the ${beatStyle} beat sound`) : `Starting from the ${project.master.style} master`)}
      </Muted>
      {edited && (
        <NavLink size={13} w="semi" style={{ minHeight: wide ? 44 : 28 }} onPress={reset}>
          Reset
        </NavLink>
      )}
    </View>
  );

  const spaceSummary = `Reverb ${pct(space.send.reverb ?? 0).toLowerCase()} · Echo ${pct(space.send.echo ?? 0).toLowerCase()}`;
  const spaceBody = (
    <View style={{ paddingBottom: wide ? 0 : 8 }}>
      {spaceRow('Reverb', space.send.reverb ?? 0, pct(space.send.reverb ?? 0), (v) => ({ ...space, send: { ...space.send, reverb: v } }))}
      {spaceRow('Echo', space.send.echo ?? 0, pct(space.send.echo ?? 0), (v) => ({ ...space, send: { ...space.send, echo: v } }))}
      {tab === 'Vocal' && spaceRow('Room cut', space.roomCut, space.roomCut > 0 ? db((-24 * space.roomCut) / 100) : 'Off', (v) => ({ ...space, roomCut: v }))}
      <Muted size={13}>
        {tab === 'Vocal'
          ? 'Reverb starts where the vocal style puts it; zero is fully dry. Room cut turns down the room and the beat bleed between phrases.'
          : tab === 'Beat'
            ? 'Added to the beat only. The bass is kept out of it, so the low end stays tight.'
            : 'Added to the vocal and beat together, on top of what each has. The bass is kept out of it.'}
      </Muted>
    </View>
  );

  const waiting = <Muted>{song.error ? 'The chain could not be worked out.' : 'Listening to the track to work out a starting point…'}</Muted>;

  const eqBody = ready && (
    <View style={{ gap: 8, paddingBottom: wide ? 0 : 8 }}>
      {/* Dragging a point works like dragging a slider: heard when it is let go. */}
      <Curve
        bands={ready.chain.eq}
        selected={Math.min(band, ready.chain.eq.length - 1)}
        height={wide ? 96 : 92}
        onSelect={setBand}
        onMove={(i, to) => setDraft(setBandAt(ready.chain, i, to))}
        onDone={(i, to) => commit(setBandAt(ready.chain, i, to))}
      />
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {ready.chain.eq.map((x, i) => (
          <Chip key={i} square label={hz(x.freq)} on={i === band} onPress={() => setBand(i)} />
        ))}
      </View>
      <View>
        {row('Frequency', freqToPos(ready.b.freq), 0, 100, 0.5, hz(ready.b.freq), (c, v) => setBandValue(c, { freq: Math.round(posToFreq(v)) }))}
        {row('Gain', ready.b.gain, -12, 12, 0.5, db(ready.b.gain, 1), (c, v) => setBandValue(c, { gain: v }))}
        {ready.b.type === 'peaking' ? row('Width', ready.b.q, 0.3, 2.8, 0.1, `Q ${ready.b.q.toFixed(1)}`, (c, v) => setBandValue(c, { q: v })) : <Muted size={13}>{ready.b.type === 'lowshelf' ? 'Low shelf: everything below moves together.' : 'High shelf: everything above moves together.'}</Muted>}
      </View>
    </View>
  );

  const compBody = ready && (
    <View style={{ paddingBottom: wide ? 0 : 8 }}>
      {row('Threshold', ready.chain.comp.threshold, -40, 0, 1, db(ready.chain.comp.threshold), (c, v) => ({ ...c, comp: { ...c.comp, threshold: v } }))}
      {row('Ratio', ready.chain.comp.ratio, 1, 8, 0.5, `${ready.chain.comp.ratio.toFixed(1).replace(/\.0$/, '')} : 1`, (c, v) => ({ ...c, comp: { ...c.comp, ratio: v } }))}
      {row('Attack', ready.chain.comp.attack, 1, 42, 1, `${Math.round(ready.chain.comp.attack)} ms`, (c, v) => ({ ...c, comp: { ...c.comp, attack: v } }))}
      {row('Release', ready.chain.comp.release, 20, 270, 10, `${Math.round(ready.chain.comp.release)} ms`, (c, v) => ({ ...c, comp: { ...c.comp, release: v } }))}
      {row('Make-up', ready.chain.comp.makeup, -5, 15, 0.5, db(ready.chain.comp.makeup, 1), (c, v) => ({ ...c, comp: { ...c.comp, makeup: v } }))}
    </View>
  );

  const deessBody = ready && (
    <View style={{ paddingBottom: wide ? 0 : 8 }}>
      {row('Frequency', ready.chain.deess.freq, 2000, 9500, 100, hz(ready.chain.deess.freq), (c, v) => ({ ...c, deess: { ...c.deess, freq: v } }))}
      {row('Amount', ready.chain.deess.amount, 0, 12, 0.5, ready.chain.deess.amount > 0 ? db(-ready.chain.deess.amount, 1) : 'Off', (c, v) => ({ ...c, deess: { ...c.deess, amount: v } }))}
    </View>
  );

  const limBody = ready && (
    <View style={{ paddingBottom: wide ? 0 : 8 }}>
      {row('Ceiling', ready.chain.limiter.ceiling, -10, 0, 0.1, db(ready.chain.limiter.ceiling, 1), (c, v) => ({ ...c, limiter: { ...c.limiter, ceiling: v } }))}
      {row('Release', ready.chain.limiter.release, 10, 210, 10, `${Math.round(ready.chain.limiter.release)} ms`, (c, v) => ({ ...c, limiter: { ...c.limiter, release: v } }))}
      {tab === 'Master' && song.mix && <Muted size={13}>The limiter is holding back up to {db(song.mix.did.limiterDb, 1)} on the loudest peaks.</Muted>}
    </View>
  );

  const presets = tab === 'Vocal' && chain && (
    <View style={{ gap: 10 }}>
      <View style={[s.row, { gap: 10 }]}>
        <Btn kind="outline" label={preset && JSON.stringify(preset) === JSON.stringify(chain) ? 'Saved as my preset' : 'Save as my preset'} style={{ flex: 1 }} onPress={() => setSettings({ vocalPreset: chain })} />
        {preset && <Btn kind="outline" label="Use my preset" style={{ flex: 1 }} onPress={() => commit(preset)} />}
      </View>
      {/* A name that has only been typed gets its sound kept the first time it is saved. */}
      {!artist && named && <Btn kind="outline" label={`Save for ${named}`} style={{ flex: 0 }} onPress={() => void ((kept) => kept && setArtistSound(kept.id, chain, project.polish.style))(saveArtist(named))} />}
      {artist && (
        <View style={[s.row, { gap: 10 }]}>
          <Btn kind="outline" label={artist.chain && JSON.stringify(artist.chain) === JSON.stringify(chain) ? `Saved for ${artist.name}` : `Save for ${artist.name}`} style={{ flex: 1 }} onPress={() => setArtistSound(artist.id, chain, project.polish.style)} />
          {artist.chain && <Btn kind="outline" label={`Use ${artist.name}'s sound`} style={{ flex: 1 }} onPress={() => (setDraft(null), patchProject(project.id, (p) => ({ overrides: { ...p.overrides, vocal: artist.chain }, polish: artist.style ? { ...p.polish, style: artist.style } : p.polish })))} />}
        </View>
      )}
    </View>
  );

  // Wide: every section open at once, as cards in two columns under the tabs.
  if (wide)
    return (
      <View style={{ gap: 12 }}>
        <View style={[s.row, { gap: 16 }]}>
          {tabBar && <View style={{ width: 300 }}>{tabBar}</View>}
          {from}
        </View>
        {vocalSound && <View style={{ maxWidth: 460 }}>{vocalSound}</View>}
        {beatSound && <View style={{ maxWidth: 460 }}>{beatSound}</View>}
        {master}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
            {ready ? (
              <Panel title="EQ" summary={ready.sums.eq}>
                {eqBody}
              </Panel>
            ) : (
              waiting
            )}
            <Panel title="Reverb and echo" summary={spaceSummary}>
              {spaceBody}
            </Panel>
          </View>
          {ready && (
            <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
              <Panel title="Compressor" summary={ready.sums.comp}>
                {compBody}
              </Panel>
              <Panel title="De-esser" summary={ready.sums.deess}>
                {deessBody}
              </Panel>
              <Panel title="Limiter" summary={ready.sums.limiter}>
                {limBody}
              </Panel>
            </View>
          )}
        </View>
        {presets}
      </View>
    );

  return (
    <View style={{ gap: 10 }}>
      {tabBar}

      {vocalSound}
      {beatSound}
      {master}

      {from}

      <Disclosure title="Reverb and echo" summary={spaceSummary} open={open === 'space'} onToggle={toggle('space')}>
        {spaceBody}
      </Disclosure>

      {!ready ? (
        waiting
      ) : (
        <View>
          <Disclosure title="EQ" summary={ready.sums.eq} open={open === 'eq'} onToggle={toggle('eq')}>
            {eqBody}
          </Disclosure>

          <Disclosure title="Compressor" summary={ready.sums.comp} open={open === 'comp'} onToggle={toggle('comp')}>
            {compBody}
          </Disclosure>

          <Disclosure title="De-esser" summary={ready.sums.deess} open={open === 'deess'} onToggle={toggle('deess')}>
            {deessBody}
          </Disclosure>

          <Disclosure title="Limiter" summary={ready.sums.limiter} open={open === 'lim'} onToggle={toggle('lim')} last>
            {limBody}
          </Disclosure>
        </View>
      )}

      {presets}
    </View>
  );
}
