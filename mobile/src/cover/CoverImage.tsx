import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

import { blobUrl, blobs } from '@/data/db';
import type { Project } from '@/data/model';
import { C } from '@/ui/theme';
import { Txt } from '@/ui/kit';

const urls = new Map<string, string>();

/** A URL for a stored image, made once and reused. */
export function useStoredImage(key: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(key ? (urls.get(key) ?? null) : null);
  useEffect(() => {
    let live = true;
    if (!key) {
      setUrl(null);
      return;
    }
    const known = urls.get(key);
    if (known) {
      setUrl(known);
      return;
    }
    blobs.get(key).then((blob) => {
      if (!live || !blob) return;
      const made = blobUrl(blob);
      urls.set(key, made);
      setUrl(made);
    }, () => {});
    return () => {
      live = false;
    };
  }, [key]);
  return url;
}

/** A hue picked from the name, so songs without a photo still look different from each other. */
export function tint(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** A song's cover: its photo if it has one, otherwise a coloured tile with its initial. */
export function CoverImage({ project, size, radius = 12, fill }: { project: Project; size?: number; radius?: number; fill?: boolean }) {
  const url = useStoredImage(project.cover.imageKey ?? project.cover.photoKey);
  const box = fill ? ({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const) : { width: size, height: size, borderRadius: radius };
  if (url) return <Image source={{ uri: url }} accessibilityIgnoresInvertColors style={[box, { backgroundColor: C.surface }]} resizeMode="cover" />;
  const hue = tint(project.name);
  return (
    <View style={[box, { backgroundColor: `hsl(${hue}, 45%, 22%)`, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
      <View style={{ position: 'absolute', width: '140%', height: '70%', top: '-20%', left: '-20%', borderRadius: 999, backgroundColor: `hsl(${(hue + 40) % 360}, 60%, 34%)`, opacity: 0.7 }} />
      <Txt size={fill ? 160 : Math.round((size ?? 40) * 0.5)} w="display" color={`hsl(${hue}, 70%, 82%)`} lh={1}>
        {(project.name.trim()[0] ?? 'B').toUpperCase()}
      </Txt>
    </View>
  );
}
