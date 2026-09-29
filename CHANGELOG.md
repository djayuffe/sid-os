# Changelog

All notable changes to SID OS are documented here.

## Unreleased

### Added

- Musical MIDI-to-SID reduction with protected bass/melody, harmonic diversity, optional inner-voice arpeggiation, held-note restoration and per-import loss diagnostics.
- MIDI pressure, expression, sostenuto, filter/envelope controllers and registered tuning; optional spare-oscillator ring modulation/sync and shared LP/BP/HP filter arbitration.
- MIDI reduction settings, detailed conversion guide, and regression coverage for dense chords, drum collisions, pedals, tuning and PAL/NTSC register reconstruction.

### Fixed

- Avoided repeated sorting of unchanged dense MIDI note pools and quadratic arpeggio pitch deduplication; added exact pre-optimization trace fixtures for both reduction modes.
- Fixed percussion panic affecting melodic voice 3, same-cycle voice restoration after drum mute, active-drum expression, stale percussion key identities, release-tail mute and per-note pressure reset.
- Enforced MIDI file/event limits in the conversion API, including ignored metadata/SysEx; added controller regressions and MIDI-to-audio tests through both worklet engines.
- Corrected SID oscillator/ring/triangle math, envelope timing, voice-3 filter routing, stereo pan/solo, long seeks, reset isolation, and oversampled RMS metering.
- Replaced the no-op offline mastering fallback with the shared worklet DSP kernel; connected compressor/EQ/DC/output controls and corrected limiter delay, ceiling and reset.
- Fixed mono WAV encoding, offline frame duration, stereo export, final resampler lookahead and asynchronous error handling.
- Isolated tracker instrument audition from song transport and added worklet cleanup. Added generated-audio regression tests and an explicit audio fidelity guide.
- Unified SID-to-MIDI compatibility exporters; preserved wide slides as continuous bends, multiple same-cycle gate pulses, multi-chip channels and explicit capture timestamps. Default export uses raw trace/timing at 9600 PPQ; heuristic transcription is now opt-in.
- Removed cumulative NTSC frame-to-cycle rounding drift; preserved long UTF-8 MIDI metadata and initialized pedal/expression receiver state.
- SID-to-MIDI export now preserves cycle-event note-offs/retriggers, final held-note duration, declared frame rates, low notes, initial tuning bends, and controller zeroes. Corrected cutoff decoding, odd-PPQ quantization, large-file assembly, and tracker cutoff packing; added an independent SMF regression suite.
- Preserved authored MIDI event order at shared ticks, including zero-length note pairs; track order breaks cross-track ties.
- Reduced simultaneous percussion deterministically, corrected retained-hit reporting, bounded drum occupancy and rejected malformed tempo/end-of-track metadata.
- Added explicit gate-off writes when a SID voice is stolen, plus a bounded release tail for malformed/open-ended MIDI notes.
- Prevented tracker keyboard auto-repeat from inserting duplicate notes or gates and clamped tracker frame speed to a safe integer range.

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
