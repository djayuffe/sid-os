# Audio, SID filter, and mastering audit

## Scope and status

This audit covers the standard and HIFI AudioWorklets, offline SID rendering,
shared mastering DSP, WAV encoding, filter readouts, and tracker instrument
audition. The regression suite executes the generated worklet source against a
minimal processor host and inspects actual floating-point output and WAV bytes.
It is not a transistor-level SID validation or a listening-test certificate.

## Signal paths

| Path | Synthesis and filtering | Final processing |
| --- | --- | --- |
| Standard | SID-cycle oscillators/envelopes, accumulated voice samples, 8x filter processing, independent L/R decimation | Shared mastering kernel |
| HIFI | SID-cycle oscillators/envelopes, 8x waveform/filter sampling, independent stereo DC removal | Shared mastering kernel |
| Offline WAV | SID-clock voice/filter processing, two filter states, Blackman-windowed sinc downsampling to 44.1 kHz | The same mastering kernel, then stereo 16-bit PCM |
| Instrument preview | A separate instance of the selected worklet; cycle-timed gate release | Current model/mastering/master-volume settings |

The shared implementation lives in `services/masteringKernel.js`. The offline
renderer imports its class directly. Vite's raw-source import supplies the same
implementation to both worklets without runtime `eval` or dependence on
minified function names. Do not reintroduce a no-op offline fallback.

## Corrections

- Frequency registers now increment the 24-bit oscillator accumulator directly,
  avoiding fractional-slew truncation that could detune a stationary note.
- Corrected the standard triangle fold and ring-modulation MSB combination.
  HIFI/offline noise uses eight LFSR output taps, without invented low bits.
- Corrected attack completion, exponential decay timing, lowering sustain while
  gated, and offline persistence of the exponential divider.
- Applied simultaneous hard-sync decisions from pre-reset oscillator edges.
- Corrected voice-3-off: it suppresses the bypass path, not voice 3 routed into
  the filter. The 11-bit cutoff display is `(D415 & 7) | (D416 << 3)`.
- Removed arbitrary signal injection into otherwise silent voices/filter input.
  Filter sweeps have finite-state safeguards; zero 8580 cutoff is no longer
  forced to an unrelated minimum coefficient.
- Both worklets explicitly output stereo. Each channel has separate state.
  Voice mute, solo selection, volume and pan apply in live and offline paths.
  Pan uses linear balance: center retains the original mono level in both ears.
  Stereo imaging and delay may subsequently redistribute that image.
- New traces reset oscillator, envelope, register, filter, meter and mastering
  state. Both engines support seek without signed-32-bit cycle wraparound.
  Paused seeks publish register state without advancing audio.
- Paused playback produces silence. Instrument previews use a separate worklet,
  resume the context after a user gesture, and never rewrite the song or start
  its transport. Retriggering/disposal cleans up the previous preview.
- RMS measurements divide by the actual oversampled measurement count.
- Offline WAV now runs the real mastering chain. EQ gain/tilt, linked compressor,
  optional DC blocking and output enable/zero gain are honored. Parameter
  snapshots are bounded and non-finite values receive safe defaults.
- The limiter now has a real approximately 5 ms lookahead delay and a linked
  sample-peak ceiling guard. Reset clears all effect memories, including delay,
  tape history, oversampling state, compressor and limiter buffers.
- WAV writing handles mono without reading channel 2; checks channel count,
  sample rate, stereo length and RIFF size; clips PCM and maps non-finite samples
  to zero. Mono-to-stereo duplication remains supported.

## Offline duration and boundaries

Events are validated, stably sorted and used as the authoritative register
stream. Frame-only traces are converted to timestamped register changes using
the declared FPS, or 50/60 FPS inferred from the clock. The source endpoint is
the later of the frame duration and one cycle after the last event.

At that endpoint, held gates are released and a fixed one-second release/effect
tail is rendered. The sinc lookahead is zero-padded so the generated WAV has its
full declared duration rather than silently losing its final samples. Very slow
SID releases or long feedback tails can exceed that fixed tail and be truncated.

Export is limited to 30 minutes including the tail, to bound browser allocation.
It runs in yielding chunks, reports progress, and rejects asynchronous failures
instead of leaving a pending promise. The live play/pause state does not change
the exported source. A missing initial volume write gets the same volume-15
default used by live trace playback.

## Verification

Run from the repository root:

```sh
npm run typecheck
npm run test:audio
npm run test:midi
npm run build
```

The audio checks cover generated STD/HIFI output, stereo identity and pan,
solo/mute routing, paused transport, long seeks, oscillator math, envelope
trajectories, voice-3 filter routing, filter sweeps, shared-kernel equality,
limiter delay/ceiling, reset isolation, mono/stereo PCM, complete export duration,
asynchronous rejection, initialization retry, preview isolation and disposal.

For a device-level check, load a known trace, press Play, check both channel
meters, test mute/solo/pan, compare STD/HIFI, preview an instrument while paused,
and compare a WAV export with playback at the same model and effect settings.
Speaker output and real-time CPU headroom must be checked on the target browser
and output device; synthetic tests cannot certify either.

## Explicit fidelity limits

- These are approximate 6581/8580 models, not reSID/reSIDfp or measured,
  revision-calibrated hardware models. Combined waveforms, TEST/noise details,
  analog cutoff/resonance, envelope edge cases and volume-DAC digis still need
  reference-hardware validation. Volume-only digi playback is not guaranteed.
- STD, HIFI and offline output are not sample-identical: filtering, smoothing,
  DC removal and resampling operate at different rates. Only the shared
  mastering implementation is identical for identical input samples/settings.
- Seeking reconstructs register writes at the target and resets dynamic state;
  it does not simulate the entire preceding oscillator/envelope/filter history.
- Stereo panning and duplicated filter paths are workstation extensions to a
  mono SID, not a hardware stereo-chip model.
- SID coloration and sub-bass weighting remain part of the mastering character.
  Disabling individual effects is not a bit-transparent bypass of that character.
- The control named reverb is a feedback stereo delay, not convolution or a
  physical room model. Legacy multiband metadata has no implemented processor.
- Limiting is sample-peak limiting, not certified inter-sample true-peak limiting.
- Physical temperature/power readouts are illustrative estimates.

These limits are deliberate disclosures, not claims of 100% hardware fidelity.
