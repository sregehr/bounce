import { useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { backendAvailable } from '@/auth/backend';
import { AiScene, Sparkle } from '@/cover/AiScene';
import { composeScene, coverSupported, cutOut, normalisePhoto } from '@/cover/compose';
import { blobUrl, blobs } from '@/data/db';
import { newId, SCENES, type SceneId } from '@/data/model';
import { artistNamed, artistsIn } from '@/data/artists';
import { dropBlob, finishSong, patchProject, saveArtist, setProfile, setSongArtist, update, useLibrary, useProject } from '@/data/store';
import { Btn, Card, Chip, Field, Foot, Muted, NavLink, Screen, TopBar, Txt, s } from '@/ui/kit';
import { useTask } from '@/ui/hooks';
import { asSheet, useSheet } from '@/ui/nav';
import { C } from '@/ui/theme';
import { useWide } from '@/ui/wide';

const LABEL: Record<SceneId | 'ai', string> = { photo: 'As taken', studio: 'Studio', stage: 'Stage', rooftop: 'Rooftop', ai: 'AI scene' };

// Room the pinned button and the line under it take at the foot of the sheet.
const PIN_ROOM = 104;

type Picture = { blob: Blob; url: string };
type Made = Record<SceneId, Picture>;

function Cover() {
  const project = useProject();
  // The last step of finishing a song: name it, choose its cover, and save it to the Vault.
  const finishing = !!useLocalSearchParams<{ finish?: string }>().finish && !project?.saved;
  const [title, setTitle] = useState(project?.name ?? '');
  const lastPhoto = useLibrary((l) => l.coverPhotoKey);
  const ownName = useLibrary((l) => l.profile.artist);
  const others = useLibrary((l) => l.projects);
  const library = useLibrary((l) => l);
  // The producer is the person holding the phone, so the credit carries over to the next song.
  const producer = useLibrary((l) => l.profile.producer);
  const task = useTask();
  const sheet = useSheet();
  const [made, setMade] = useState<Made | null>(null);
  // A scene made from a description. It is kept apart from the drawn ones, and needs no photo.
  const [ai, setAi] = useState<Picture | null>(null);
  const [scene, setScene] = useState<SceneId | 'ai'>(project?.cover.scene ?? 'photo');
  const [aiOpen, setAiOpen] = useState(false);
  // The AI scene can be the saved choice with no AI picture left to show, after the photo was
  // changed. Then the photo's own first scene is shown, so the picture is never empty above its scenes.
  const lostAi = scene === 'ai' && !ai && !!made && !project?.cover.imageKey;
  // The dialog only opens from its button: once a scene is made it closes, so the picture can be seen.
  useEffect(() => {
    if (lostAi) {
      setScene('photo');
      setAiOpen(false);
    }
  }, [lostAi]);
  const [hasCutout, setHasCutout] = useState(true);
  const [stage, setStage] = useState('');
  const urls = useRef<string[]>([]);
  const wide = useWide();
  const insets = useSafeAreaInsets();

  const build = async (photo: Blob, cutout: Blob | null) => {
    setStage('Building the scenes');
    const next = {} as Made;
    for (const id of SCENES) {
      const blob = await composeScene(id, photo, cutout);
      const url = blobUrl(blob);
      urls.current.push(url);
      next[id] = { blob, url };
    }
    setHasCutout(!!cutout);
    setMade(next);
    setStage('');
  };

  const showAi = (blob: Blob) => {
    const url = blobUrl(blob);
    urls.current.push(url);
    setAi({ blob, url });
    setScene('ai');
  };

  /** Loads a stored photo and its cut-out and builds the scenes from them. */
  const loadStored = (photoKey: string, cutoutKey: string | null) =>
    task.run(async () => {
      const photo = await blobs.get(photoKey);
      if (!photo) throw new Error('The photo for this cover is no longer on this device. Add it again.');
      await build(photo, cutoutKey ? ((await blobs.get(cutoutKey)) ?? null) : null);
    });

  useEffect(() => {
    if (project?.cover.photoKey) void loadStored(project.cover.photoKey, project.cover.cutoutKey);
    // A cover that is an AI scene is shown again as it was saved.
    if (project?.cover.scene === 'ai' && project.cover.imageKey) void blobs.get(project.cover.imageKey).then((blob) => blob && showAi(blob));
    return () => urls.current.forEach((u) => URL.revokeObjectURL?.(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!project) return <Redirect href="/" />;
  const cover = project.cover;

  // The cover features whoever is on the song: the rapper or singer, who is often not the person holding the phone.
  const artist = project.artist?.trim() ?? '';
  const who = artist || 'the artist';

  /** Takes a new photo with the camera, or picks one already on the device. */
  const pick = (from: 'camera' | 'library' = 'library') =>
    task.run(async () => {
      if (from === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error('Allow the camera to take a photo, or choose one you already have.');
      const picked =
        from === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, cameraType: ImagePicker.CameraType.back })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (picked.canceled || !picked.assets?.[0]) return;
      setStage('Reading the photo');
      const photo = await normalisePhoto(await (await fetch(picked.assets[0].uri)).blob());
      setStage(`Finding ${who} in the photo`);
      const cutout = await cutOut(photo);
      const photoKey = `photo-${newId()}`;
      const cutoutKey = cutout ? `${photoKey}:cut` : null;
      await blobs.put(photoKey, photo);
      if (cutout && cutoutKey) await blobs.put(cutoutKey, cutout);
      patchProject(project.id, { cover: { ...cover, photoKey, cutoutKey, imageKey: null } });
      update((l) => ({ ...l, coverPhotoKey: photoKey }));
      await build(photo, cutout);
    });

  const reuse = () =>
    lastPhoto &&
    task.run(async () => {
      const cutoutKey = (await blobs.get(`${lastPhoto}:cut`)) ? `${lastPhoto}:cut` : null;
      patchProject(project.id, { cover: { ...cover, photoKey: lastPhoto, cutoutKey, imageKey: null } });
      const photo = await blobs.get(lastPhoto);
      if (!photo) throw new Error('That photo is no longer on this device.');
      await build(photo, cutoutKey ? ((await blobs.get(cutoutKey)) ?? null) : null);
    });

  // What the big preview shows: the AI scene when that is chosen, otherwise one of the drawn ones.
  const shown: Picture | null = scene === 'ai' ? ai : (made?.[scene] ?? null);
  const hasAi = backendAvailable && coverSupported;

  const apply = () =>
    (shown || finishing) &&
    task.run(async () => {
      if (shown) {
        const imageKey = `cover-${newId()}`;
        await blobs.put(imageKey, shown.blob);
        const old = cover.imageKey;
        patchProject(project.id, (p) => ({ cover: { ...p.cover, scene, imageKey } }));
        if (old) void dropBlob(old);
      }
      // Changing a cover closes the sheet, back to the player or the Vault it was opened from.
      if (!finishing) return sheet ? sheet.close() : router.replace('/player');
      // The finished song opens in the Player, one level above Home like any tab.
      finishSong(project.id, title);
      if (router.canDismiss()) router.dismissAll();
      router.push('/player');
    });

  const working = task.busy;

  // Artists with a profile come first; a name that is only on older songs is still one tap away.
  const profiles = artistsIn(library);
  const recent = [...new Set(others.map((p) => p.artist?.trim()).filter((n): n is string => !!n && n !== project.artist?.trim() && !artistNamed(library, n)))].slice(0, 4);
  const typed = project.artist?.trim() ?? '';
  const top = <TopBar back left={finishing ? 'Finish song' : 'Cover art'} />;

  const fields = (
    <>
      {finishing && (
        <View style={{ gap: 6 }}>
          <Txt size={12} color={C.muted}>
            Title
          </Txt>
          <Field label="Song title" value={title} onChangeText={setTitle} placeholder={project.name} maxLength={60} returnKeyType="done" />
        </View>
      )}

      <View style={{ gap: 6 }}>
        <Txt size={12} color={C.muted}>
          Artist on this song
        </Txt>
        <Field label="Artist on this song" value={project.artist ?? ''} onChangeText={(name) => patchProject(project.id, { artist: name, artistId: artistNamed(library, name)?.id }, false)} placeholder={ownName || 'Who is on the mic?'} maxLength={40} autoCapitalize="words" returnKeyType="done" />
        {/* People who have been on other songs here are one tap away. */}
        {profiles.length + recent.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {profiles.map((a) => (
              <Chip key={a.id} label={a.name} on={project.artistId === a.id} onPress={() => setSongArtist(project.id, a)} style={{ paddingHorizontal: 12 }} />
            ))}
            {recent.map((name) => (
              <Chip key={name} label={name} on={project.artist === name} onPress={() => patchProject(project.id, { artist: name, artistId: undefined }, false)} style={{ paddingHorizontal: 12 }} />
            ))}
          </View>
        )}
        {/* A name typed for the first time can be kept, so their sound can be saved for next time. */}
        {typed.length > 1 && !project.artistId && !artistNamed(library, typed) && (
          <NavLink size={13} style={{ minHeight: 44 }} onPress={() => saveArtist(typed)}>
            {`Save ${typed} as an artist`}
          </NavLink>
        )}
      </View>

      <View style={{ gap: 6 }}>
        <Txt size={12} color={C.muted}>
          Produced by
        </Txt>
        <Field label="Produced by" value={producer} onChangeText={(name) => setProfile({ producer: name })} placeholder="Who made the beat? (optional)" maxLength={40} autoCapitalize="words" returnKeyType="done" />
      </View>
    </>
  );

  // The small buttons that sit on the picture.
  const pill = { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: 'rgba(18,18,18,0.8)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' } as const;

  const preview = (
      <View style={[{ height: 320, borderRadius: 24, overflow: 'hidden', backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }, wide && { flex: 1, height: undefined, minHeight: 320 }]}>
        {shown ? (
          <>
            <Image source={{ uri: shown.url }} accessibilityLabel={`Cover preview: ${LABEL[scene]}`} style={wide ? { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' } : { width: '100%', height: 320 }} resizeMode="cover" />
            {/* The photo is added or changed from the picture itself. The phone's picker offers the camera too. */}
            {!working && (
              <View style={{ position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', gap: 8 }}>
                {hasAi && (
                  <Pressable accessibilityRole="button" accessibilityLabel="Create with AI" onPress={() => setAiOpen(true)} style={({ pressed }) => [pill, { borderColor: C.accent, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.7 : 1 }]}>
                    <Sparkle size={15} />
                    <Txt size={14} w="semi" color={C.accent}>
                      {ai ? 'New AI scene' : 'Create with AI'}
                    </Txt>
                  </Pressable>
                )}
                <Pressable accessibilityRole="button" accessibilityLabel={made ? 'Change photo' : 'Choose a photo'} onPress={() => pick()} style={({ pressed }) => [pill, { opacity: pressed ? 0.7 : 1 }]}>
                  <Txt size={14} w="semi">
                    {made ? 'Change photo' : 'Choose a photo'}
                  </Txt>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <View style={[{ alignItems: 'center', gap: 10, padding: 24 }, wide && { maxWidth: 460 }]}>
            <Txt size={22} w="display" center>
              {working ? `${stage || 'Working'}…` : `Add a photo of ${who}`}
            </Txt>
            <Muted center>{working ? 'This takes a few seconds the first time.' : 'Pick one you have, or take one now while they are with you. Head and shoulders in plain light works best. They get placed in a studio, on a stage and on a rooftop.'}</Muted>
            {!working && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 4 }}>
                <Btn label="Choose a photo" onPress={() => pick()} style={{ flexGrow: 0, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: 22 }} />
                {hasAi && (
                  <Pressable accessibilityRole="button" accessibilityLabel="Create with AI" onPress={() => setAiOpen(true)} style={({ pressed }) => ({ minHeight: 56, paddingHorizontal: 20, borderRadius: 16, borderWidth: 1, borderColor: C.accent, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.7 : 1 })}>
                    <Sparkle />
                    <Txt size={16} w="semi" color={C.accent}>
                      Create with AI
                    </Txt>
                  </Pressable>
                )}
              </View>
            )}
            {!working && lastPhoto && lastPhoto !== cover.photoKey && (
              <NavLink center size={14} onPress={reuse}>
                Use the photo from the last cover
              </NavLink>
            )}
          </View>
        )}
      </View>
  );

  const about = (
      <View style={[s.row, s.between]}>
        <Muted style={{ flex: 1 }}>
          {task.error ?? (working && made ? `${stage || 'Working'}…` : !made ? (ai ? 'Add a photo to put the artist in the scene.' : hasAi ? 'The photo only goes to AI if you choose that. Backup keeps a copy with your songs.' : 'The photo never leaves this device.') : hasCutout ? 'Same person, same pose. Only the setting changes.' : 'No clear person was found, so each setting is applied as a colour treatment.')}
        </Muted>
      </View>
  );

  // The scenes to choose from, once there is a photo. Wide stacks them in a column beside the preview.
  const scenes = made && (
        <View style={wide ? { width: 124, gap: 12 } : { flexDirection: 'row', gap: 8 }}>
          {[...SCENES, ...(ai ? (['ai'] as const) : [])].map((id) => (
            <Pressable key={id} accessibilityRole="button" accessibilityLabel={LABEL[id]} accessibilityState={{ selected: id === scene }} onPress={() => setScene(id)} style={wide ? { gap: 6 } : { flex: 1, gap: 6 }}>
              <Image source={{ uri: (id === 'ai' ? ai! : made[id]).url }} style={{ width: '100%', height: wide ? 96 : 72, borderRadius: wide ? 14 : 12, borderWidth: 3, borderColor: id === scene ? C.accent : C.bg }} resizeMode="cover" />
              <Txt size={12} w="semi" center>
                {LABEL[id]}
              </Txt>
            </Pressable>
          ))}
        </View>
      );

  // The photo is added from the picture itself. With an AI scene showing and no photo yet, the last cover's photo is still offered here.
  const add = !made && !working && !!shown && !!lastPhoto && lastPhoto !== cover.photoKey && (
    <NavLink center size={14} onPress={reuse}>
      Use the photo from the last cover
    </NavLink>
  );

  // Making a scene with AI opens over the page, from the button on the picture, so there is nothing to scroll down to.
  // It closes once the scene is made, to show it; the button on the picture opens it again for another.
  const closeAi = () => setAiOpen(false);
  const aiScene = hasAi && (
    <Modal visible={aiOpen} transparent animationType="fade" onRequestClose={closeAi}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* A tap outside the card puts it away. */}
        <Pressable accessibilityLabel="Close Create with AI" onPress={closeAi} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.7)' }} />
        <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, paddingTop: 20 + insets.top, paddingBottom: 20 + insets.bottom }}>
          <View accessibilityRole={Platform.OS === 'web' ? ('dialog' as never) : undefined} accessibilityLabel="Create with AI" style={{ width: '100%', maxWidth: 460, borderRadius: 20, backgroundColor: C.bg, boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}>
            <AiScene photoKey={cover.photoKey} cutoutKey={cover.cutoutKey} who={who} disabled={working} made={!!ai} onMade={(blob) => (showAi(blob), closeAi())} onClose={closeAi} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  const save = <Btn label={finishing ? 'Save to the Vault' : 'Set as cover and backdrop'} disabled={!shown && !finishing} busy={working && (!!shown || finishing)} onPress={apply} style={{ flex: 0, minHeight: 56 }} />;

  const foot = (
      <Foot gap={8}>
        <Muted size={13} lh={1.4}>
          {`The cover goes out with the song when you share it, so pick one ${who} is happy with.`}
        </Muted>
        <Btn label={finishing ? 'Save to the Vault' : 'Set as cover and backdrop'} disabled={!shown && !finishing} busy={working && (!!shown || finishing)} onPress={apply} />
        {finishing && !shown && !working && <Muted size={13} center>No photo? It is saved with a plain cover you can change later.</Muted>}
      </Foot>
  );

  // Wide: the words about the song and the way to save it on the left; the cover, as large as fits, on the right.
  if (wide)
    return (
      <Screen gap={24}>
        {top}
        <View style={{ flex: 1, flexDirection: 'row', gap: 40, minHeight: 0 }}>
          <View style={{ width: 400, gap: 16 }}>
            {fields}
            {aiScene}
            {foot}
          </View>
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', gap: 16 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
              {preview}
              {about}
              {add}
            </View>
            {scenes}
          </View>
        </View>
      </Screen>
    );

  // The button that finishes the sheet stays at its foot, in reach however long the sheet above it grows.
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen padBottom={PIN_ROOM + Math.max(16, insets.bottom + 12)}>
        {top}

        {fields}

        {/* Finishing a song opens on the same picture as Cover art, asking for a photo, though the cover is optional. */}
        {preview}

        {about}

        {scenes}
        {add}

        {aiScene}

        {shown && <Muted size={13} lh={1.4}>{`The cover goes out with the song when you share it, so pick one ${who} is happy with.`}</Muted>}
      </Screen>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, gap: 6, paddingTop: 10, paddingHorizontal: 24, paddingBottom: Math.max(16, insets.bottom + 12), backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.border }}>
        {save}
        {finishing && (
          <Muted size={13} center>
            {shown ? 'You can change the cover later.' : 'You can add or change the cover later.'}
          </Muted>
        )}
      </View>
    </View>
  );
}

// A sheet over the player or the Vault; as the last step of finishing a song, over the mix or the master.
export default asSheet(Cover, { fallback: '/vault' });
