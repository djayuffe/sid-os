# Development

## Requirements

- Node.js 20 or later
- npm 10 or later
- A current Chromium-, Firefox-, or Safari-based browser for Web Audio testing

## Commands

```sh
npm install
npm run typecheck
npm run build
npm run dev
```

`npm run dev` starts Vite on port 3000. `npm run preview` serves a production build locally.

## Verification scope

Before merging, run `npm run typecheck` and `npm run build`. Exercise playback from a browser gesture, trace import/export, tracker conversion, and (where supported) MIDI input. Test audio with more than one browser when changing the DSP or worklet paths.

## Security notes

Do not commit `.env.local`, imported music, ROM files, browser exports, or credentials. The project intentionally ships an empty `.env.example`; no API key is required by the current source tree.
