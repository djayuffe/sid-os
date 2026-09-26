# API and subsystem reference

This reference describes the reusable code surfaces in SID OS. It is an implementation map, not a promise of a stable external package API.

## Playback and trace utilities

`services/sidService.ts` is the main browser playback service.

- `CLOCK_PAL` and `CLOCK_NTSC` expose Commodore 64 clock rates; `SID_REG` names SID register offsets.
- `getNoteName`, `midiNoteToFreq`, and `generateWaveformPoints` translate frequency/register data for UI and export use.
- `analyzeArpeggio` and `detectVibrato` extract simple pitch-pattern information from frequency sequences.
- `parseTraceFile` validates and reads trace JSON; `getRegsAtCycle` reconstructs the SID register state at a target cycle.
- `SidPlayer` owns live playback, timing, register writes, and the selected audio engine.

## C64/SID helpers

`components/sid/` contains the hardware-oriented helper set.

- `parseSidHeader` reads PSID/RSID metadata and data offsets.
- `SidPlayer`, `C64System`, `Cpu6502`, `SidChip`, `Cia6526`, and `VicII` model the playback-oriented C64/SID path.
- `Disassembler` formats CPU instructions for inspection.
- `JsonToMidiConverter` and `TrackerExporter` translate captured SID state into MIDI and tracker-oriented forms.

## Project editing and tracker conversion

- `traceToTrackerProject` derives a `TrackerProject` from a trace.
- `validateProject` checks imported project shape; `renderProjectToTrace` turns a project back into a trace.
- `updateProjectInstrument`, `createNewInstrument`, and `deleteProjectInstrument` manage tracker instruments.
- `updatePatternCell`, `updatePatternCellHex`, `transposePattern`, and `clearPattern` edit pattern content.
- `updateOrderList`, `setSequenceLoopPoint`, `insertSequenceStep`, and `deleteSequenceStep` manage playback order.
- `createDefaultChord`, `createDefaultTempo`, table update helpers, and packers maintain SWM chord/tempo tables.

## Audio and export

- `OfflineSidRenderer` renders a trace without live playback.
- `MasteringChain` applies the mastering DSP signal path.
- `audioBufferToWav` and `createWavFile` create browser-downloadable WAV data.
- `generateMidiFile`, `generateSwmFile`, `exportTraceToJson`, and `exportProjectToJson` provide portable exports.
- `SidComposerService` composes SID-oriented output from tracker data.

## Instruments and input

- `DrSidService` validates and manages drum banks; `DrSid` executes drum synthesis/control state.
- `ArpPatchService` validates/migrates ArpSID patch data; `PRESETS` exposes factory patches and `CC_MAP` maps MIDI controllers.
- `DrumProcessor` and `GuitarProcessor` provide specialised conversion/analysis processing.
- `useKeyboardControls` and `useTrackerInput` bind desktop keyboard input to performance and tracker actions.

## Diagnostics

`SystemLogger` records timestamped debug, info, warning, and error entries. `getHistory`, `subscribe`, `clear`, and `downloadLogs` support the System Log UI and browser-downloadable diagnostic reports.
