# Architecture

SID OS is a client-side React application built with Vite. It does not require a server for normal use.

## Main areas

- `App.tsx` owns the desktop-style window layout, playback lifecycle, loaded trace state, and export actions.
- `components/` contains the user interface, C64/SID visualizers, tracker editors, and the DrSID drum machine.
- `components/sid/` provides a C64-oriented SID parser and CPU/SID emulation helpers.
- `services/` contains the primary trace parser/player, MIDI and JSON exporters, tracker conversion, mastering DSP, and offline rendering.
- `types.ts` is the shared model for traces, tracker projects, mixer state, and SID metadata.

## Audio path

The application initializes a Web Audio `AudioContext` from a user interaction, then selects the requested SID playback engine. Trace data can be rendered live, inspected through visualizers, converted to tracker structures, or exported to MIDI/JSON/SWM-compatible data.

## Runtime flow

1. The app shell loads a user-selected trace and validates its top-level structure.
2. `services/sidService.ts` prepares playback data and exposes register-oriented helpers to the UI.
3. Visualisers consume the player and trace state without owning file or audio lifecycle state.
4. Tracker and export services derive portable project representations from the trace.
5. `SystemLogger` records recoverable operational errors for the in-app log window.

This separation keeps file I/O, audio processing, rendering, and export logic independently testable and prevents visual components from becoming a second source of truth for playback state.

## Error handling

Recoverable user-facing failures are routed through `services/Logger.ts`, which backs the System Log window. The UI should prefer this logger over browser-console output so errors remain visible to users and can be exported for diagnosis.

## Data and privacy

SID OS processes imported files in the browser. The application has no built-in telemetry or server-side upload path. Browser and device support varies for Web Audio, Web MIDI, WebGL, and file download APIs.

## Archived patch material

`components/drsid_machine_patch/` is retained as source-history reference material for the DrSID machine. It is deliberately excluded from TypeScript compilation and is not imported by the application. The canonical runtime component is `components/DrSidMachine.tsx`.
