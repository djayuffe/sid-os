# Workflows

## Trace-to-tracker workflow

1. Start SID OS and use **LOAD** to choose a supported trace file.
2. Review playback and register activity in the visualiser or log windows.
3. Convert the trace into a tracker project from the application controls.
4. Edit patterns, instruments, sequence data, and timing in Tracker or Piano Roll.
5. Export the resulting data as MIDI, JSON, or SWM when those actions are enabled.

## Sound-design workflow

1. Open **Dr.SID** or **Arp Synth** from the desktop or top menu.
2. Select a preset, then adjust voices, envelopes, routing, and sequencing.
3. Use Web MIDI only after connecting a supported device and granting browser access.
4. Apply mastering controls after the source playback is stable.

## Troubleshooting

- **No sound:** Interact with the app first, then retry playback. Browsers block audio until a gesture resumes the audio context.
- **3D view is unavailable:** Confirm hardware WebGL support and try another current desktop browser.
- **MIDI does not appear:** Check device permissions and browser Web MIDI support; Safari support differs from Chromium-based browsers.
- **A trace does not load:** Verify it contains the expected trace structure. Invalid input is rejected and recorded in the in-app System Log.

## Data handling

Files are read and processed in the browser. Exports are generated through the browser download mechanism. Keep confidential or licensed music assets outside version control unless redistribution is authorised.
