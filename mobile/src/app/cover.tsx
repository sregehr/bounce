import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { composeScene, cutOut, normalisePhoto } from '@/cover/compose';
import { blobUrl, blobs } from '@/data/db';
import { newId, SCENES, type SceneId } from '@/data/model';
import { patchProject, update, useLibrary, useProject } from '@/data/store';
import { Btn, Foot, Muted, NavLink, Screen, TopBar, Txt, s } from '@/ui/kit';
import { useTask } from '@/ui/hooks';
import { C } from '@/ui/theme';

const LABEL: Record<SceneId, string> = { photo: 'As taken', studio: 'Studio', stage: 'Stage', rooftop: 'Rooftop' };

type Made = Record<SceneId, { blob: Blob; url: string }>;

export default function Cover() {
  const project = useProject();
  const lastPhoto = useLibrary((l) => l.coverPhotoKey);
  const task = useTask();
  const [made, setMade] = useState<Made | null>(null);
  const [scene, setScene] = useState<SceneId>(project?.cover.scene ?? 'photo');
  const [hasCutout, setHasCutout] = useState(true);
  const [stage, setStage] = useState('');
  const urls = useRef<string[]>([]);

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

  /** Loads a stored photo and its cut-out and builds the scenes from them. */
  const loadStored = (photoKey: string, cutoutKey: string | null) =>
    task.run(async () => {
      const photo = await blobs.get(photoKey);
      if (!photo) throw new Error('The photo for this cover is no longer on this device. Add it again.');
      await build(photo, cutoutKey ? ((await blobs.get(cutoutKey)) ?? null) : null);
    });

  useEffect(() => {
    if (project?.cover.photoKey) void loadStored(project.cover.photoKey, project.cover.cutoutKey);
    return () => urls.current.forEach((u) => URL.revokeObjectURL?.(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!project) return <Redirect href="/" />;
  const cover = project.cover;

  const pick = () =>
    task.run(async () => {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (picked.canceled || !picked.assets?.[0]) return;
      setStage('Reading the photo');
      const photo = await normalisePhoto(await (await fetch(picked.assets[0].uri)).blob());
      setStage('Finding you in the photo');
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

  const apply = () =>
    made &&
    task.run(async () => {
      const imageKey = `cover-${newId()}`;
      await blobs.put(imageKey, made[scene].blob);
      const old = cover.imageKey;
      patchProject(project.id, (p) => ({ cover: { ...p.cover, scene, imageKey } }));
      if (old) void blobs.delete(old).catch(() => {});
      router.replace('/player');
    });

  const working = task.busy;

  return (
    <Screen>
      <TopBar left="Cover art" right={<NavLink to="/player" replace>Skip</NavLink>} />

      <View style={{ height: 320, borderRadius: 24, overflow: 'hidden', backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
        {made ? (
          <Image source={{ uri: made[scene].url }} accessibilityLabel={`Cover preview: ${LABEL[scene]}`} style={{ width: '100%', height: 320 }} resizeMode="cover" />
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Add a photo" disabled={working} onPress={pick} style={{ alignItems: 'center', gap: 8, padding: 24 }}>
            <Txt size={22} w="display" center>
              {working ? `${stage || 'Working'}…` : 'Add a photo of yourself'}
            </Txt>
            <Muted center>{working ? 'This takes a few seconds the first time.' : 'A portrait works best: head and shoulders, plain light. You get placed in a studio, on a stage and on a rooftop.'}</Muted>
          </Pressable>
        )}
      </View>

      <View style={[s.row, s.between]}>
        <Muted style={{ flex: 1 }}>
          {task.error ?? (working && made ? `${stage || 'Working'}…` : !made ? 'Your photo never leaves this device.' : hasCutout ? 'Same person, same pose. Only the setting changes.' : 'No clear person was found, so each setting is applied as a colour treatment.')}
        </Muted>
        {made && (
          <NavLink size={14} style={{ minHeight: 24 }} onPress={() => !working && pick()}>
            Retake
          </NavLink>
        )}
      </View>

      {made ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {SCENES.map((id) => (
            <Pressable key={id} accessibilityRole="button" accessibilityLabel={LABEL[id]} accessibilityState={{ selected: id === scene }} onPress={() => setScene(id)} style={{ flex: 1, gap: 6 }}>
              <Image source={{ uri: made[id].url }} style={{ width: '100%', height: 72, borderRadius: 12, borderWidth: 3, borderColor: id === scene ? C.accent : C.bg }} resizeMode="cover" />
              <Txt size={12} w="semi" center>
                {LABEL[id]}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : (
        !working && (
          <View style={{ gap: 4 }}>
            <Btn kind="outline" label="Choose a photo" onPress={pick} style={{ flex: 0 }} />
            {lastPhoto && lastPhoto !== cover.photoKey && (
              <NavLink center size={14} onPress={reuse}>
                Use the photo from your last cover
              </NavLink>
            )}
          </View>
        )
      )}

      <Foot gap={8}>
        <Muted size={13} lh={1.4}>
          Ask before you shoot someone else. The cut-out is made in this browser; the photo is not sent anywhere.
        </Muted>
        <Btn label="Set as cover and backdrop" disabled={!made} busy={working && !!made} onPress={apply} />
      </Foot>
    </Screen>
  );
}
