
import { TrackerProject } from '../types';
import { packChordTable, packTempoTable } from './swmTableService';

const ROWS_PER_PATTERN = 64;

const midiNoteToSwmByte = (noteStr: string): number => {
    if (noteStr === "---") return 0x00;
    if (noteStr === "===") return 0x7E; 
    if (noteStr === "???") return 0x00;

    const notes = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
    const name = noteStr.substring(0, 2);
    const octStr = noteStr.substring(2);
    const oct = parseInt(octStr, 10);
    
    if (isNaN(oct)) return 0;
    
    const nIdx = notes.indexOf(name);
    if (nIdx === -1) return 0;
    
    const val = (oct * 12) + nIdx + 1;
    if (val < 1) return 1; if (val > 0x5F) return 0x5F;
    return val;
};

const parseCmd = (cmdStr: string, parameter: string): { fx: number, param: number } | null => {
    if (/^\.*$/.test(cmdStr)) return null;
    const type = cmdStr.charAt(0);
    const valStr = /^[0-9a-f]{2}$/i.test(parameter) ? parameter : cmdStr.length >= 3 ? cmdStr.substring(1) : "00";
    const val = parseInt(valStr, 16);
    const safeVal = isNaN(val) ? 0 : val;

    // Extended SWM BigFX mapping
    if (type === '0') return { fx: 0x07, param: safeVal }; // Arpeggio -> SetChord
    if (type === '1') return { fx: 0x01, param: safeVal }; // Portamento Up
    if (type === '2') return { fx: 0x02, param: safeVal }; // Portamento Down
    if (type === '3') return { fx: 0x03, param: safeVal }; // Tone Portamento
    if (type === '4') return { fx: 0x08, param: safeVal }; // Vibrato
    if (type === '5') return { fx: 0x05, param: safeVal }; // Continue+VolSlide (T+A)
    if (type === '6') return { fx: 0x06, param: safeVal }; // Continue+VolSlide (V+A)
    if (type === 'A') return { fx: 0x0A, param: safeVal }; // Volume Slide
    if (type === 'C') return { fx: 0x09, param: safeVal }; // Set Volume (BigFX 0x09)
    if (type === 'E') return { fx: 0x0E, param: safeVal }; // Pulse Width
    if (type === 'F') {
        if (safeVal < 0x20) return { fx: 0x11, param: safeVal }; // Set Tempo (F00-F1F)
        return { fx: 0x0F, param: safeVal }; // Filter Cutoff
    }
    if (type === 'W') return { fx: 0x04, param: safeVal }; // Waveform
    if (type === 'T') return { fx: 0x0B, param: safeVal }; // Filter Mode/Type
    if (type === 'R') return { fx: 0x0C, param: safeVal }; // Resonance
    if (type === 'B') return { fx: 0x0D, param: safeVal }; // Pattern Break
    if (type === 'D') return { fx: 0x10, param: safeVal }; // Pattern Delay
    
    return null;
};

export const generateSwmFile = (project: TrackerProject): Uint8Array => {
    const swmPatterns: number[][] = []; 
    const patternCache = new Map<string, number>(); 
    const trackSequences: number[][] = [[], [], []];
    
    for (let pIdx of project.subtunes[0].orderList) {
        const pattern = project.patterns.find(p => p.id === pIdx);
        if (!pattern) continue;

        for (let ch = 0; ch < 3; ch++) {
            const swmRows: number[] = [];
            let emptyRowCount = 0;

            const flushEmptyRows = () => {
                while (emptyRowCount > 0) {
                    if (emptyRowCount === 1) { swmRows.push(0x00); emptyRowCount--; }
                    else {
                        const chunk = Math.min(9, emptyRowCount);
                        if (chunk >= 2) { swmRows.push(0x70 + (chunk - 2)); emptyRowCount -= chunk; }
                        else { swmRows.push(0x00); emptyRowCount--; }
                    }
                }
            };

            for (let r = 0; r < ROWS_PER_PATTERN; r++) {
                const row = (pattern.rows && pattern.rows[r] && pattern.rows[r][ch]) 
                  ? pattern.rows[r][ch] 
                  : { note: '---', inst: 0, cmd: '...', val: '..' };
                const noteByte = midiNoteToSwmByte(row.note);
                const instByte = row.inst & 0x3F;
                const fxData = parseCmd(row.cmd, row.val);

                const hasNote = noteByte !== 0; 
                const hasInst = instByte > 0;
                const hasFx = fxData !== null;
                
                if (!hasNote && !hasInst && !hasFx) { emptyRowCount++; continue; }

                flushEmptyRows();
                
                let b1 = hasNote ? noteByte : 0;
                if (hasInst || hasFx) b1 |= 0x80;
                if (b1 === 0 && (hasInst || hasFx)) b1 = 0x80; 
                
                swmRows.push(b1);

                if (hasInst || hasFx) {
                    let b2 = hasInst ? instByte : 0;
                    if (hasFx) b2 |= 0x80;
                    swmRows.push(b2);

                    if (hasFx) {
                        swmRows.push(fxData!.fx);
                        swmRows.push(fxData!.param);
                    }
                }
            }
            flushEmptyRows();

            const sig = swmRows.map(b=>b.toString(16)).join(',');
            let swmPatId = patternCache.get(sig);
            if (swmPatId === undefined) {
                swmPatId = swmPatterns.length;
                swmPatterns.push(swmRows);
                patternCache.set(sig, swmPatId);
            }
            trackSequences[ch].push(swmPatId);
        }
    }

    const chordBytes = project.chordTable ? packChordTable(project.chordTable) : [];
    const tempoBytes = project.tempoTable ? packTempoTable(project.tempoTable) : [];

    const bytes: number[] = [];
    const writeStr = (s: string, len: number) => { for(let i=0; i<len; i++) bytes.push(i < s.length ? s.charCodeAt(i) : 0); };

    writeStr("SWM1", 4);
    const fs = project.frameSpeed || 1;
    
    bytes.push(fs, 4, 4, 0, 0xFE, 0xFE, 0xFE, 0x20, 3, swmPatterns.length, project.instruments.length, chordBytes.length, tempoBytes.length, 0, 0, 0, 0);
    // Pad header to standard 64-byte boundary
    while(bytes.length < 0x40) bytes.push(0);
    writeStr(project.meta.author.padEnd(40, ' ').substring(0, 40), 40);

    const subtune = project.subtunes[0];
    const loopPos = subtune.loopPosition !== undefined ? subtune.loopPosition : -1;

    for (let ch = 0; ch < 3; ch++) {
        const seqData = [...trackSequences[ch]];
        if (loopPos >= 0 && loopPos < seqData.length) {
            seqData.push(0xFF); 
            seqData.push(loopPos);
        } else {
            seqData.push(0xFE); 
        }
        bytes.push(seqData.length); bytes.push(...seqData);
    }

    for (const patData of swmPatterns) {
        bytes.push((1 + patData.length) & 0xFF, 64, ...patData);
    }

    for (const inst of project.instruments) {
        bytes.push(inst.flags||0, inst.hrAd||0x0F, inst.hrSr||0xF0, (inst.attack<<4)|inst.decay, (inst.sustain<<4)|inst.release, inst.vibParam||0, inst.vibDelay||0, inst.arpSpeed||0, 1, 0, 0x11, 0x12, 0, 0, 0, (inst.waveform & 0xFE) | 1);
        bytes.push(inst.gatTimer || 0, 0xFF, 0xFF);
        writeStr(inst.name.padEnd(8, ' ').substring(0,8), 8);
    }

    bytes.push(...chordBytes);
    bytes.push(...tempoBytes);
    
    const ft = subtune.funkTempo || 0;
    bytes.push(ft, ft);

    return new Uint8Array(bytes);
};
