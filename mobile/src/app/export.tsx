import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';

import { creditsOf, exportFiles, fileBase, LOUDNESS } from '@/data/exporting';
import { canShareFiles, oneFile, saveFiles, shareFiles, type OutFile } from '@/data/files';
import type { Credit, ExportChoice } from '@/data/model';
import { activeTake, patchProject, useLibrary, useProject } from '@/data/store';
import { artistOf } from '@/data/songs';
import { linkNotes, linksAvailable, makeLink, removeLink, type Note } from '@/data/shares';
import { useSong } from '@/data/song';
import { aacSupported } from '@/dsp/aac';
import { stopTransport } from '@/engine/engine';
import { Btn, Card, Chip, Disclosure, Eyebrow, Field, Foot, Muted, Option, RoundPlay, RowLink, Screen, TopBar, Txt, s } from '@/ui/kit';
import { useStopOnLeave, useTask } from '@/ui/hooks';
import { asSheet } from '@/ui/nav';
import { useRowLines } from '@/ui/type';
import { C, clock, lufs, plural } from '@/ui/theme';
import { Columns, useWide } from '@/ui/wide';

const ROLES = ['Writer', 'Producer', 'Performer'] as const;

// Room the pinned button, the line under it and a line of progress take at the foot of the sheet.
const PIN_ROOM = 128;

/** What the song is being shared for. Each sets the loudness, the format and the extra files together. */
const INTENTS = [
  { id: 'friend', label: 'Send to a friend', about: 'Small file that plays anywhere.', choice: { loudness: 'streaming', format: 'm4a', instrumental: false, vocals: false } },
  { id: 'post', label: 'Post or upload', about: 'Full quality, loud enough for socials and demos.', choice: { loudness: 'loud', format: 'wav16', instrumental: false, vocals: false } },
  { id: 'engineer', label: 'Send to an engineer', about: 'Song, instrumental and vocals, at the level it was mastered.', choice: { loudness: 'mastered', format: 'wav24', instrumental: true, vocals: true } },
] as const satisfies readonly { id: string; label: string; about: string; choice: ExportChoice }[];

const FORMAT = { wav24: 'WAV 24-bit', wav16: 'WAV 16-bit', m4a: 'M4A' } as const;

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
  const insets = useSafeAreaInsets();
  const lines = useRowLines();
  // The settings behind the three choices, and the two extras, are each one row that opens.
  const [custom, setCustom] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [splitsOpen, setSplitsOpen] = useState(false);
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
  // The credits go inside the files. The sheet to sign is a file of its own, and only goes when asked for.
  const sheet = !!choice.sheet && creditsOf(project).length > 0;
  const count = (take ? 1 : 0) + (!take || choice.instrumental ? 1 : 0) + (take && choice.vocals ? 1 : 0) + (sheet ? 1 : 0);
  const run = (how: 'share' | 'save') =>
    task.run(async () => {
      setDone(null);
      song.pause();
      // Rendering needs the room: the copy of the song loaded for playing here is let go, and loads again on Play.
      if (!ready) stopTransport();
      // Whatever was asked for goes out as one file: the song alone as it is, anything more as one ZIP.
      // It is bundled here, once, so a share that has to wait for a second tap sends it at once.
      const made = ready ? null : await exportFiles(project, setStage);
      if (made && made.length > 1) setStage('Bundling the files');
      const files = ready ?? [await oneFile(made!, fileBase(project.name))];
      setStage('');
      if (how === 'save') {
        const saved = await saveFiles(files, project.name);
        setDone(count === 1 ? `Saved ${saved} to your downloads.` : `${plural(count, 'file')} saved to your downloads as ${saved}.`);
      } else {
        const result = await shareFiles(files, project.name);
        // A long render outlasts the moment a browser allows a share after a tap. The files are kept, and the next tap sends them at once.
        setReady(result === 'blocked' || result === 'cancelled' ? files : null);
        if (result === 'blocked') return setDone(`${count === 1 ? 'Your file is' : 'Your ZIP is'} ready. Tap Share now to send.`);
        setDone(result === 'shared' ? 'Shared.' : result === 'saved' ? `This browser's share sheet would not take ${count === 1 ? 'the file, so it was' : 'a ZIP, so the ZIP was'} saved to your downloads instead.` : null);
      }
    });
  const asMastered = project.stats ? lufs(project.stats.lufs) : 'as it is';

  // Sending to a friend wants the small format, which not every browser can make; there it is the smaller WAV.
  const intents = INTENTS.map((i) => (i.id === 'friend' && !small ? { ...i, choice: { ...i.choice, format: 'wav16' as const } } : i));
  // With no take there are no extras to choose, so only the loudness and the format tell the choices apart.
  const fits = (c: ExportChoice) => c.loudness === choice.loudness && c.format === choice.format && (!take || (c.instrumental === choice.instrumental && c.vocals === choice.vocals));
  const intent = intents.find((i) => fits(i.choice));
  // Exactly what the button will send, in one line.
  const seconds = song.mix?.durationSec ?? project.stats?.durationSec ?? project.beat.durationSec;
  const megabytes = (seconds * project.beat.sampleRate * 2 * (choice.format === 'wav24' ? 3 : 2)) / (choice.format === 'm4a' ? 10 : 1) / 1e6;
  const extras = take ? [choice.instrumental ? 'instrumental' : null, choice.vocals ? 'vocals' : null].filter(Boolean).join(' and ') : '';
  const summary = [
    count === 1 ? '1 file' : `${count} files in one ZIP`,
    FORMAT[choice.format],
    choice.loudness === 'streaming' ? 'streaming, −14 LUFS' : choice.loudness === 'loud' ? 'loud, −9 LUFS' : 'as mastered',
    extras || null,
    count === 1 ? `about ${megabytes < 1 ? megabytes.toFixed(1) : Math.round(megabytes)} MB` : null,
    sheet ? 'split sheet' : creditsOf(project).length ? 'credits in the file' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const purpose = (
    <View style={{ gap: 8 }}>
      <Eyebrow>What is it for?</Eyebrow>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {intents.map((i) => {
          const on = intent?.id === i.id;
          return (
            <Pressable key={i.id} accessibilityRole="radio" accessibilityLabel={i.label} accessibilityState={{ checked: on }} onPress={() => set(i.choice)} style={({ pressed }) => ({ gap: 2, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, borderWidth: on ? 1.5 : 1, borderColor: on ? C.accent : C.border, backgroundColor: C.surface, opacity: pressed ? 0.7 : 1 })}>
              <Txt size={16} w="semi" color={on ? C.accent : C.text}>
                {i.label}
              </Txt>
              <Txt size={13} color={C.muted}>
                {i.about}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const top = <TopBar back left="Share" />;

  const card = (
      <Card style={{ borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Txt size={16} w="semi" numberOfLines={lines}>
            {project.name}
          </Txt>
          <Txt size={13} color={C.muted}>
            {[clock(song.mix?.durationSec ?? project.stats?.durationSec ?? project.beat.durationSec), take ? 'beat and vocals' : 'beat only', project.overrides.master ? 'set by hand' : project.master.style, song.mix ? lufs(song.mix.lufs) : null].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <RoundPlay playing={song.t.playing} onPress={song.toggle} disabled={!song.t.loaded && !song.mix} />
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
            <Txt size={13} w="semi" color={C.accent} style={{ minWidth: 40 }}>
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

  // Who did what and who gets what. It is written into the files, and a split sheet to sign can go out with them.
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
        {credits.length === 0 ? (
          <View style={{ gap: 8 }}>
            <Muted size={13}>Say who wrote, produced and performed, and how it is split. The credits are written into the song's file.</Muted>
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
            <Option boxFirst label="Include a split sheet to sign" checked={!!choice.sheet} onChange={(on) => set({ sheet: on })} />
            <Muted size={13}>{choice.sheet ? 'A page for everyone to sign goes out with the song, in one ZIP.' : 'These credits are written into the song\'s file.'}</Muted>
          </>
        )}
      </View>
  );

  const status = (task.error || done || task.busy) && (
    <Txt size={13} color={task.error ? C.recText : C.muted} center>
      {task.error ?? (task.busy ? `${stage || 'Working'}…` : done)}
    </Txt>
  );
  const send = (
    <>
      {status}
      <View style={[s.row, { gap: 10 }]}>
        <Btn label={canShareFiles() ? (ready ? 'Share now' : `Share ${plural(count, 'file')}`) : `Save ${plural(count, 'file')}`} busy={task.busy} onPress={() => run(canShareFiles() ? 'share' : 'save')} style={{ flex: 2, minHeight: 56 }} />
        {canShareFiles() && <Btn kind="outline" label="Save to Files" size={15} disabled={task.busy} onPress={() => run('save')} style={{ flex: 1, minHeight: 56 }} />}
      </View>
      <Muted size={13} center>
        {summary}
      </Muted>
    </>
  );

  // Everything past the three choices: today's settings, the link and the credits, each behind its own row.
  const more = (
    <View>
      <Disclosure title="Custom loudness and format" summary={intent ? 'As chosen above' : 'Set by hand'} open={custom} onToggle={() => setCustom(!custom)}>
        <View style={{ gap: 18, paddingTop: 6, paddingBottom: 14 }}>
          {loudness}
          {format}
          {include}
        </View>
      </Disclosure>
      {linksAvailable && (
        <Disclosure title="Listening link" summary={link ? (notes.length ? plural(notes.length, 'note') : 'On') : 'Off'} open={linkOpen} onToggle={() => setLinkOpen(!linkOpen)}>
          <View style={{ paddingBottom: 14 }}>{listening}</View>
        </Disclosure>
      )}
      <Disclosure title="Credits and splits" summary={credits.length ? plural(credits.length, 'person', 'people') : 'None'} open={splitsOpen} onToggle={() => setSplitsOpen(!splitsOpen)} last>
        <View style={{ paddingBottom: 14 }}>{splits}</View>
      </Disclosure>
      {project.saved && (
        <RowLink title="Change the cover art" to="/cover" />
      )}
    </View>
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
              {purpose}
              {more}
            </>
          }
          right={
            <>
              {card}
              <Foot>{send}</Foot>
            </>
          }
        />
      </Screen>
    );

  // The button stays at the foot of the sheet, with a line under it that says exactly what it will send.
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen padBottom={PIN_ROOM + Math.max(16, insets.bottom + 12)}>
        {top}

        {card}

        {purpose}

        {more}
      </Screen>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, gap: 6, paddingTop: 10, paddingHorizontal: 24, paddingBottom: Math.max(16, insets.bottom + 12), backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.border }}>{send}</View>
    </View>
  );
}

// A sheet over the player or the mix.
export default asSheet(Export, { fallback: '/vault' });
