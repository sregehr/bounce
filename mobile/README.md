# Bounce app

The Bounce app, built with Expo so one codebase serves the web now and the phone apps next.
It runs in a browser today; the iPhone build still uses stand-ins for audio, storage and sharing.

Needs Node 22.13 or newer (`nvm use 26`).

## Run it

```bash
npm install
npx convex dev        # the backup server; leave it running in its own terminal
npm run web           # the app, at http://localhost:8081
```

`npx convex dev` runs a local server without an account when you are not logged in to Convex.
The app works without it: everything is saved in the browser, and backup simply waits.

Use Chrome or Safari. Recording needs a microphone and, for capturing beats, an audio input
such as an MPC over USB. The demo songs on the home screen need neither.

The demo songs are the Get a Life soundtrack, copied into `public/demo` (51 MB) and listed in
`src/data/demoSongs.ts`. Their provenance and usage terms are recorded in that project.

### On a phone, in the browser

Phones only allow the microphone on secure pages, so serve a build over HTTPS:

```bash
npm run build:web
npm run serve:phone   # prints the address to open on the phone (same Wi-Fi)
```

The certificate is self-signed, so the phone shows a warning once. The backup server is only
reachable from this computer, so a phone keeps its work on the phone.

## Check it

```bash
npm run typecheck
npm test              # the audio maths: loudness, limiter, tempo, key, mixing, mastering
npm run e2e           # drives the whole app in headless Chrome with a fake microphone
```

`npm run e2e` expects the app at http://localhost:8081 (set `BASE` to test a build instead)
and Google Chrome installed. Editing files while it runs reloads the page and fails the run.

## Where things are

| Folder | What is in it |
|---|---|
| `src/app` | One file per screen (Expo Router) |
| `src/ui` | The design system: colours, type, buttons, sliders, waveform bars |
| `src/dsp` | Audio maths with no platform code: analysis, effects, mixing, mastering, WAV |
| `src/engine` | Audio in and out. `engine.web.ts` is the browser engine; `engine.ts` is the phone stand-in |
| `src/data` | The library (saved in the browser), takes, rendering, export, backup |
| `src/cover` | Cover art: cutting the person out of a photo and drawing the scenes |
| `src/snippet` | Snippet video recording |
| `convex` | Backup functions and schema |
| `modules/bounce-audio` | The native iOS audio module from the first spike (`/spike` on a phone build) |
| `test` | Audio maths tests and the browser run |

Files ending `.web.ts` are used in the browser; the file of the same name without `.web`
is what a phone build gets.

## Not built yet

- The phone engine: `src/engine/engine.ts`, `src/data/db.ts`, `src/data/files.ts`,
  `src/cover/compose.ts` and `src/snippet/video.ts` are stand-ins.
- Accounts. Backup is one-way and tied to a random id per browser; it cannot be restored elsewhere.
- Tuning vocals to the key, removing beat bleed from the mic, transcribing takes,
  and making cover scenes from a written description. Each needs a model or service
  that is not part of this build.
- M4A export. Browsers cannot encode it reliably; exports are WAV.
