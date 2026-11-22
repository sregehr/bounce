// A cover scene made from a description. The picture is painted by an image model on the
// Bounce server; by default only the words are sent, and the artist is placed on the result
// here on the device. Sending the photo so the artist is redrawn into the scene is a choice.
import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAction } from 'convex/react';
import { ConvexError } from 'convex/values';

import { api } from '../../convex/_generated/api';
import { SignIn, useAccount } from '@/auth/account';
import { blobs } from '@/data/db';
import { Btn, Card, Field, Muted, NavLink, Option, Txt, s } from '@/ui/kit';
import { useTask } from '@/ui/hooks';
import { C } from '@/ui/theme';

import { composeBackdrop, normalisePhoto, toDataUrl } from './compose';

const IDEAS = 'A neon alley in the rain, a desert road at dusk, a packed arena from the stage…';

/** The mark for anything AI makes: a large spark with a small one beside it. */
export function Sparkle({ size = 18, color = C.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M10 2.5l1.9 5.1a3 3 0 001.8 1.8l5.1 1.9-5.1 1.9a3 3 0 00-1.8 1.8L10 20.1l-1.9-5.1a3 3 0 00-1.8-1.8L1.2 11.3l5.1-1.9a3 3 0 001.8-1.8z" fill={color} />
      <Path d="M19 14.5l.8 2.1a1.2 1.2 0 00.7.7l2.1.8-2.1.8a1.2 1.2 0 00-.7.7l-.8 2.1-.8-2.1a1.2 1.2 0 00-.7-.7l-2.1-.8 2.1-.8a1.2 1.2 0 00.7-.7z" fill={color} />
    </Svg>
  );
}

/** `made` says a scene is already showing, so the button offers another. `onClose` closes the dialog it is shown in. */
export function AiScene({ photoKey, cutoutKey, who, disabled, made, onMade, onClose }: { photoKey: string | null; cutoutKey: string | null; who: string; disabled?: boolean; made?: boolean; onMade: (cover: Blob) => void; onClose?: () => void }) {
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
    <Card style={{ padding: 16, gap: 10, borderColor: 'rgba(255,176,32,0.5)', backgroundColor: 'rgba(255,176,32,0.06)' }}>
      <View style={[s.row, s.between]}>
        <View style={[s.row, { gap: 8 }]}>
          <Sparkle />
          <Txt size={17} w="display" ls={0} color={C.accent}>
            Create with AI
          </Txt>
        </View>
        {onClose && (
          <NavLink tone="quiet" size={13} style={{ minHeight: 24 }} onPress={onClose}>
            Close
          </NavLink>
        )}
      </View>
      {loading ? (
        <Muted size={13}>Checking sign-in…</Muted>
      ) : !signedIn ? (
        <>
          <Muted size={13}>{`Describe any setting and AI paints it as the cover${photoKey ? `, with ${who} placed in it` : ''}. Sign in to try it.`}</Muted>
          <SignIn />
        </>
      ) : (
        <>
          <Muted size={13}>
            {photoKey ? `Describe a setting and AI paints it, with ${who} placed in it.` : `Describe a setting and AI paints it as the cover. Add a photo afterwards and ${who} is placed in it.`}
          </Muted>
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
          <Btn label={task.busy ? 'Painting…' : made ? 'Create another scene' : 'Create the scene'} busy={task.busy} disabled={disabled || out || prompt.trim().length < 3} onPress={run} />
          <Txt size={13} color={task.error ? C.recText : C.muted}>
            {task.error ?? (task.busy ? 'This takes around ten seconds.' : remaining === null ? 'Signed in. No limit on AI covers.' : out ? 'You have used your free AI covers.' : `${remaining} free AI ${remaining === 1 ? 'cover' : 'covers'} left.`)}
          </Txt>
        </>
      )}
    </Card>
  );
}
