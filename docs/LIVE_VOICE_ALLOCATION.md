# Live three-voice allocation

ArpSID uses `services/voiceAllocator.ts` to track individual note-on instances
separately from the three physical SID oscillators. The allocation policy is:

1. Reuse a free slot, preferring the least recently released slot.
2. If full, steal a note whose key was released but is held by sustain.
3. Otherwise steal the quietest held note (velocity), breaking ties by age.

Only the selected oscillator changes ownership. Other notes do not shift to
different oscillator patches. Stealing retains the old instance's note-off
bookkeeping, so a delayed note-off cannot release a newer instance of the same
pitch. Repeated note-ons are matched to note-offs in FIFO order per channel and
pitch. A stolen live note is not automatically reattacked when another slot
becomes free; play it again, or use the arpeggiator to cycle held keys.

Single-note unison is a rendering option: it drives all three oscillators from
one owned note, without occupying three allocator slots. A second note switches
to separate slots and closes the unused oscillator's gate. Releasing all notes
closes all three gates. Note identity changes cause gate-off before new pitch,
envelope and gate-on writes, including same-pitch retriggers.

Sustain is tracked per MIDI channel. Releasing the pedal releases only notes
whose keys were already lifted. CC123 (All Notes Off) honors sustain; CC120
(All Sound Off) also suppresses the affected oscillator tails. CC121 releases
pedal-held notes and resets the live modulation controls. Panic, focus loss,
and MIDI-input changes clear live key ownership to avoid stuck notes.

The MIDI channel-mode distinction follows the
[MIDI Association message summary](https://midi.org/summary-of-midi-1-0-messages).

## Limits and verification

A single SID has only three oscillators. Voice stealing is a reduction of the
performance, not lossless polyphony. ArpSID's patch, bend and modulation controls
remain global; it is not a 16-part General MIDI synthesizer. Its live register
updates run on browser animation frames, so sub-frame key presses and background
tab timing are not sample-accurate. File-conversion timing is a separate path.

`tests/voiceAllocator.test.ts` covers stable slots, deterministic dense input,
stolen-note identity, sustain, channel isolation, unison transitions and retiring
voices. MIDI-file conversion is audited separately; these live-allocator tests
do not certify the file converter or an integrated release.
