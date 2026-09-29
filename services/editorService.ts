
import { TrackerProject, TrackerInstrument, TrackerRow } from '../types';

export const updateProjectInstrument = (project: TrackerProject, instId: number, changes: Partial<TrackerInstrument>): TrackerProject => {
    const next = { ...project, instruments: [...project.instruments] };
    const idx = next.instruments.findIndex(i => i.id === instId);
    if (idx !== -1) {
        next.instruments[idx] = { ...next.instruments[idx], ...changes };
    }
    return next;
};

export const createNewInstrument = (project: TrackerProject): TrackerProject => {
    const next = { ...project, instruments: [...project.instruments] };
    const newId = next.instruments.length > 0 ? Math.max(...next.instruments.map(i => i.id)) + 1 : 1;
    if (newId > 63) return project;
    const newInst: TrackerInstrument = {
        id: newId,
        name: `INST ${newId.toString(16).toUpperCase()}`,
        attack: 0, decay: 0, sustain: 15, release: 0,
        waveform: 0x10, pulseWidth: 2048, hardRestart: false
    };
    next.instruments.push(newInst);
    return next;
};

export const deleteProjectInstrument = (project: TrackerProject, instId: number): TrackerProject => {
    const next = { ...project, instruments: project.instruments.filter(i => i.id !== instId) };
    return next;
};

export const updatePatternCell = (project: TrackerProject, patternId: number, rowIdx: number, channel: number, changes: Partial<TrackerRow>): TrackerProject => {
    if (!Number.isInteger(rowIdx) || rowIdx < 0 || rowIdx >= 64 || !Number.isInteger(channel) || channel < 0 || channel > 2) return project;
    const next = { ...project, patterns: project.patterns.map(p => ({ ...p, rows: [...p.rows] })) };
    const patternIdx = next.patterns.findIndex(p => p.id === patternId);
    
    if (patternIdx !== -1) {
        const pattern = next.patterns[patternIdx];
        if (pattern.rows[rowIdx]) {
            const row = [...pattern.rows[rowIdx]];
            row[channel] = { ...row[channel], ...changes };
            pattern.rows[rowIdx] = row;
        }
    }
    return next;
};

export const updatePatternCellHex = (project: TrackerProject, patternId: number, rowIdx: number, channel: number, column: number, hexChar: string): TrackerProject => {
    if (!Number.isInteger(rowIdx) || rowIdx < 0 || rowIdx >= 64 || !Number.isInteger(channel) || channel < 0 || channel > 2 ||
        !Number.isInteger(column) || column < 1 || column > 4 || !/^[0-9a-f]$/i.test(hexChar)) return project;
    const next = { ...project, patterns: project.patterns.map(p => ({ ...p, rows: [...p.rows] })) };
    const patternIdx = next.patterns.findIndex(p => p.id === patternId);

    if (patternIdx !== -1) {
        const pattern = next.patterns[patternIdx];
        if (pattern.rows[rowIdx]) {
            const row = [...pattern.rows[rowIdx]];
            const cell = { ...row[channel] };

            const digit = parseInt(hexChar, 16);
            if (column === 1) { 
                // Instrument: 00-3F (nibble shift)
                cell.inst = ((cell.inst << 4) | digit) & 0x3F;
            } else if (column === 2) { 
                // Volume: 00-7F (nibble shift)
                const old = parseInt(cell.vol, 16) || 0;
                cell.vol = (((old << 4) | digit) & 0x7F).toString(16).toUpperCase().padStart(2, '0');
            } else if (column === 3) { 
                // Effect CMD: Single hex digit
                cell.cmd = hexChar.toUpperCase();
            } else if (column === 4) { 
                // Effect VAL: 00-FF (nibble shift)
                const old = parseInt(cell.val, 16) || 0;
                cell.val = (((old << 4) | digit) & 0xFF).toString(16).toUpperCase().padStart(2, '0');
            }

            row[channel] = cell;
            pattern.rows[rowIdx] = row;
        }
    }
    return next;
};

export const updateOrderList = (project: TrackerProject, step: number, patternId: number): TrackerProject => {
    if (!project.subtunes[0] || !Number.isInteger(step) || step < 0 || step >= project.subtunes[0].orderList.length ||
        !Number.isSafeInteger(patternId) || patternId < 0) return project;
    const next = { ...project, subtunes: [...project.subtunes] };
    const st = { ...next.subtunes[0], orderList: [...next.subtunes[0].orderList] };
    if (step >= 0 && step < st.orderList.length) {
        st.orderList[step] = patternId;
        next.subtunes[0] = st;
    }
    return next;
};

export const setSequenceLoopPoint = (project: TrackerProject, loopPoint: number): TrackerProject => {
    if (!project.subtunes[0] || !Number.isInteger(loopPoint) || !project.subtunes[0].orderList.length) return project;
    const next = { ...project, subtunes: [...project.subtunes] };
    const st = { ...next.subtunes[0] };
    if (loopPoint === -1) delete st.loopPosition;
    else st.loopPosition = Math.max(0, Math.min(st.orderList.length - 1, loopPoint));
    next.subtunes[0] = st;
    return next;
};

export const insertSequenceStep = (project: TrackerProject, atIndex: number): TrackerProject => {
    if (!project.subtunes[0] || !Number.isInteger(atIndex) || atIndex < 0 || atIndex >= project.subtunes[0].orderList.length) return project;
    const next = { ...project, subtunes: [...project.subtunes] };
    const st = { ...next.subtunes[0], orderList: [...next.subtunes[0].orderList] };
    const patToInsert = st.orderList[Math.min(atIndex, st.orderList.length - 1)] ?? 0;
    st.orderList.splice(atIndex + 1, 0, patToInsert);
    if (st.loopPosition !== undefined && st.loopPosition > atIndex) st.loopPosition++;
    next.subtunes[0] = st;
    return next;
};

export const deleteSequenceStep = (project: TrackerProject, atIndex: number): TrackerProject => {
    if (!project.subtunes[0] || !Number.isInteger(atIndex) || atIndex < 0 || atIndex >= project.subtunes[0].orderList.length) return project;
    const next = { ...project, subtunes: [...project.subtunes] };
    const st = { ...next.subtunes[0], orderList: [...next.subtunes[0].orderList] };
    if (st.orderList.length > 1) {
        st.orderList.splice(atIndex, 1);
        if (st.loopPosition !== undefined && st.loopPosition > atIndex) st.loopPosition--;
        if (st.loopPosition !== undefined && st.loopPosition >= st.orderList.length) st.loopPosition = st.orderList.length - 1;
        next.subtunes[0] = st;
    }
    return next;
};

export const transposePattern = (project: TrackerProject, patternId: number, channel: number, semitones: number, wholePattern: boolean): TrackerProject => {
    if (!Number.isInteger(semitones) || (!wholePattern && (!Number.isInteger(channel) || channel < 0 || channel > 2))) return project;
    const next = { ...project, patterns: project.patterns.map(p => ({ ...p, rows: [...p.rows] })) };
    const pattern = next.patterns.find(p => p.id === patternId);
    if (pattern) {
        const NOTES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
        pattern.rows = pattern.rows.map(row => {
            const channelsToMod = wholePattern ? [0, 1, 2] : [channel];
            const newRow = [...row];
            channelsToMod.forEach(ch => {
                const cell = { ...newRow[ch] };
                if (cell.note && cell.note !== '---' && cell.note !== '===') {
                    const name = cell.note.substring(0, 2);
                    const oct = parseInt(cell.note.substring(2));
                    if (!isNaN(oct)) {
                        let idx = NOTES.indexOf(name);
                        if (idx !== -1) {
                            const rawVal = oct * 12 + idx + semitones;
                            if (rawVal >= 0 && rawVal <= 127) {
                                const newOct = Math.floor(rawVal / 12);
                                const newName = NOTES[rawVal % 12];
                                cell.note = `${newName}${newOct}`;
                            }
                        }
                    }
                }
                newRow[ch] = cell;
            });
            return newRow;
        });
    }
    return next;
};

export const clearPattern = (project: TrackerProject, patternId: number, channel: number, wholePattern: boolean): TrackerProject => {
    if (!wholePattern && (!Number.isInteger(channel) || channel < 0 || channel > 2)) return project;
    const next = { ...project, patterns: project.patterns.map(p => ({ ...p, rows: [...p.rows] })) };
    const pattern = next.patterns.find(p => p.id === patternId);
    if (pattern) {
        pattern.rows = pattern.rows.map(row => {
            const channelsToMod = wholePattern ? [0, 1, 2] : [channel];
            const newRow = [...row];
            channelsToMod.forEach(ch => { 
              newRow[ch] = { note: '---', inst: 0, vol: '..', cmd: '...', val: '..' }; 
            });
            return newRow;
        });
    }
    return next;
};
