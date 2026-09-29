# MIDI → SID: musical reduction and register mapping

The file importer converts Standard MIDI type 0/1 into a single three-voice SID
register trace. This is a deterministic arrangement and timbre approximation,
not lossless General MIDI playback. More MIDI notes do not create more physical
SID oscillators.

## Choosing a reduction

Open **Settings → MIDI → THREE SID VOICES** before importing a MIDI file.

- **Balanced** (default) protects the lowest bass and highest melody. The
  remaining slot favors a new pitch class, a different channel, continuity,
  physically held keys, then velocity. This is a pitch-boundary heuristic,
  not automatic harmonic analysis or a guarantee that the highest note is the
  intended melody.
- **Chord arpeggio** preserves those outer voices and cycles inner notes at
  12 steps/second. Only notes with the same MIDI channel and captured program
  share this arpeggio. It changes articulation, reattacks envelopes, and is
  fixed-rate rather than beat-synchronized.
- **Spare oscillators** enables bell ring modulation and lead hard sync only
  where a correctly connected oscillator is unused. Disable it to retain
  simpler standalone timbres. Effects yield to melodic polyphony and drums.

For example, a held C-major texture C2/C4/E4/G4/C6 initially becomes C2/E4/C6
in balanced mode. Arpeggio mode cycles C4/E4/G4 in the inner voice while retaining
C2 and C6. If C6 ends, G4 becomes the highest retained pitch. A displaced held
note can return when capacity becomes available; this is a fresh envelope
attack, not an uninterrupted hidden performance.

Note-on identities are independent of physical voices. Note-offs match source
instances in FIFO order per channel/pitch, including stolen notes. Sustain and
sostenuto retain those instances without letting an old note-off silence a
newer note of the same pitch. Program changes affect new notes; held notes keep
their captured patch.

### Percussion and release

Channel 10 uses SID voice 3 temporarily, leaving two voices for bass and melody.
Simultaneous hits are reduced by priority: kick, snare, clap/tom, cymbal, other
percussion, then hi-hat. Velocity breaks ties, followed by key and source order.
Only the chosen hit is counted as retained. This policy protects rhythmic
anchors but necessarily loses simultaneous kit detail; it is not a full drum kit.

Each hit gets a bounded gate/tail window (closed hats are shortest, crashes
longest). New hits retrigger the envelope, stale note-offs are matched to their
original hit, and zero-length or muted hits do not take a melodic slot.
Melodic release tails retain their filter routing until completion or voice
reuse. A new note may truncate a tail when all three oscillators are occupied.

## MIDI expression

| Input | Conversion |
| --- | --- |
| Note/velocity/program | Rounded SID pitch; GM-family waveform/PW/ADSR approximations; captured per-note patch |
| Pitch bend | Default ±2 semitones, adjustable by RPN 0 |
| RPN 0 / 1 / 2 | Bend sensitivity (semitones + cents), fine tuning, coarse tuning |
| CC 6/38/96/97 | Selected RPN data entry and increment/decrement; NRPN selection cancels RPN targeting |
| CC 1, channel/poly pressure | Vibrato, pulse-width movement where applicable; pressure also opens a routed filter |
| CC 7 / 11 / 67 | Volume, expression, soft pedal; zero gain removes waveform output immediately |
| CC 64 / 66 | Sustain and captured-note sostenuto |
| CC 71 / 74 | Shared filter resonance and brightness/cutoff |
| CC 72 / 73 / 75 | Release, attack and decay offsets, bounded to SID's 4-bit rates |
| CC 76 / 77 / 78 | Vibrato rate, depth and delay |
| CC 120 / 123 / 121 | Immediate channel silence / notes-off honoring melodic pedals / controller reset |

Reset Controllers preserves program, channel volume and registered tuning.
Fine tuning uses centered 14-bit data; bend endpoints use divisors 8192 below
center and 8191 above. Vibrato advances with **2π × Hz × elapsed seconds**,
not radians mistaken for cycles. The control stream updates at 200 Hz, with
note/controller events also processed at their rounded SID-cycle timestamps.

SID has no independent per-voice gain register. Velocity/expression scale
sustain; zero-sustain melodic plucks use a decay adjustment instead. Pulse
timbre also varies with strength. These do **not** reproduce MIDI velocity's
peak amplitude. Percussion uses the drum processor's envelope approximation;
many zero-sustain drums likewise do not have independent velocity-scaled peaks.

## Register coverage and hardware boundaries

| SID registers | Use |
| --- | --- |
| $D400–$D414 | All three voices' 16-bit frequency, 12-bit pulse width, waveform/gate, attack/decay and sustain/release |
| Voice control SYNC / RING | Optional hard-sync leads and triangle ring-modulated bells with a spare preceding oscillator |
| $D415/$D416 | Shared 11-bit filter cutoff |
| $D417 | Resonance and per-voice filter routing, including melodic release tails |
| $D418 | LP/BP/HP mode, master volume, and voice-3-off when voice 3 is an inaudible modulation source |
| TEST / EXT IN | Not synthesized from MIDI: TEST would reset oscillators; no external audio is supplied |
| $D419–$D41C | Read-only paddles/oscillator/envelope outputs; never written |
| $D41D–$D41F | Unused addresses; never written |

The SID has **one shared analog filter**. Routed notes contribute
strength-weighted cutoff/resonance requests; the strongest selects the filter
mode. This is an explicit compromise, not separate filters per MIDI channel.
LP, BP and HP presets are used; arbitrary combinations are not forced just to
exercise bits. Combined-waveform analog behavior is chip-dependent and is not
a substitute for extra oscillators.

Ring modulation requires a triangle target and a correctly connected source.
The source frequency is twice the target's. Hard sync uses a source at the
fundamental and a slave at twice it. Coupling is skipped if doubling would
overflow or the source is occupied. MIDI pan is not mapped to fictitious SID
stereo registers. SysEx, MPE, bank-specific GM sound banks, external-input audio,
sampled digidrums and a full 16-part GM synthesizer are outside this importer.

## Pitch, timing and bounds

Frequency conversion uses:

```text
Hz = 440 × 2^((MIDI note + tuning + bend + vibrato − 69) / 12)
SID frequency = round(Hz × 2^24 / SID clock)
```

Source notes above the 16-bit range are octave-folded down, retaining pitch
class, and reported. Extreme tuning/bend excursions are ultimately clipped to
1…65535. Register quantization is unavoidable, especially for very low pitches.
PAL/NTSC clock selection changes pitch-register values, not the musical tempo.

Tempo segments are integrated in floating-point seconds and rounded once at
each final SID-cycle boundary. Same-tick events preserve source order (track
order breaks cross-track ties). Zero-length note pairs do not invent sustained
notes. Snapshots reflect writes completed by that frame boundary; sub-frame
events remain in the event stream. Editing a generated tracker can quantize
those events to tracker rows; keep the original trace for cycle timing.

The importer rejects SMPTE timing, malformed/truncated messages, invalid tempo
lengths and zero tempos. It stops at each End of Track marker. Safety limits:
10 minutes of source-event timeline, approximately 500,000 stored input events,
4,096 simultaneous melodic instances or unmatched percussion note-ons, and
2,000,000 generated register writes. Open-ended notes are released one video
frame after the last source channel event; conservative SID release tails are
then drained. Conversion periodically yields to the browser event loop.

## Diagnostics and API

After import, **Logs** shows the reduction report; it is also available in
`trace.header.midiReduction`:

- `inputNotes`: all positive-velocity note-on instances.
- `soundedNotes`: instances allocated a gated SID output at least once.
- `omittedNotes`: instances never allocated, including zero-length or muted notes.
- `peakPolyphony`: peak eligible held melodic instances plus an occupied drum voice.
- `voiceSteals`: melodic replacements while the old source note remains held.
- `restoredNotes`: distinct previously sounded instances allocated again.
- `octaveFoldedNotes`: source note instances folded into the SID pitch range.
- `coupledUpdates`: processing updates that applied a spare-oscillator effect,
  **not** a count of audible notes or frames.

A retained count does not measure duration or fidelity: a briefly arpeggiated
note still counts once, and SID envelope attack may prevent a very short gated
note from becoming perceptually audible. The report is allocation telemetry,
not an acoustic loudness or musical-quality certificate.

```ts
import { compileMidiToSidTrace } from './services/midiSidService';

const trace = await compileMidiToSidTrace(await file.arrayBuffer(), {
  filename: file.name,
  clock: 985248,
  reduction: 'arpeggio',   // 'balanced' is the default
  arpeggioHz: 12,           // API accepts 1…50; UI uses 12
  coupledEffects: true,
});
console.log(trace.header.midiReduction);
```

The pure selector is `services/midiReductionService.ts`; compilation and
controller/register scheduling live in `services/midiSidService.ts`.
The live ArpSID keyboard allocator is separate from this file-import policy.

## Verification and references

Run `npm run typecheck`, `npm run test:midi`, `npm run test:audio`, and
`npm run build`. `tests/midiReduction.test.ts` exercises dense chords, restored
notes, FIFO/pedals, arpeggiation, controllers/tuning, coupled oscillators,
percussion collisions, malformed metadata and reconstruction of PAL/NTSC
snapshots from legal register writes. These automated checks do not establish
bit-exact analog hardware fidelity or subjective listening quality.

- [MIDI Association controller assignments](https://midi.org/midi-1-0-control-change-messages)
- [MOS 6581 SID datasheet reproduction](https://www.waitingforfriday.com/?p=661)
- [Commodore 64 Programmer's Reference Guide, appendices](https://www.commodore.ca/manuals/c64_programmers_reference/c64-programmers_reference_guide-07-appendices.pdf)
