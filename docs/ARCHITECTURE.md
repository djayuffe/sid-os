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

## Data and privacy

SID OS processes imported files in the browser. The application has no built-in telemetry or server-side upload path. Browser and device support varies for Web Audio, Web MIDI, WebGL, and file download APIs.

## Archived patch material

`components/drsid_machine_patch/` is retained as source-history reference material for the DrSID machine. It is deliberately excluded from TypeScript compilation and is not imported by the application. The canonical runtime component is `components/DrSidMachine.tsx`.
