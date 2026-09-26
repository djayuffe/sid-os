# Changelog

All notable changes to SID OS are documented here.

## Unreleased

### Changed

- Added GNU GPL-3.0-only licensing and copyright attribution for Ulf Bertilsson.

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
