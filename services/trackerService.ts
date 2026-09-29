
import { ParsedTrace, TrackerProject, TrackerInstrument, TrackerPattern, TrackerRow, SwmChord, SwmTempo } from '../types';
import { getNoteName, analyzeArpeggio, detectVibrato, CLOCK_PAL } from './sidService';

const ROWS_PER_PATTERN = 64;

const instrumentsMatch = (a: TrackerInstrument, b: Partial<TrackerInstrument>) => {
    return (
        a.attack === b.attack &&
        a.decay === b.decay &&
        a.sustain === b.sustain &&
        a.release === b.release &&
        // Fix: Mask 0xF6 (1111 0110) checks Waveform (High Nibble) + Ring (Bit 2) + Sync (Bit 1)
        // Ignores Gate (Bit 0) and Test (Bit 3)
        (a.waveform & 0xF6) === (b.waveform! & 0xF6) &&
        Math.abs(a.pulseWidth - (b.pulseWidth || 0)) < 16 // Tighter matching
    );
};

const generatePatternSignature = (rows: TrackerRow[][]): string => {
    // Pattern deduplication must be lossless: a compact numeric hash can collide.
    return JSON.stringify(rows);
};

const sanitizeString = (str: string, maxLen: number): string => {
    if (!str) return "Unknown";
    const clean = str.replace(/[^\x20-\x7E]/g, '');
    return clean.substring(0, maxLen).trim() || "Unknown";
};

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

export const traceToTrackerProject = async (trace: ParsedTrace): Promise<TrackerProject> => {
    const instruments: TrackerInstrument[] = [];
    const rawPatterns: TrackerRow[][][] = [];
    const orderList: number[] = [];
    const clock = trace.header.clock || CLOCK_PAL;

    const channelState = [0, 1, 2].map(() => ({
        lastInstrumentId: 0,
        lastGate: false,
        lastNote: "---",
        lastFreq: 0,
        lastPw: 0,
        lastCtrl: 0,
        vibratoCount: 0,
        baseFreq: 0
    }));

    let currentPatternRows: TrackerRow[][] = [];
    // Compare with commands actually emitted, not merely the preceding frame:
    // a busy effect column must not permanently discard a filter change.
    const emittedFilter = { T: 0x0F, R: 0, F: 0 };

    const createEmptyRow = (): TrackerRow[] => {
        const row: TrackerRow[] = [];
        for(let v=0; v<3; v++) row.push({ note: "---", inst: 0, vol: '..', cmd: "...", val: ".." });
        return row;
    };

    for (let f = 0; f < trace.frames.length; f++) {
        if (f % 2000 === 0) await yieldToMain();

        if (currentPatternRows.length === ROWS_PER_PATTERN) {
            rawPatterns.push(currentPatternRows);
            currentPatternRows = [];
        }

        const frame = trace.frames[f];
        
        const fc = (frame[21] & 7) | (frame[22] << 3);
        const resRoute = frame[23];
        const modeVol = frame[24];
        
        const desiredFilter = { T: modeVol, R: resRoute, F: (fc >> 3) & 0xFF };
        const pendingFilter = (['T', 'R', 'F'] as const).filter(key => desiredFilter[key] !== emittedFilter[key]);

        const rowData: TrackerRow[] = [];
        for (let v = 0; v < 3; v++) {
            const off = v * 7;
            const freq = frame[off] | (frame[off+1] << 8);
            const pw = frame[off+2] | ((frame[off+3] & 0x0F) << 8);
            const ctrl = frame[off+4];
            const ad = frame[off+5];
            const sr = frame[off+6];
            
            const gate = (ctrl & 0x01) !== 0;
            const state = channelState[v];
            
            let note = "---";
            let inst = 0;
            let cmd = "...";
            let val = "..";
            let vol = "..";
            const currentNoteName = getNoteName(freq, clock);
            
            if (gate && !state.lastGate) {
                note = currentNoteName;
                let hasVibrato = false;
                const lookAhead = 12;
                const nextFreqs = [];
                for(let k=0; k<lookAhead && f+k < trace.frames.length; k++) {
                    const nf = trace.frames[f+k];
                    if ((nf[off+4] & 0x01) === 0) break;
                    nextFreqs.push(nf[off] | (nf[off+1] << 8));
                }
                if (detectVibrato(nextFreqs)) hasVibrato = true;

                const candInst: Partial<TrackerInstrument> = {
                    attack: (ad >> 4) & 0xF,
                    decay: ad & 0xF,
                    sustain: (sr >> 4) & 0xF,
                    release: sr & 0xF,
                    waveform: ctrl & 0xFE, 
                    pulseWidth: pw
                };

                let existing = instruments.find(i => instrumentsMatch(i, candInst));
                if (!existing) {
                    existing = {
                        id: instruments.length + 1,
                        name: `INST${(instruments.length + 1).toString(16).toUpperCase()}`,
                        ...candInst,
                        hardRestart: false, 
                        vibratoType: 0, 
                        vibParam: hasVibrato ? 0x44 : 0, 
                        vibDelay: 0, 
                        arpSpeed: 0, 
                        flags: 0, 
                        hrAd: 0x0F, 
                        hrSr: 0xF0
                    } as TrackerInstrument;
                    instruments.push(existing);
                }
                inst = existing.id;
                state.lastInstrumentId = inst;
                state.baseFreq = freq;
                state.vibratoCount = 0;

            } else if (!gate && state.lastGate) {
                note = "==="; 
            } else if (gate && state.lastGate) {
                const lookAhead = 12;
                const nextFreqs = [];
                nextFreqs.push(freq);
                for(let k=1; k<lookAhead; k++) {
                    if (f+k < trace.frames.length) {
                        const nf = trace.frames[f+k];
                        if ((nf[off+4] & 0x01) === 0) break;
                        nextFreqs.push(nf[off] | (nf[off+1] << 8));
                    }
                }
                
                const arpInfo = analyzeArpeggio(nextFreqs);
                const isVibrato = detectVibrato(nextFreqs);
                
                if (arpInfo) {
                     cmd = "0"; 
                     val = `${arpInfo.x.toString(16)}${arpInfo.y.toString(16)}`.toUpperCase();
                } else if (isVibrato) {
                    cmd = "4";
                    val = "00";
                } else {
                    // Ratio-based change detection (approx 3% / 50 cents)
                    // Reduces visual noise from subtle vibrato
                    const ratio = freq > state.lastFreq ? freq / state.lastFreq : state.lastFreq / freq;
                    
                    if (ratio > 1.03) { 
                        if (Math.abs(freq - state.baseFreq) > 20) {
                            if (freq > state.lastFreq) {
                                 cmd = "1";
                                 let speed = Math.min(0xFF, Math.floor((freq - state.lastFreq)/2));
                                 val = speed.toString(16).toUpperCase().padStart(2,'0');
                            } else {
                                 cmd = "2";
                                 let speed = Math.min(0xFF, Math.floor((state.lastFreq - freq)/2));
                                 val = speed.toString(16).toUpperCase().padStart(2,'0');
                            }
                        }
                    }
                }
                
                if (cmd === "..." && Math.abs(pw - state.lastPw) > 10) {
                     cmd = "E"; 
                     const pwVal = (pw >> 4) & 0xFF;
                     val = pwVal.toString(16).toUpperCase().padStart(2,'0');
                }
                
                if (cmd === "..." && (ctrl & 0xF0) !== (state.lastCtrl & 0xF0)) {
                    cmd = "W";
                    val = ((ctrl >> 4) & 0x0F).toString(16).toUpperCase() + "0";
                }
            }
            
            if (pendingFilter.length && cmd === "...") {
                const key = pendingFilter.shift()!;
                cmd = key;
                val = desiredFilter[key].toString(16).toUpperCase().padStart(2, '0');
                emittedFilter[key] = desiredFilter[key];
            }

            state.lastGate = gate; state.lastNote = currentNoteName; state.lastFreq = freq; state.lastPw = pw; state.lastCtrl = ctrl;
            rowData.push({ note, inst, vol, cmd, val });
        }
        currentPatternRows.push(rowData);
    }

    if (currentPatternRows.length > 0) {
        while (currentPatternRows.length < ROWS_PER_PATTERN) currentPatternRows.push(createEmptyRow());
        rawPatterns.push(currentPatternRows);
    }

    const uniquePatterns: TrackerPattern[] = [];
    const signatureMap = new Map<string, number>();
    const signatureCache = new Map<TrackerRow[][], string>();

    rawPatterns.forEach((rows) => {
        let signature = signatureCache.get(rows);
        if (!signature) {
            signature = generatePatternSignature(rows);
            signatureCache.set(rows, signature);
        }
        
        if (signatureMap.has(signature)) {
            orderList.push(signatureMap.get(signature)!);
        } else {
            const newId = uniquePatterns.length;
            uniquePatterns.push({ id: newId, rows: rows });
            signatureMap.set(signature, newId);
            orderList.push(newId);
        }
    });

    return {
        instruments, 
        patterns: uniquePatterns,
        subtunes: [{ id: 0, tempo: 6, orderList: orderList.length ? orderList : [0] }],
        chordTable: [],
        tempoTable: [],
        frameSpeed: 1,
        frameRate: trace.header.fps ?? (clock >= 1_000_000 ? 60 : 50),
        meta: { 
            title: sanitizeString(trace.header.song || '', 32), 
            author: sanitizeString(trace.header.author || '', 32), 
            released: sanitizeString(trace.header.copyright || '', 32) 
        }
    };
};
