# Bounce app

The Bounce app, built with Expo so one codebase serves the web now and the phone apps next.
It runs in a browser today; the iPhone build still uses stand-ins for audio, storage and sharing.

Needs Node 22.13 or newer (`nvm use 26`).

## Run it

```bash
npm install
npx convex dev        # the server (accounts, AI covers, backup); leave it running in its own terminal
npm run web           # the app, at http://localhost:8081
```

`npx convex dev` runs a local server without an account when you are not logged in to Convex.
The app works without it: everything is saved in the browser, and backup simply waits.

### Accounts and AI covers

Signing in (Google and Apple, through Convex Auth) and AI cover art both run on the Convex
server and need a few values set on it. The server will not deploy until all six sign-in
variables exist, so a provider you have not set up yet gets the value `unset`; the app then
hides its button.

```bash
npx convex env set AUTH_GOOGLE_CLIENT_ID <id>          # or: unset
npx convex env set AUTH_GOOGLE_CLIENT_SECRET <secret>  # or: unset
npx convex env set AUTH_APPLE_CLIENT_ID <services id>  # or: unset
npx convex env set AUTH_APPLE_TEAM_ID <team id>        # or: unset
npx convex env set AUTH_APPLE_KEY_ID <key id>          # or: unset
npx convex env set AUTH_APPLE_PRIVATE_KEY < AuthKey_XXXXXXXXXX.p8
npx convex env set OPENROUTER_API_KEY <key>            # AI covers
```

- **Google**: make a "Web application" OAuth client and add
  `<CONVEX_SITE_URL>/oauth/google/callback` as an authorised redirect URI
  (`npx convex env get CONVEX_SITE_URL`; locally that is `http://127.0.0.1:3211`).
- **Apple**: the return URL on the Services ID is `<CONVEX_SITE_URL>/oauth/apple/callback`.
  Apple refuses localhost, so it only works against a deployed server.
- `APP_ORIGINS` lists the web addresses a sign-in may return to, comma-separated. It defaults
  to `http://localhost:8081`; set it on any deployment the app is served from elsewhere.
- `AI_IMAGE_MODEL` picks the OpenRouter image model (default `google/gemini-2.5-flash-image`),
  and `AI_FREE_IMAGES` how many covers a free account may make (default 5).

Who may use AI is decided in one place, `convex/entitlements.ts`: a signed-in account gets the
free allowance, and an account with `pro` set has no limit. Nothing sets `pro` yet; that is
where the in-app purchase plugs in.

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
| `src/cover` | Cover art: cutting the person out of a photo, drawing the scenes, and AI scenes from a description |
| `src/auth` | The server connection, sign-in buttons and the account panel |
| `src/snippet` | Snippet video recording |
| `convex` | The server: sign-in, users, AI covers, backup and the schema |
| `modules/bounce-audio` | The native iOS audio module from the first spike (`/spike` on a phone build) |
| `test` | Audio maths tests and the browser run |

Files ending `.web.ts` are used in the browser; the file of the same name without `.web`
is what a phone build gets.

## Not built yet

- The phone engine: `src/engine/engine.ts`, `src/data/db.ts`, `src/data/files.ts`,
  `src/cover/compose.ts` and `src/snippet/video.ts` are stand-ins.
- Restoring a backup. Signing in links a device's backup to the account, but it is still
  one-way and cannot be brought back onto another device.
- Paying for AI. The free allowance is enforced on the server; the purchase that lifts it is not built.
- Sign-in on the phone build is written (it returns through `bounce://auth`) but has not been run on a device.
- Tuning vocals to the key, removing beat bleed from the mic and transcribing takes.
  Each needs a model or service that is not part of this build.
- M4A export. Browsers cannot encode it reliably; exports are WAV.
