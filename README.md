# SID OS

SID OS is a browser-based Commodore 64 SID workstation. It turns SID-oriented trace data into an interactive workspace for playback, register inspection, visualisation, tracker conversion, sound design, rendering, and export.

Everything runs locally in the browser. Imported data stays on the device unless the user deliberately exports or shares it.

## What it provides

- **Playback and inspection** — parse trace data, review SID register activity, and switch between standard and high-fidelity playback paths.
- **C64 visualisation** — inspect waveform, chip, logic, physical, register, and artwork views while working with a trace.
- **Tracker workflow** — convert trace data to patterns and instruments, edit sequences, and work in tracker or piano-roll views.
- **Sound design** — use the DrSID drum machine, ArpSID synthesizer, mastering controls, and optional MIDI input.
- **Export** — produce MIDI, JSON, SWM, SID-oriented data, and offline-rendered audio where the relevant source data is available.

## Quick start

```sh
npm install
npm run typecheck
npm run build
npm run dev
```

Open the address reported by Vite (normally `http://localhost:3000`). Load a supported trace through **LOAD**, then start audio from the UI; browsers require that interaction before they allow an audio context to run.

## Requirements and browser support

- Node.js 20+ and npm 10+ for local development
- A current desktop browser with Web Audio for playback
- WebGL for the 3D visualisers
- Web MIDI only when the browser and connected hardware support it

SID OS is intentionally client-side. It has no required server, account, API key, or telemetry path. Internet access may still be used by the browser for the Tailwind and Google Fonts resources referenced by the current UI shell.

## Project layout

| Path | Responsibility |
| --- | --- |
| `App.tsx` | Desktop shell, file loading, playback lifecycle, and window orchestration |
| `components/` | UI panels, editors, visualisers, and synthesis interfaces |
| `components/sid/` | SID parsing plus C64/SID emulation helpers |
| `services/` | Playback, DSP, conversion, project editing, and export operations |
| `types.ts` | Shared TypeScript models |
| `docs/` | Architecture, development, and workflow documentation |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — module boundaries, data flow, and runtime responsibilities
- [Development](docs/DEVELOPMENT.md) — setup, validation commands, manual test matrix, and security guidance

## Development checks

Run both commands before committing:

```sh
npm run typecheck
npm run build
```

The production build currently produces one large application chunk because the workstation loads its visual and audio tools together. It is valid for release; future performance work can split optional visualisers into lazy-loaded modules.

## Repository hygiene

Credentials, local environments, dependencies, build output, coverage, and local exports are ignored. Historical DrSID patch material is preserved in `components/drsid_machine_patch/` as reference only; `components/DrSidMachine.tsx` is the live component.

## License

No license was supplied with the original source archive. Treat the code and included assets as all-rights-reserved unless the project owner adds a license.
