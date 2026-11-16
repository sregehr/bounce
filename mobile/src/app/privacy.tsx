import { View } from 'react-native';

import { Eyebrow, Muted, NavLink, Screen, TopBar } from '@/ui/kit';

// What Bounce does with what you give it, in plain words. Keep this true: change it in the
// same commit as anything that changes where recordings, photos or account details go.
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'What stays on your device',
    body: [
      'Your beats, vocal takes, mixes, covers and settings are saved on the device you make them on. Bounce works without an account, and you can delete everything from Settings at any time.',
      'The microphone is only listened to while you are capturing a beat, recording, or checking your timing.',
    ],
  },
  {
    title: 'Backup',
    body: [
      'Backup is on until you turn it off in Settings. While it is on, a copy of your library is kept on the Bounce server: beats, takes, the details of each song, and its cover, including the photo of the artist.',
      'With backup off, nothing from your library is sent to the server.',
    ],
  },
  {
    title: 'Signing in',
    body: [
      'Signing in is optional. If you sign in with Google or Apple, Bounce receives your name, email address and profile picture from them and keeps them with your account. It never sees your password.',
      'Your account also records how many AI covers you have made.',
    ],
  },
  {
    title: 'AI covers',
    body: [
      'When you make a scene with AI, the description you type is sent through OpenRouter to the company that runs the image model, currently Google. The photo of the artist is only sent with it if you choose to have the artist redrawn into the scene.',
      'Bounce keeps a record of each request: its description, when it was made and what it cost. The finished picture is saved with your song like any other cover.',
    ],
  },
  {
    title: 'What Bounce does not do',
    body: ['No advertising, no tracking across other apps or sites, and nothing you make or tell Bounce is sold or shared, beyond the services named above that are needed to do what you asked.'],
  },
  {
    title: 'Removing your data',
    body: [
      'Deleting everything in Settings removes your library from the device. Turning backup off stops new copies being made.',
      'Removing an account and its backup from the server is not built into the app yet. Ask the developer and it will be removed.',
    ],
  },
];

export default function Privacy() {
  return (
    <Screen gap={22} padBottom={40}>
      <TopBar left="Privacy" right={<NavLink to="/" back>Close</NavLink>} />
      <Muted size={13}>Last updated 15 November 2026.</Muted>
      {SECTIONS.map((section) => (
        <View key={section.title} style={{ gap: 8 }}>
          <Eyebrow>{section.title}</Eyebrow>
          {section.body.map((text) => (
            <Muted key={text} size={15}>
              {text}
            </Muted>
          ))}
        </View>
      ))}
    </Screen>
  );
}
