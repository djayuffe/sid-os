// Copyright (c) 2026 Ulf Bertilsson. SPDX-License-Identifier: GPL-3.0-only
export type MidiReductionMode = 'balanced' | 'arpeggio';
export interface ReductionNote {
    id: number;
    channel: number;
    key: number;
    velocity: number;
    start: number;
    down: boolean;
    program: number;
}

/** A deterministic musical reduction, not a lossless transcription. */
export function selectSidNotes<T extends ReductionNote>(
    notes: readonly T[], capacity: number, sounding: ReadonlySet<number>,
    mode: MidiReductionMode, arpStep: number,
): T[] {
    if (capacity <= 0 || !notes.length) return [];
    const ordered = [...notes].sort((a, b) => a.key - b.key || b.velocity - a.velocity || a.channel - b.channel || a.id - b.id);
    if (ordered.length <= capacity) return ordered;
    const chosen: T[] = [];
    // Protect the bass and melody boundaries before filling harmonic detail.
    chosen.push(ordered[0]);
    if (capacity > 1) {
        const topKey = ordered[ordered.length - 1].key;
        chosen.push(ordered.find(n => n.key === topKey && n.id !== chosen[0].id) ?? ordered[ordered.length - 1]);
    }
    while (chosen.length < capacity) {
        const remaining = ordered.filter(n => !chosen.some(c => c.id === n.id));
        const score = (n: T) =>
            (chosen.some(c => c.key % 12 === n.key % 12) ? 0 : 100) +
            (chosen.some(c => c.channel === n.channel) ? 0 : 24) +
            (sounding.has(n.id) ? 20 : 0) + (n.down ? 8 : 0) + n.velocity / 8;
        remaining.sort((a, b) => score(b) - score(a) || a.key - b.key || a.channel - b.channel || a.id - b.id);
        let pick = remaining[0];
        if (mode === 'arpeggio') {
            // Time-share only one compatible instrument/channel, never unrelated timbres.
            const chord = remaining.filter(n => n.channel === pick.channel && n.program === pick.program)
                .filter((n, i, group) => group.findIndex(c => c.key === n.key) === i)
                .sort((a, b) => a.key - b.key || a.id - b.id);
            pick = chord[arpStep % chord.length];
        }
        chosen.push(pick);
    }
    return chosen;
}
