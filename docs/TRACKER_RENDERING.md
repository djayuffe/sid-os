# Tracker rendering and audit notes

The tracker is an editable transcription, not a lossless representation of an
arbitrary SID player. Unedited imports retain their original cycle-event stream.
Editing a project uses the tracker renderer; exporting the original source and
exporting the edited project are distinct operations.

## Notes and timing

Tracker octaves start at MIDI note 0 (`C-0`); MIDI 69 is `A-5` (440 Hz).
Preview, transcription and edited playback use this same convention. Frequencies
are converted using the selected SID clock and clamped to its 16-bit range.
`---` leaves the note alone; `===` releases its gate.

Patterns contain 64 rows and three voices. `frameSpeed` is the number of frames
per row (1–31); `frameRate` is the update frequency, defaulting to 50 Hz for legacy
projects. Frame cycles use absolute rational timing, rather than accumulating a
rounded interval. Retriggers write gate-off, configure registers, then gate-on
45 cycles later (shortened if necessary to stay inside the frame). This is not
a hardware-exact hard-restart envelope implementation.

## Implemented renderer commands

Values are hexadecimal bytes in the separate `val` column.

| Command | Rendering behavior |
| --- | --- |
| `0xy` | Persistent three-frame arpeggio using semitone offsets x/y; `000` clears it. |
| `1xx`, `2xx` | Slide up/down by twice xx SID frequency units each frame of this row, including rows without a new note. Blank rows stop these slides. |
| `3xx` | Glide an already-gated voice toward the new note; a first note still attacks normally. A zero parameter uses the legacy speed of 10. |
| `Cxx` | Shared SID volume, low four bits. |
| `Exx` | Voice pulse width: xx shifted left four bits. |
| `Fxx` | Shared cutoff: xx shifted left three bits. |
| `Rxx` | Full resonance/routing register byte. |
| `Txx` | Full mode/volume register byte, including voice-three-off. |
| `Wxx` | Waveform from the high nibble (e.g. `40` for pulse), preserving the voice's low control bits except gate. |

Selecting an instrument resets pulse width and the waveform override. Shared
register commands execute in channel order, so the last command for the same
register wins. Transcription includes initial filter state and volume-only
changes. If all effect columns are occupied, it retries the current filter state
on a later available row; it cannot preserve every intermediate change.

## Safety and editor behavior

Project loading checks instrument register ranges, duplicate IDs, cell shapes,
sequence IDs and loop bounds. Short patterns are padded without mutating the
input. Malformed values are rejected rather than coerced into silent registers.
Rendering is limited to 100,000 frames and requires at least one SID cycle per
frame; timestamps must remain safely representable integers. The application
logs render failures and prevents playback of stale data for an invalid edit.

Sequence insertion/deletion moves the loop index to retain its original target
when possible. Invalid editor indices and non-hexadecimal nibble input are ignored.
Concurrent audio initialization requests share one player. Engine changes and
unmount retire pending completions instead of publishing a stale audio engine.

## Remaining fidelity limits

The renderer is not a complete SWM engine. Vibrato inference (`4`), per-cell
volume, instrument modulation tables/hard-restart settings, funk tempo, other
extended commands and sequence loop metadata do not all have playback semantics.
It renders the first subtune once. Cutoff and pulse-width transcription discard
their low three/four bits; inferred notes/slides cannot preserve every raw
frequency write. Use the original trace for faithful imported timing and writes.

SWM export now reads the separate effect-value column. That fix does not certify
binary compatibility with every SWM player or establish that the above tracker
command semantics match every external editor.

Regression coverage: `tests/trackerRendering.test.ts`,
`tests/timingSession.test.ts`, and `tests/asyncResource.test.ts`.
Run `npm run test:midi`, `npm run test:audio`, `npm run typecheck` and
`npm run build`. Physical MIDI devices, real SID chips and all browser/audio
device combinations still require manual validation.
