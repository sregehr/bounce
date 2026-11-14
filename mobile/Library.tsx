import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery } from 'convex/react';

import { api } from './convex/_generated/api';
import type { Recording } from './modules/bounce-audio';

const C = { surface: '#1c1c1c', border: '#333333', dim: '#3a3a3a', text: '#f2f0ea', muted: '#a8a6a0', accent: '#ffb020', rec: '#ff4b3e', bg: '#121212' };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Saves the captured beat to the backend and lists what is stored there. */
export function Library({ beat }: { beat: Recording | null }) {
  const beats = useQuery(api.beats.list);
  const generateUploadUrl = useMutation(api.beats.generateUploadUrl);
  const createBeat = useMutation(api.beats.create);
  const [state, setState] = useState<'idle' | 'saving'>('idle');
  const [savedUri, setSavedUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const alreadySaved = beat != null && beat.uri === savedUri;

  async function save() {
    if (!beat) return;
    setState('saving');
    setError(null);
    try {
      const file = await (await fetch(beat.uri)).blob();
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: file });
      if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
      const { storageId } = await response.json();
      await createBeat({
        name: `Untitled beat ${(beats?.length ?? 0) + 1}`,
        audio: storageId,
        durationSec: beat.durationSec,
        sampleRate: beat.sampleRate,
        channels: beat.channels,
        bitDepth: beat.bitDepth,
        source: 'capture',
      });
      setSavedUri(beat.uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setState('idle');
    }
  }

  const disabled = !beat || alreadySaved || state === 'saving';

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>6 · LIBRARY</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={save}
        style={[styles.button, { backgroundColor: disabled ? C.dim : C.accent }]}
      >
        <Text style={[styles.buttonLabel, disabled && { color: C.muted }]}>
          {state === 'saving' ? 'Saving…' : alreadySaved ? 'Saved' : 'Save captured beat'}
        </Text>
      </Pressable>
      {beats === undefined ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : beats.length === 0 ? (
        <Text style={styles.muted}>No beats saved yet.</Text>
      ) : (
        beats.map((b) => (
          <View key={b._id} style={styles.row}>
            <Text style={styles.name}>{b.name}</Text>
            <Text style={styles.muted}>
              {clock(b.durationSec)} · {b.channels} ch · {b.sampleRate / 1000} kHz · {b.takeCount} {b.takeCount === 1 ? 'take' : 'takes'}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  eyebrow: { color: C.muted, fontSize: 12, fontWeight: '600', letterSpacing: 1.2 },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  error: { color: C.rec, fontSize: 14, lineHeight: 20 },
  row: { gap: 2 },
  name: { color: C.text, fontSize: 16, fontWeight: '600' },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonLabel: { color: C.bg, fontSize: 16, fontWeight: '600' },
});
