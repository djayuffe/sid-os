# SID OS — Commodore 64 SID workstation

![Release](https://img.shields.io/github/v/release/djayuffe/sid-os?display_name=tag&sort=semver)
![License](https://img.shields.io/badge/license-GPL--3.0--only-blue)
![Runtime](https://img.shields.io/badge/runtime-browser%20%7C%20Node%2020%2B-0ea5e9)

SID OS is a browser-based Commodore 64 SID workstation. It turns SID-oriented
trace data and MIDI files into an interactive workspace for playback, register
inspection, visualisation, tracker conversion, sound design, rendering, and
export. It is designed for musicians, C64 developers, chiptune artists, sound
researchers, and anyone who wants register-level SID inspection without a
native emulator installation.

Everything runs locally in the browser. Imported data stays on the device unless the user deliberately exports or shares it.

## What it provides

- **Playback and inspection** — parse trace data, review SID register activity, and switch between standard and high-fidelity playback paths.
- **C64 visualisation** — inspect waveform, chip, logic, physical, register, and artwork views while working with a trace.
- **Tracker workflow** — convert trace data to patterns and instruments, edit sequences, and work in tracker or piano-roll views.
- **Sound design** — use the DrSID drum machine, ArpSID synthesizer, mastering controls, and optional MIDI input.
- **Export** — produce MIDI, JSON, SWM, SID-oriented data, and offline-rendered audio where the relevant source data is available.

The application has no account system, backend, API key, telemetry endpoint, or
required cloud service. Files are read locally by the browser and exports are
generated locally through the browser download API.

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

SID OS is intentionally client-side. Web Audio is required for playback, WebGL
is required for the 3D visualisers, and Web MIDI is optional. Chromium-based
desktop browsers provide the broadest Web MIDI support. Safari and Firefox can
still run trace, tracker, visualiser, and export workflows subject to their
Web Audio/WebGL support. Internet access may be used by the current UI shell
for Tailwind and Google Fonts resources; imported music and generated exports
remain local.

## Project layout

| Path | Responsibility |
| --- | --- |
| `App.tsx` | Desktop shell, file loading, playback lifecycle, and window orchestration |
| `components/` | UI panels, editors, visualisers, and synthesis interfaces |
| `components/sid/` | SID parsing plus C64/SID emulation helpers |
| `services/` | Playback, DSP, conversion, project editing, and export operations |
| `types.ts` | Shared TypeScript models |
| `docs/` | Architecture, development, and workflow documentation |

## Feature reference

### Desktop and window system

The desktop shell exposes independently focusable, draggable, resizable,
minimizable, maximizable, and fullscreen-capable windows. The taskbar groups
controls into Disk, Edit, Kernel, Link, and Host areas. Every launcher is
keyboard-focusable and has an accessible label.

| Workspace | Purpose |
| --- | --- |
| Tracker | Four-column SID pattern editor with note, instrument, volume, command, and hex editing. |
| Sequence | Order-list editing, insertion/deletion, loop-point selection, and frame seeking. |
| Piano Roll | Note-grid editing, zoom/scroll, playhead following, note preview, and instrument selection. |
| Instruments | ADSR, waveform, pulse-width, sync/ring, instrument creation, deletion, and auditioning. |
| Arp Synth | Arpeggiator/synth controls, factory patches, routing, keyboard input, CC mapping, and optional Web MIDI. |
| Dr.SID | Drum kits, per-voice synthesis, pattern sequencing, kit navigation, and MIDI-clock-aware controls. |
| Mastering | Per-voice volume/pan/mute, EQ, tape, compressor, exciter, chorus, reverb, imager, limiter, DC block, and output gain. |
| Hyper SID | High-fidelity shader/audio visualisation and engine diagnostics. |
| System / Logo | C64-inspired system and logo visualisation. |
| Chip Die | SID oscillator, envelope, filter-register, and silicon-state visualisation. |
| Physical SID | Physical-model visualisation driven by trace, model, and estimated cycle position. |
| SID Audit | Register/bus diagnostics and live health information. |
| Project | Tracker metadata and project-level details. |
| Format Docs | In-app reference for supported trace and project formats. |
| Artwork | Album-cover viewer, local cover import, scale/position, dithering, and wallpaper mode. |
| Logs | Filterable operational log, trace/SID views, pause, download, and clear controls. |

### Supported input and validation

- JSON trace documents containing register frames and optional cycle events.
- JSON Lines traces containing header, frame, and event records.
- PSID/RSID SID files through the browser C64/SID parser and playback path.
- Standard MIDI type 0 and type 1 files (`.mid`/`.midi`), including running
  status, tempo changes, program changes, sustain, pitch bend, modulation,
  overlapping notes, channel 10 drums, and bounded import duration.
- Saved tracker projects with validated instruments, patterns, subtunes,
  order lists, chord tables, tempo tables, and frame speed.

Malformed headers, unsupported SMPTE MIDI timing, invalid VLQs, out-of-range
register values, missing frames, invalid clocks, and oversized imports are
rejected with an in-app log entry rather than silently repaired.

### MIDI-to-SID voice and tone compiler

`services/midiSidService.ts` converts MIDI events into a deterministic SID
register trace. It maps MIDI notes to the selected PAL/NTSC SID clock, applies a
two-semitone pitch-bend range and channel modulation, allocates three SID voices
with reuse/stealing rules, handles sustain-pedal release, and uses FIFO matching
for overlapping same-note instances. GM program families select SID-appropriate
patches with waveform, pulse width, ADSR, vibrato, and filter parameters.
Filtered patches emit cutoff, resonance, routing, and low-pass mode writes at
the note boundary. Channel 10 is rendered through the dedicated drum processor
with kick, snare, hats, toms, claps, crashes, choke groups, velocity, and
release handling.

Frequency writes use the SID 16-bit phase-increment formula and are rounded
without 32-bit bitwise truncation. Frame snapshots are taken after same-cycle
note, pitch, drum, and filter updates, so visualisers and exports agree with the
audible register stream.

### Playback and trace analysis

`services/sidService.ts` supplies PAL/NTSC timing constants, SID register definitions, note/frequency conversion, waveform sampling, arpeggio and vibrato detection, trace parsing, register reconstruction, and the live `SidPlayer`. The C64-oriented path in `components/sid/` adds PSID/RSID header parsing, a 6502/6510 CPU model, CIA/VIC helpers, SID chip state, disassembly, and tracker/MIDI conversion helpers.

The audio path supports standard Web Audio and a high-fidelity AudioWorklet
engine. Playback resumes the browser AudioContext only after a user gesture,
supports PAL/NTSC switching, preserves playback speed, applies voice masks and
mixer settings, and exposes estimated cycle position to tracker and physical
visualisers. The offline renderer uses the same trace and mastering parameters
to produce a downloadable WAV without depending on live transport state.

### Editing, composition, and conversion

`services/trackerService.ts` converts traces into tracker projects. `services/editorService.ts` edits instruments, pattern cells, sequences, transpose operations, and clear operations without mutating the existing project. `services/projectLoaderService.ts` validates saved projects and renders project data back into a trace. `services/swmTableService.ts` maintains chord and tempo tables used by the SWM workflow.

### Instruments and performance controls

The **Dr.SID** workspace uses `DrSid` and `DrSidService` for drum banks, patterns, patch validation, and persistence. The **Arp Synth** workspace uses `ArpPatchService`, factory presets, cable/routing data, CC mapping, on-screen keyboard controls, and optional Web MIDI input. `inputService.ts` provides shared keyboard and tracker editing hooks.

### Audio, mastering, and export

`OfflineSidRenderer` renders audio off the live path. `MasteringChain` applies the mastering DSP configuration. `audioExportService.ts` produces WAV blobs; MIDI export is available through `midiExportService.ts` and `midiService.ts`; JSON and SWM exports are handled by their respective services. Export controls are enabled only when the loaded source/project provides the required data.

MIDI export validates BPM, PPQ, selected channels, and the four-byte MIDI VLQ
range. JSON and project exports preserve source metadata. SWM export is
available once a valid tracker project exists. WAV export reports failures
through the System Log instead of presenting a misleading partial download.

### Visual tools and diagnostics

The workspace includes standard waveform display, register/chip inspection, NMOS logic, physical chip, logo/artwork, CRT, and Hyper SID visual modes. `SystemLogger` powers the in-app System Log, including operational warnings and recoverable errors from the trace loader, audio setup, and window controls.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — module boundaries, data flow, and runtime responsibilities
- [Development](docs/DEVELOPMENT.md) — setup, validation commands, manual test matrix, and security guidance
- [Workflows](docs/WORKFLOWS.md) — trace, tracker, sound-design, and troubleshooting flows
- [API and subsystem reference](docs/API_REFERENCE.md) — exported functions, classes, and responsibilities
- [Release notes](RELEASE_NOTES_v1.1.0.md) — v1.1.0 feature summary and upgrade notes
- [Release checklist](RELEASE_CHECKLIST.md) — reproducible validation and publication steps

## Development checks

Run both commands before committing:

```sh
npm run typecheck
npm run build
```

In restricted environments, keep Vite's temporary and distribution files out
of the checkout:

```sh
npx vite build --configLoader runner --outDir /tmp/sid-os-dist
```

The production build currently produces one large application chunk because the workstation loads its visual and audio tools together. It is valid for release; future performance work can split optional visualisers into lazy-loaded modules.

## Release information

The current stable release is [`v1.1.0`](https://github.com/djayuffe/sid-os/releases/tag/v1.1.0). See [CHANGELOG.md](CHANGELOG.md) for the release record, [NOTICE.md](NOTICE.md) for copyright and licensing notices, and [metadata.json](metadata.json) for machine-readable project and capability metadata.

## Repository hygiene

Credentials, local environments, dependencies, build output, coverage, and local exports are ignored. Historical DrSID patch material is preserved in `components/drsid_machine_patch/` as reference only; `components/DrSidMachine.tsx` is the live component.

## License

Copyright (C) 2026 Ulf Bertilsson.

SID OS is licensed under the [GNU General Public License v3.0 only](LICENSE). You may copy, modify, and redistribute the project under the GPL-3.0 terms; redistributed derivatives must remain available under the same license. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for the complete terms and project notice.
