// A cover scene made from a description. The picture is painted by an image model on the
// Bounce server; by default only the words are sent, and the artist is placed on the result
// here on the device. Sending the photo so the artist is redrawn into the scene is a choice.
import { useState } from 'react';
import { View } from 'react-native';
import { useAction } from 'convex/react';
import { ConvexError } from 'convex/values';

import { api } from '../../convex/_generated/api';
import { SignIn, useAccount } from '@/auth/account';
import { blobs } from '@/data/db';
import { Btn, Card, Eyebrow, Field, Muted, Option, Txt } from '@/ui/kit';
import { useTask } from '@/ui/hooks';
import { C } from '@/ui/theme';

import { composeBackdrop, normalisePhoto, toDataUrl } from './compose';

const IDEAS = 'A neon alley in the rain, a desert road at dusk, a packed arena from the stage…';

export function AiScene({ photoKey, cutoutKey, who, disabled, onMade }: { photoKey: string | null; cutoutKey: string | null; who: string; disabled?: boolean; onMade: (cover: Blob) => void }) {
  const { loading, signedIn, me } = useAccount();
  const make = useAction(api.ai.cover);
  const task = useTask();
  const [prompt, setPrompt] = useState('');
  const [send, setSend] = useState(false);
  const [left, setLeft] = useState<number | null | undefined>(undefined);
  const restyle = send && !!photoKey;
  const remaining = left === undefined ? (me?.aiLeft ?? null) : left;
  const out = remaining === 0;

  const run = () =>
    task.run(async () => {
      try {
        const photo = restyle && photoKey ? await blobs.get(photoKey) : null;
        if (restyle && !photo) throw new Error('The photo for this cover is no longer on this device. Add it again.');
        const made = await make({ kind: restyle ? 'restyle' : 'backdrop', prompt, photo: photo ? await toDataUrl(photo) : undefined });
        setLeft(made.left);
        const picture = await (await fetch(`data:${made.mediaType};base64,${made.image}`)).blob();
        const cutout = !restyle && cutoutKey ? ((await blobs.get(cutoutKey)) ?? null) : null;
        // A redrawn photo is the cover as it comes; a backdrop gets the artist placed on it here.
        onMade(restyle ? await normalisePhoto(picture) : await composeBackdrop(picture, cutout));
      } catch (e) {
        if (e instanceof ConvexError && typeof e.data?.message === 'string') throw new Error(e.data.message);
        if (e instanceof Error && !/Server Error|Request ID/.test(e.message)) throw e;
        throw new Error('The cover could not be made. Check the connection and try again.');
      }
    });

  return (
    <Card style={{ padding: 16, gap: 10 }}>
      <Eyebrow>Make a scene with AI</Eyebrow>
      {loading ? (
        <Muted size={13}>Checking sign-in…</Muted>
      ) : !signedIn ? (
        <>
          <Muted size={13}>{`Describe any setting and Bounce paints it, with ${who} placed in it. Sign in to try it.`}</Muted>
          <SignIn />
        </>
      ) : (
        <>
          <Field label="Describe the scene" value={prompt} onChangeText={setPrompt} placeholder={IDEAS} maxLength={300} returnKeyType="done" editable={!task.busy} />
          {photoKey && (
            <Option
              label={`Redraw ${who} into the scene`}
              sub={send ? 'The photo is sent to the AI service to make this cover. The result can change how they look.' : `Off: only your words are sent, and ${who} is placed on the scene on this device.`}
              checked={send}
              onChange={setSend}
              minHeight={56}
            />
          )}
          <Btn kind="outline" label={task.busy ? 'Painting…' : 'Make the scene'} busy={task.busy} disabled={disabled || out || prompt.trim().length < 3} onPress={run} />
          <Txt size={13} color={task.error ? C.recText : C.muted}>
            {task.error ?? (task.busy ? 'This takes around ten seconds.' : remaining === null ? 'Signed in. No limit on AI covers.' : out ? 'You have used your free AI covers.' : `${remaining} free AI ${remaining === 1 ? 'cover' : 'covers'} left.`)}
          </Txt>
        </>
      )}
    </Card>
  );
}
