# SID-to-MIDI fidelity

Export MIDI defaults to **RAW TRACE**, **RAW timing**, and **9600 PPQ**. These
settings preserve the captured performance most closely. **EDITED PROJECT**
exports the tracker reconstruction and edits; it cannot restore information
already lost while turning a register trace into tracker rows.

## What is preserved

`services/midiExportService.ts` writes SMF type 1 with one independent MIDI
channel and track per selected SID voice. `services/midiService.ts` delegates
to that core, including explicitly packed multi-chip traces. The default
`JsonToMidiConverter.convert()` path uses the same core for structured SID dumps.

- Cycle writes take precedence over snapshots. The write stream starts from
  zeroed registers and must contain its initial register state.
- Same-cycle gate pulses remain ordered, including several off/on pulses at
  one cycle. Frequency bytes written at the same cycle are evaluated together.
- A falling gate closes the note at its source time. The final held note closes
  at the capture endpoint, including the final frame interval.
- Without writes, samples use the declared FPS or explicit timestamps. PAL and
  NTSC defaults are 50 and 60 Hz. The frame-only importer computes each cycle
  from its absolute frame index, avoiding accumulated rounding error.
- Frequency uses `register × clock / 2^24`, A4 = 440 Hz, and the actual clock
  supplied with the trace. Initial tuning is sent before the note-on.
- One uninterrupted tonal gate remains one MIDI note through wide slides and
  arpeggios. A prepass selects a sufficient pitch-bend range for that gate,
  declares it using RPN 0,0, and deselects the RPN. It does not invent attacks
  when the pitch passes another semitone or exceeds the usual ±2 range.
- Each note has a matching note-off. Pedal is initialized off and expression
  to full scale so prior receiver state cannot hold the exported notes.
- Noise, TEST, waveform-off and unfiltered voice-3-OFF states do not create
  pitched notes. MIDI velocity is 100 because the SID has no original velocity.
- Song and author text use UTF-8 bytes and correct variable-length meta lengths.

## Precision and the meaning of 1:1

MIDI note events cannot reproduce SID synthesis exactly. This is a faithful
conversion of available tonal gates and oscillator pitch, **not lossless SID
audio or recovery of the composer's original score**.

Raw time is rounded to the closest MIDI tick using the exact integer tempo
written in the file. At 120 BPM and 9600 PPQ, one tick is approximately 52.08 µs,
so each timestamp's rounding error is at most 26.04 µs. Gate pulses shorter
than a tick may become zero-tick notes: their event order is retained rather
than stretching them and shifting following notes. A receiver may not sound
such notes. Grid quantization and Smart intentionally change timing.

Pitch bends use 14 bits. The per-gate range is at least ±2 and at most ±127
semitones; its maximum rounding error is `range / 16384` semitones (about
0.0122 cents at ±2, or 0.775 cents at ±127). At extreme frequencies the base
MIDI note may be moved to fit the complete gate within that range. The audible
pitch follows the bends; a score editor displaying only base notes will not
show the SID arpeggio as separate score notes. Receivers must honor the RPN
range; some instruments impose smaller limits.

Noise, ring modulation, hard sync, combined-waveform behavior, pulse-width
modulation, filter characteristics, oscillator phase and SID ADSR envelopes
cannot be expressed exactly as ordinary MIDI note/CC data. Release envelopes
belong to the receiving instrument; they are not added to exported gate times.
Frame snapshots cannot recover register transitions between samples.

Keep the JSON/register trace for exact source data. Use WAV export for rendered
audio. A MIDI round trip through a different synthesizer is not bit-identical.

## Controller mapping

| Source register value | MIDI output | Interpretation |
| --- | --- | --- |
| `(FC_LO & 7) \| (FC_HI << 3)` | CC 74, 0–127 | Brightness approximation |
| Resonance nibble | CC 71, 0–127 | Resonance approximation |
| 12-bit pulse width | CC 70, 0–127 | Sound variation; receiver-specific PWM mapping |
| Master volume nibble | CC 7, 0–127 | Channel volume approximation |

These mappings retain parameter movement at MIDI resolution, not the SID's
filter topology or routing. Initial zeroes and subsequent changes are emitted.
See the [MIDI Association's message overview](https://midi.org/about-midi-part-3midi-messages)
and [Roland's pitch-bend/RPN implementation](https://static.roland.com/assets/media/pdf/RS-5_9_OM.pdf).

## Multiple SID chips and compatibility API

`generateMultiSidMidiFile(sources, options)` accepts one to five sources, each
with `trace`, optional `frameTimes` and optional `endTimeSeconds`. All sources
share the encoded BPM/PPQ, while each uses its own SID clock. Voices map to
channels 1–9 and 11–16, reserving General MIDI channel 10. Only the first track
contains tempo. A single `ParsedTrace` contains 25–32 register bytes per frame;
the compatibility packed exporter accepts complete 32-byte blocks for multiple
chips. Filter/readback bytes are never treated as additional voices.

Structured dumps prefer `writeLog` over frame snapshots and preserve its raw
CPU-cycle origin, including initialization. Without a log, explicit frame times
and `totalDuration` are used. Inconsistent chip counts or invalid timing fail
with an error instead of generating corrupt MIDI.

The structured converter still offers its older heuristic transcriber through
`{ mode: 'interpretive' }`: drum guessing, gap merging, envelope expression,
octave shifts, humanization and arpeggio-to-chord conversion. Those options
intentionally alter the performance and are not fidelity guarantees. Requesting
them in the default faithful mode reports an error. This opt-in path remains
experimental; use the default register conversion for predictable boundaries.

## Validation

```sh
npm run test:midi
npm run typecheck
npm run build
```

The regression suite independently decodes generated SMF bytes. It checks
chunk boundaries, VLQs, seven-bit channel data, tempo, final duration, initial
tuning, the full 16-bit frequency range, wide bends, repeated sub-frame gates,
malformed input, large exports, multi-chip channels, compatibility entry points
and rational NTSC import timing. Tests use the installed TypeScript compiler
and run on the project's supported Node.js versions without extra dependencies.
