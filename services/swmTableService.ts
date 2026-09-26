
import { TrackerProject, SwmChord, SwmTempo } from '../types';

export const createDefaultChord = (id: number): SwmChord => {
    return {
        id,
        steps: [0, 4, 7] // Major triad default
    };
};

export const createDefaultTempo = (id: number): SwmTempo => {
    return {
        id,
        values: [6] // Standard 1x speed 50Hz
    };
};

export const formatChordString = (chord: SwmChord): string => {
    return chord.steps.map(s => {
        const sign = s >= 0 ? '+' : '-';
        return `${sign}${Math.abs(s).toString(16).toUpperCase()}`;
    }).join(',');
};

export const formatTempoString = (tempo: SwmTempo): string => {
    return tempo.values.map(v => v.toString(16).toUpperCase()).join(',');
};

// SWM Spec helpers for Table binary packing
export const packChordTable = (chords: SwmChord[]): number[] => {
    const bytes: number[] = [];
    chords.forEach(c => {
        // SWM Chords: Relative semitones. 00-7F positive, 80-FF negative (2's comp? Spec says E0..FF for negative usually)
        // Spec: positive $00..$7E, negative $E0..$FF
        c.steps.forEach(s => {
            let val = s;
            if (s < 0) val = 256 + s;
            bytes.push(val & 0xFF);
        });
        bytes.push(0x7E); // Delimiter
    });
    return bytes;
};

export const packTempoTable = (tempos: SwmTempo[]): number[] => {
    const bytes: number[] = [];
    tempos.forEach(t => {
        t.values.forEach((v, i) => {
            if (i === t.values.length - 1) bytes.push(v | 0x80); // Last byte has bit 7 set
            else bytes.push(v & 0x7F);
        });
    });
    return bytes;
};

// --- Mutation Helpers ---

export const updateFrameSpeed = (project: TrackerProject, speed: number): TrackerProject => {
    // SWM Speed range 1-7 usually, though spec says up to $1F
    const safeSpeed = Math.max(1, Math.min(31, speed));
    return { ...project, frameSpeed: safeSpeed };
};

export const updateFunkTempo = (project: TrackerProject, val: number): TrackerProject => {
    const next = { ...project, subtunes: [...project.subtunes] };
    if (next.subtunes[0]) {
        next.subtunes[0] = { ...next.subtunes[0], funkTempo: val & 0xFF };
    }
    return next;
};

export const addChord = (project: TrackerProject): TrackerProject => {
    const next = { ...project, chordTable: [...(project.chordTable || [])] };
    if (next.chordTable.length >= 64) return project; // SWM limit
    const id = next.chordTable.length;
    next.chordTable.push(createDefaultChord(id));
    return next;
};

export const updateChord = (project: TrackerProject, index: number, stepsStr: string): TrackerProject => {
    const next = { ...project, chordTable: [...(project.chordTable || [])] };
    if (!next.chordTable[index]) return project;

    // Parse string "0, 4, 7" or "+0, +4, -2"
    const steps: number[] = [];
    const parts = stepsStr.split(/[,\s]+/);
    for (const p of parts) {
        if (!p) continue;
        let val = parseInt(p, 16);
        // Handle explicit +/- if user typed decimal or hex without 0x
        if (p.startsWith('-')) val = -parseInt(p.substring(1), 16);
        else if (p.startsWith('+')) val = parseInt(p.substring(1), 16);
        
        if (!isNaN(val)) steps.push(val);
    }
    
    if (steps.length > 32) steps.length = 32; // SWM limit per chord
    next.chordTable[index] = { ...next.chordTable[index], steps };
    return next;
};

export const deleteChord = (project: TrackerProject, index: number): TrackerProject => {
    const next = { ...project, chordTable: [...(project.chordTable || [])] };
    next.chordTable.splice(index, 1);
    // Re-index remaining? IDs are usually index based in SWM
    next.chordTable = next.chordTable.map((c, i) => ({ ...c, id: i }));
    return next;
};

export const addTempo = (project: TrackerProject): TrackerProject => {
    const next = { ...project, tempoTable: [...(project.tempoTable || [])] };
    if (next.tempoTable.length >= 64) return project;
    const id = next.tempoTable.length;
    next.tempoTable.push(createDefaultTempo(id));
    return next;
};

export const updateTempo = (project: TrackerProject, index: number, valsStr: string): TrackerProject => {
    const next = { ...project, tempoTable: [...(project.tempoTable || [])] };
    if (!next.tempoTable[index]) return project;

    const values: number[] = [];
    const parts = valsStr.split(/[,\s]+/);
    for (const p of parts) {
        if (!p) continue;
        const val = parseInt(p, 16);
        if (!isNaN(val)) values.push(val & 0xFF);
    }
    
    if (values.length > 32) values.length = 32;
    next.tempoTable[index] = { ...next.tempoTable[index], values };
    return next;
};

export const deleteTempo = (project: TrackerProject, index: number): TrackerProject => {
    const next = { ...project, tempoTable: [...(project.tempoTable || [])] };
    next.tempoTable.splice(index, 1);
    next.tempoTable = next.tempoTable.map((t, i) => ({ ...t, id: i }));
    return next;
};
