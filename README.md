# SID OS

SID OS is a browser-based Commodore 64 SID workstation. It imports and inspects SID-oriented trace data, plays and visualizes register activity, converts traces into tracker material, and provides export and sound-design tools in a desktop-style interface.

## Features

- SID trace parsing and playback with selectable synthesis paths
- C64/SID register, chip, logic, physical, and waveform visualizations
- Tracker views, pattern editing, instrument editing, and project conversion
- MIDI, JSON, SWM, and SID-oriented export workflows
- DrSID drum machine and ArpSID patch/synthesis tools
- Offline rendering and mastering controls
- Optional Web MIDI input where the browser supports it

## Quick start

```sh
npm install
npm run typecheck
npm run build
npm run dev
```

Open the local address reported by Vite (normally `http://localhost:3000`). Start audio from the app UI so the browser can grant the required Web Audio gesture.

## Supported environment

Node.js 20+ is required for development. The project is a client-side application: a modern browser with Web Audio is required, while Web MIDI and WebGL features depend on the browser and hardware.

No API key or server configuration is required by the current source. Keep any local credentials in `.env.local`; Git ignores that file. See [.env.example](.env.example).

## Project map

| Path | Purpose |
| --- | --- |
| `App.tsx` | Application shell, window management, playback orchestration |
| `components/` | UI, editors, visualizers, and synthesis panels |
| `components/sid/` | C64/SID parser and emulation helpers |
| `services/` | Playback, DSP, conversion, persistence, and exports |
| `types.ts` | Shared TypeScript data models |
| `docs/` | Architecture and development notes |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development and verification](docs/DEVELOPMENT.md)

## Repository hygiene

The source tree excludes credentials, dependency folders, build output, coverage, and local environment files. Historical DrSID patch material is kept for reference but excluded from compilation; the live component is `components/DrSidMachine.tsx`.

## License

No license was supplied with the source archive. Treat the code and included assets as all-rights-reserved unless the project owner adds a license.
