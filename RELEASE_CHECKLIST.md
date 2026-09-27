# SID OS release checklist

## Metadata

- [ ] `package.json`, `metadata.json`, README, and release notes use the same version.
- [ ] `LICENSE` is the complete unmodified GPL-3.0 text.
- [ ] `NOTICE.md` names Copyright (C) 2026 Ulf Bertilsson.
- [ ] No credentials, private media, or generated output are tracked.

## Validation

```sh
npm install
npm run typecheck
npm run build
npx vite build --configLoader runner --outDir /tmp/sid-os-release-dist
```

For MIDI changes, verify at minimum: PAL and NTSC pitch, program changes,
velocity, sustain, overlapping notes, pitch bend, modulation, channel 10 drums,
filtered patches, malformed MIDI rejection, MIDI export VLQs, and WAV export.

## Publication

1. Commit the version, changelog, README, metadata, and release notes.
2. Create the annotated tag `vX.Y.Z`.
3. Push the branch and tag.
4. Create the GitHub release from the matching tag.
5. Confirm the repository visibility and release asset links.
