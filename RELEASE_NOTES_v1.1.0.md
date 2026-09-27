# SID OS v1.1.0

**Release date:** 2026-09-27  
**Release channel:** stable  
**License:** GPL-3.0-only  
**Copyright:** Copyright (C) 2026 Ulf Bertilsson

SID OS v1.1.0 is the full feature release after the v1.0.0 workstation
baseline. It documents and hardens the complete browser workspace, tracker
editing path, audio transport, and MIDI-to-SID compiler.

## Highlights

- Complete desktop window system with focus, drag, resize, minimize, maximize,
  fullscreen, accessibility labels, taskbar controls, and in-app diagnostics.
- Trace, JSONL, PSID/RSID, MIDI type 0/1, and tracker-project workflows.
- Three-voice SID allocation with pitch bend, modulation, sustain, overlapping
  note matching, velocity-scaled envelopes, GM-derived patches, pulse width,
  vibrato, filter cutoff/resonance/routing, and channel 10 drum synthesis.
- PAL/NTSC clock-aware pitch conversion and post-update frame snapshots.
- Tracker, sequence, piano-roll, instrument, project, and pattern-tool editing
  synchronized with playback and export data.
- Standard and high-fidelity Web Audio engines, offline WAV rendering, mixer,
  mastering, CRT, waveform, chip, logic, physical, artwork, and Hyper SID views.
- MIDI, JSON, SWM, SID-oriented, and WAV export with input validation and safe
  error reporting.

## Verification

```sh
npm install
npm run typecheck
npm run build
npx vite build --configLoader runner --outDir /tmp/sid-os-dist
```

The release build transforms 1,659 modules. A direct MIDI smoke check confirms
that PAL A4 renders to SID frequency register `7493`.

## Upgrade notes

The public browser API remains source-oriented rather than semver-stable. If an
application imports internal services, review [docs/API_REFERENCE.md](docs/API_REFERENCE.md)
and the new MIDI validation behavior before upgrading. Invalid inputs now fail
early and are reported through `SystemLogger`.

## License

SID OS is distributed under the GNU General Public License, version 3 only.
See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for the complete license and
copyright notice.
