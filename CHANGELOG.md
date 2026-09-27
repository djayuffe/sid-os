# Changelog

All notable changes to SID OS are documented here.

## Unreleased

## [1.1.0] — 2026-09-27

### Added

- Project distribution notice identifying Ulf Bertilsson as the copyright holder and GPL-3.0-only as the license.
- Safe MIDI-to-SID filter-preset routing, captured per-note program state, and explicit parser timing bounds.

### Changed

- Corrected MIDI-to-SID pitch conversion to use rounded SID frequency-register values at the trace's selected clock.
- Preserved overlapping same-note MIDI instances and released them in FIFO order, including sustain-pedal handling.
- Mapped MIDI velocity to a usable SID envelope sustain range and retained full velocity for percussion.
- Prevented stale channel-10 note-offs from cutting newer drum hits.
- Made MIDI export use the trace's actual PAL/NTSC-compatible SID clock and reject invalid four-byte VLQ times.
- Corrected global SID filter lifecycle so routing, resonance, cutoff, and master volume clear when filtered voices finish.
- Added GNU GPL-3.0-only licensing and copyright attribution for Ulf Bertilsson.

### Validation

- Focused MIDI import, overlap, velocity, tuning, drum, program/filter, malformed-SMF, export-validation, and round-trip checks pass.
- TypeScript type-check and Vite production build pass.

## [1.0.0] — 2026-09-26

### Added

- Browser-based SID trace playback, visualisation, tracker conversion, synthesis, and export workspace.
- C64/SID inspection tools, including register, waveform, chip, logic, physical, and artwork views.
- DrSID drum-machine and ArpSID synthesis workspaces with optional Web MIDI support.
- MIDI, JSON, SWM, SID-oriented, and offline audio export paths where source data supports them.
- Architecture, workflow, development, and API/subsystem documentation.

### Changed

- Hardened project metadata, ignored local credentials, and removed unused duplicate/incomplete source files.
- Routed recoverable loading, audio, and window errors into the in-app System Log.

### Validation

- TypeScript type-check passes.
- Vite production build passes.

[1.0.0]: https://github.com/djayuffe/sid-os/releases/tag/v1.0.0
[1.1.0]: https://github.com/djayuffe/sid-os/releases/tag/v1.1.0
