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

## Manual release checklist

- Load a representative trace and confirm that the System Log reports no unexpected errors.
- Start and stop playback after a browser interaction.
- Open Tracker, Piano Roll, Dr.SID, Arp Synth, Mastering, and at least one visualiser.
- Confirm one enabled export path produces a browser download.
- Verify a production build with `npm run build`.

The build currently emits an advisory for a large JavaScript chunk. Treat it as a performance follow-up, not a build failure; do not suppress the warning without measuring a replacement loading strategy.

## Security notes

Do not commit `.env.local`, imported music, ROM files, browser exports, or credentials. The project intentionally ships an empty `.env.example`; no API key is required by the current source tree.

The UI shell currently retrieves Tailwind and a font from public CDNs. Development and offline deployments should account for that network dependency or bundle approved local equivalents.
