# DrSidMachine.tsx — Patch Notes (Improved)

This ZIP contains a **patched** `DrSidMachine.tsx` with fixes + feature upgrades.

## Fixed / hardened

- **RAF loop stability**: the main audio/render loop no longer re-mounts every step (the old code had `currentStep` in the effect deps, causing frequent teardown/restart).
- **True immutable pattern updates**: avoids mutating nested arrays (prevents stale renders and hard-to-debug state bleed).
- **Safe patch defaults**: `filter` object is always present when editing (no `patch.filter!` crash risk).
- **LocalStorage correctness**: loading a kit now persists the **loaded** values (previously saved some stale closures).
- **SID register write optimization**: only writes changed SID registers (big CPU win when idle).
- **Tailwind-safe color classes**: replaced dynamic `bg-${color}-500` style strings with a fixed map (avoids missing CSS in production builds).

## Added features

- **Clipboard tools**:
  - Copy current bank pattern as JSON
  - Paste/merge from JSON (clipboard or file)
- **Pattern utilities**:
  - Shift pattern left/right
  - Clear current bank
  - Clear per-track
  - Randomize per-track (density)
- **Undo/Redo** for pattern edits (Ctrl/Cmd+Z / Ctrl/Cmd+Y)
- **WebMIDI sync mode** (optional):
  - MIDI clock (0xF8), Start (0xFA), Continue (0xFB), Stop (0xFC)
  - 24 PPQN → 16th-note stepping (6 clocks/step)
  - Optional tempo-follow display
  - Note-on drum triggering (GM-ish mapping)
- **Master volume control** (SID volume nibble) + mute-all toggle
- **Better step painting** (drag-paint sets consistent value, doesn’t “toggle-flip” each cell)

## Known constraints

- MIDI support depends on the browser (Chromium-based browsers generally work best).
- This patch only modifies the **React component**. If your `DrSidService` supports more advanced per-step velocity/accent, those can be wired later.
