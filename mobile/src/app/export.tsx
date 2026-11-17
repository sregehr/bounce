import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';

import { creditsOf, exportFiles, LOUDNESS } from '@/data/exporting';
import { canShareFiles, saveFiles, shareFiles, type OutFile } from '@/data/files';
import type { Credit, ExportChoice } from '@/data/model';
import { activeTake, patchProject, useLibrary, useProject } from '@/data/store';
import { artistOf } from '@/data/songs';
import { linkNotes, linksAvailable, makeLink, removeLink, type Note } from '@/data/shares';
import { useSong } from '@/data/song';
import { aacSupported } from '@/dsp/aac';
import { Btn, Card, Chip, Eyebrow, Field, Foot, Muted, NavLink, Option, RoundPlay, Screen, TopBar, Txt, s } from '@/ui/kit';
import { useStopOnLeave, useTask } from '@/ui/hooks';
import { asSheet } from '@/ui/nav';
import { C, clock, lufs, plural } from '@/ui/theme';
import { Columns, useWide } from '@/ui/wide';

const ROLES = ['Writer', 'Producer', 'Performer'] as const;

function Export() {
  const project = useProject();
  const take = activeTake(project);
  const profile = useLibrary((l) => l.profile);
  const choice = project?.exporting;
  // What plays here is what will be exported, at the chosen loudness.
  const song = useSong(project, { autoplay: false, mix: choice ? { targetLufs: LOUDNESS[choice.loudness] } : undefined });
  const task = useTask();
  const [stage, setStage] = useState('');
  const [done, setDone] = useState<string | null>(null);
  // Files that are rendered and waiting for a tap: the share sheet only opens straight from one.
  const [ready, setReady] = useState<OutFile[] | null>(null);
  const wide = useWide();
  useStopOnLeave();
  // Whether this browser can make the small format, at this beat's sample rate.
  const [small, setSmall] = useState(false);
  const rate = project?.beat.sampleRate;
  useEffect(() => {
    let live = true;
    if (rate) void aacSupported(rate).then((ok) => live && setSmall(ok));
    return () => void (live = false);
  }, [rate]);

  if (!project || !choice) return <Redirect href="/" />;

  const set = (patch: Partial<ExportChoice>) => (setDone(null), setReady(null), patchProject(project.id, { exporting: { ...choice, ...patch } }, false));
  const credits = project.credits ?? [];
  const count = (take ? 1 : 0) + (!take || choice.instrumental ? 1 : 0) + (take && choice.vocals ? 1 : 0) + (creditsOf(project).length ? 1 : 0);
  const run = (how: 'share' | 'save') =>
    task.run(async () => {
      setDone(null);
      song.pause();
      const files = ready ?? (await exportFiles(project, setStage));
      setStage('');
      if (how === 'save') {
        const saved = await saveFiles(files, project.name);
        setDone(files.length === 1 ? `Saved ${saved} to your downloads.` : `${plural(files.length, 'file')} saved to your downloads as ${saved}.`);
      } else {
        const result = await shareFiles(files, project.name);
        // A long render outlasts the moment a browser allows a share after a tap. The files are kept, and the next tap sends them at once.
        setReady(result === 'blocked' || result === 'cancelled' ? files : null);
        if (result === 'blocked') return setDone(`${files.length === 1 ? 'Your file is' : 'Your files are'} ready. Tap Share now to send.`);
        setDone(result === 'shared' ? 'Shared.' : result === 'saved' ? `This browser has no share sheet for audio, so ${files.length === 1 ? 'the file was' : 'a ZIP of the files was'} saved to your downloads instead.` : null);
      }
    });
  const asMastered = project.stats ? lufs(project.stats.lufs) : 'as it is';

  const top = <TopBar back left="Share" />;

  const card = (
      <Card style={{ borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Txt size={16} w="semi" numberOfLines={1}>
            {project.name}
          </Txt>
          <Txt size={13} color={C.muted}>
            {[clock(song.mix?.durationSec ?? project.stats?.durationSec ?? project.beat.durationSec), take ? 'beat and vocals' : 'beat only', project.overrides.master ? 'set by hand' : project.master.style, song.mix ? lufs(song.mix.lufs) : null].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <RoundPlay playing={song.t.playing} onPress={song.toggle} disabled={!song.t.loaded} />
      </Card>
  );

  const loudness = (
      <View>
        <View style={{ paddingBottom: 4 }}>
          <Eyebrow>Loudness</Eyebrow>
        </View>
        <Option radio boxFirst divided label="Streaming" hint="−14 LUFS" checked={choice.loudness === 'streaming'} onChange={() => set({ loudness: 'streaming' })} />
        <Option radio boxFirst divided label="Loud, for socials and demos" hint="−9 LUFS" checked={choice.loudness === 'loud'} onChange={() => set({ loudness: 'loud' })} />
        <Option radio boxFirst label="Keep as mastered" hint={asMastered} checked={choice.loudness === 'mastered'} onChange={() => set({ loudness: 'mastered' })} />
      </View>
  );

  const format = (
      <View>
        <View style={{ paddingBottom: 4 }}>
          <Eyebrow>Format</Eyebrow>
        </View>
        <Option radio boxFirst divided label="WAV, 24-bit" hint="Full quality" checked={choice.format === 'wav24'} onChange={() => set({ format: 'wav24' })} />
        <Option radio boxFirst divided={small} label="WAV, 16-bit" hint="Smaller · plays anywhere" checked={choice.format === 'wav16'} onChange={() => set({ format: 'wav16' })} />
        {/* Only offered where the browser can make one. */}
        {small && <Option radio boxFirst label="M4A, for sending" hint="About a tenth the size" checked={choice.format === 'm4a'} onChange={() => set({ format: 'm4a' })} />}
      </View>
  );

  const include = take && (
        <View>
          <View style={{ paddingBottom: 4 }}>
            <Eyebrow>Also include</Eyebrow>
          </View>
          <Option boxFirst label="Instrumental, mastered to match" checked={choice.instrumental} onChange={(instrumental) => set({ instrumental })} />
          <Option boxFirst label="Vocals only" checked={choice.vocals} onChange={(vocals) => set({ vocals })} />
        </View>
      );

  // A link friends can open to hear the song and leave notes at a moment in it.
  const [link, setLink] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const linking = useTask();
  const [linkStage, setLinkStage] = useState('');
  const [copied, setCopied] = useState(false);
  const loadLink = () =>
    linkNotes(project.id).then(
      (found) => (setLink(found?.link ?? null), setNotes(found?.notes ?? [])),
      () => {},
    );
  useEffect(() => {
    if (linksAvailable) void loadLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  const listening = linksAvailable && (
      <View style={{ gap: 8 }}>
        <View style={{ paddingBottom: 2 }}>
          <Eyebrow>Listening link</Eyebrow>
        </View>
        <Muted size={13}>{link ? 'Anyone with this link can hear the song and leave notes at a moment in it. Make it again after a new mix and the same link plays the new one.' : 'A private link to a simple player page. Friends tap the waveform and leave a note at that moment; the notes show up here.'}</Muted>
        {link && <Field label="Listening link" value={link} editable={false} selectTextOnFocus />}
        <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
          <Chip
            label={linking.busy ? `${linkStage || 'Working'}…` : link ? 'Update the link' : 'Make a listening link'}
            on={!link}
            onPress={() =>
              !linking.busy &&
              linking.run(async () => {
                song.pause();
                setLink(await makeLink(project, setLinkStage));
                setLinkStage('');
              })
            }
            style={{ paddingHorizontal: 16 }}
          />
          {link && !linking.busy && (
            <>
              <Chip
                label={copied ? 'Copied' : 'Copy'}
                onPress={() => void navigator.clipboard?.writeText(link).then(() => (setCopied(true), setTimeout(() => setCopied(false), 2000)), () => {})}
                style={{ paddingHorizontal: 16, borderColor: C.text }}
              />
              <Chip label="Check for notes" onPress={() => void loadLink()} style={{ paddingHorizontal: 16 }} />
              <Chip label="Take it down" onPress={() => linking.run(async () => (await removeLink(project.id), setLink(null), setNotes([])))} style={{ paddingHorizontal: 16 }} />
            </>
          )}
        </View>
        {linking.error && (
          <Txt size={13} color={C.recText}>
            {linking.error}
          </Txt>
        )}
        {notes.map((n, i) => (
          <View key={i} style={[s.row, { gap: 10, alignItems: 'flex-start', paddingVertical: 6, borderTopWidth: 0.5, borderTopColor: C.border }]}>
            <Txt size={13} w="semi" color={C.accent} style={{ width: 40 }}>
              {clock(n.atSec)}
            </Txt>
            <View style={{ flex: 1 }}>
              <Txt size={14}>{n.text}</Txt>
              <Txt size={12} color={C.muted}>
                {n.name}
              </Txt>
            </View>
          </View>
        ))}
      </View>
  );

  // Who did what and who gets what. With anyone named, a split sheet goes out with the files.
  const setCredits = (next: Credit[]) => (setDone(null), setReady(null), patchProject(project.id, { credits: next }, false));
  const editCredit = (i: number, patch: Partial<Credit>) => setCredits(credits.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const startCredits = () => {
    const artist = artistOf(project, profile);
    const producer = profile.producer.trim();
    setCredits(producer && producer !== artist ? [{ name: artist, role: 'Performer', share: 50 }, { name: producer, role: 'Producer', share: 50 }] : [{ name: artist === 'You' ? '' : artist, role: 'Performer', share: 100 }]);
  };
  const total = credits.reduce((n, c) => n + c.share, 0);
  const splits = (
      <View style={{ gap: 8 }}>
        <View style={{ paddingBottom: 2 }}>
          <Eyebrow>Credits and splits</Eyebrow>
        </View>
        {credits.length === 0 ? (
          <View style={{ gap: 8 }}>
            <Muted size={13}>Say who wrote, produced and performed, and how it is split. A split sheet then goes out with the song.</Muted>
            <Chip label="Add credits" onPress={startCredits} style={{ alignSelf: 'flex-start', paddingHorizontal: 16 }} />
          </View>
        ) : (
          <>
            {credits.map((c, i) => (
              <View key={i} style={{ gap: 6, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: C.border }}>
                <View style={[s.row, { gap: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Field label={`Name ${i + 1}`} value={c.name} onChangeText={(name) => editCredit(i, { name })} placeholder="Name" maxLength={40} autoCapitalize="words" returnKeyType="done" />
                  </View>
                  <View style={{ width: 84 }}>
                    <Field label={`Share ${i + 1}, percent`} value={c.share ? String(c.share) : ''} onChangeText={(v) => editCredit(i, { share: Math.max(0, Math.min(100, Math.round(Number(v.replace(/[^0-9.]/g, '')) || 0))) })} placeholder="%" maxLength={3} keyboardType="number-pad" returnKeyType="done" />
                  </View>
                </View>
                <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
                  {ROLES.map((role) => (
                    <Chip key={role} label={role} on={c.role === role} onPress={() => editCredit(i, { role })} style={{ paddingHorizontal: 12 }} />
                  ))}
                  <Chip label="Remove" onPress={() => setCredits(credits.filter((_, j) => j !== i))} style={{ paddingHorizontal: 12, marginLeft: 'auto' }} />
                </View>
              </View>
            ))}
            <View style={[s.row, s.between, { gap: 8 }]}>
              <Chip label="Add a person" onPress={() => setCredits([...credits, { name: '', role: 'Writer', share: Math.max(0, 100 - total) }])} style={{ paddingHorizontal: 14 }} />
              <Txt size={13} w="medium" color={total === 100 ? C.muted : C.recText}>
                {total === 100 ? 'Splits add up to 100%' : `Splits add up to ${total}%, not 100%`}
              </Txt>
            </View>
          </>
        )}
      </View>
  );

  const foot = (
      <Foot>
        {(task.error || done || task.busy) && (
          <Txt size={13} color={task.error ? C.recText : C.muted} center>
            {task.error ?? (task.busy ? `${stage || 'Working'}…` : done)}
          </Txt>
        )}
        <Btn label={canShareFiles() ? (ready ? 'Share now' : 'Share') : `Save ${plural(count, 'file')}`} busy={task.busy} onPress={() => run(canShareFiles() ? 'share' : 'save')} />
        {canShareFiles() && <Btn kind="outline" label="Save to Files" size={16} disabled={task.busy} onPress={() => run('save')} style={{ flex: 0 }} />}
        {project.saved && (
          <NavLink to="/cover" center>
            Change the cover art
          </NavLink>
        )}
      </Foot>
  );

  // Wide: the choices on the left; the song, and sending it, on the right.
  if (wide)
    return (
      <Screen gap={24}>
        {top}
        <Columns
          side={420}
          gap={48}
          inner={22}
          left={
            <>
              {loudness}
              {format}
              {include}
              {listening}
              {splits}
            </>
          }
          right={
            <>
              {card}
              {foot}
            </>
          }
        />
      </Screen>
    );

  return (
    <Screen>
      {top}

      {card}

      {loudness}

      {format}

      {include}

      {listening}

      {splits}

      {foot}
    </Screen>
  );
}

// A sheet over the player or the mix.
export default asSheet(Export, { fallback: '/vault' });
