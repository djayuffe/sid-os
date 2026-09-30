# SID Station Pro integration

SID OS reviewed [SID Station Pro](https://github.com/djayuffe/sid-station-pro)
at commit `e5896a123f0b011102da01efbb5bb12f3dfef9fa`.
That snapshot supplies no license. No upstream implementation was copied:
the compatible behaviors below are independently implemented in SID OS,
whose GPL-3.0-only license remains unchanged.

## Integrated behaviors

- Both engines accept register offsets `0..31` or memory-mapped addresses
  `$D400..$D41F`. Invalid addresses and non-integer bytes are rejected rather
  than wrapped. Live writes reject read-only registers starting at offset 25.
- Trace ingestion validates and copies events, preserves same-cycle order,
  and sorts by cycle without modifying the caller's array. Long timestamps
  remain supported; the replay limit does not truncate trace events.
- Shared control helpers normalize speed, three-voice masks and mixer values.
  Invalid worklet messages report a control error instead of escaping the
  message handler. Invalid trace data is checked before replacing state.
- `setSpeed()` aliases `setPlaybackSpeed()`; `getRegister()` accepts either
  address form and returns the latest received register snapshot.
- OSC3 and ENV3 are derived from current digital voice state, including
  paused seeks. A voice without a selected waveform reports OSC3 as zero.

The implementation lives in `services/sidControlKernel.js`, injected into
both worklets through `services/sidPlaybackControls.ts`. This keeps public
API and worklet validation consistent without relying on minified function
serialization. Engine-specific DSP remains in the existing services.

## Replay seeking

The default `player.seek(cycle)` remains a fast register-restoration seek.
Use `player.seek(cycle, { mode: 'replay' })` to rebuild oscillator phase,
envelope and noise state from cycle zero with the engine's cycle logic.
Events at the requested cycle are included. The returned promise means
the request has been sent, **not** that replay has completed.

Replay processes at most 4,096 SID cycles per audio quantum and permits
targets from zero through 10,000,000 cycles. Regular seeks retain their
larger safe-integer range. Replay produces silence while working; playback
then resumes only if the transport was playing. A suspended audio context
is resumed so replay can advance even with the transport paused.

In **SID Audit**, enter a cycle and select **Replay state**. The progress
indicator follows `volatileSeekTarget` and the current cycle. Canceling
switches to a fast seek at the current position. New data or a new seek
also supersedes an in-progress replay.

Replay reconstructs **digital voice state only**. Filter, DC-removal,
mastering and resampling histories restart; it is not sample-identical
reconstruction of audio from the beginning. Real-time scheduling and
hardware analog behavior are not guaranteed by these tests.

## Retained SID OS behavior

SID OS already provides fixed-point cycle scheduling, PAL/NTSC clocks,
stereo pan/solo, shared filtering, and a richer mastering/offline pipeline.
These remain in place. Upstream's global timestamp clamp and synchronous
cycle-by-cycle seek were not adopted: they would truncate long traces or
block the audio thread. Its alternate cutoff packing, zero-frequency,
noise-output and envelope behavior were also not substituted for SID OS's
existing tested register and timing rules. No separate drive-only mastering
chain was introduced.

## Verification

Run `npm run typecheck`, `npm run test:midi`, `npm run test:audio`, and
`npm run build`. Control tests cover strict addresses/bytes, copied stable
events, defaults and seek bounds. Both audio engines are tested for malformed
messages, chunk limits, silent replay, inclusive target events, cancellation,
long normal seeks, and phase/envelope/noise agreement with live stepping.
Automated DSP checks do not replace listening tests or browser/device QA.
