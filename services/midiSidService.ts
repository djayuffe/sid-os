
import { ParsedTrace, SidEvent } from '../types';
import { CLOCK_PAL, SID_REG } from './sidService';
import { SystemLogger } from './Logger';
import { DrumProcessor } from './drumProcessor';

const CLAMP = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

interface SidPatch {
    name: string;
    wave: number; 
    atk: number; dec: number; sus: number; rel: number;
    pw: number;
    filter: boolean;
    vibDepth?: number;
    resonance?: number;
}

// Tighter envelope defaults to prevent mud
const DEFAULT_PATCH: SidPatch = { name: "Default", wave: 0x40, atk: 0, dec: 8, sus: 10, rel: 4, pw: 0x800, filter: false };

const GM_PRESETS: Record<number, SidPatch> = {
    0: { name: "Grand Piano", wave: 0x40, atk: 0, dec: 9, sus: 0, rel: 6, pw: 0x400, filter: false },
    11: { name: "Vibraphone", wave: 0x10, atk: 0, dec: 5, sus: 12, rel: 5, pw: 0, filter: false, vibDepth: 0.5 },
    16: { name: "Drawbar", wave: 0x41, atk: 1, dec: 0, sus: 15, rel: 2, pw: 0x800, filter: false },
    19: { name: "Church", wave: 0x10, atk: 4, dec: 4, sus: 15, rel: 6, pw: 0, filter: true, resonance: 8 },
    25: { name: "Steel Gtr", wave: 0x20, atk: 0, dec: 8, sus: 10, rel: 5, pw: 0, filter: false },
    29: { name: "Overdrive", wave: 0x41, atk: 0, dec: 9, sus: 12, rel: 4, pw: 0x600, filter: true, resonance: 4 },
    33: { name: "Finger Bass", wave: 0x10, atk: 0, dec: 6, sus: 12, rel: 4, pw: 0x200, filter: true, resonance: 2 },
    38: { name: "Synth Bass 1", wave: 0x20, atk: 0, dec: 8, sus: 10, rel: 4, pw: 0, filter: true, resonance: 6 },
    40: { name: "Violin", wave: 0x20, atk: 5, dec: 6, sus: 10, rel: 5, pw: 0, filter: false, vibDepth: 0.8 },
    48: { name: "Strings", wave: 0x41, atk: 8, dec: 4, sus: 12, rel: 8, pw: 0x800, filter: false },
    80: { name: "Square Lead", wave: 0x40, atk: 1, dec: 5, sus: 12, rel: 4, pw: 0x800, filter: false },
    81: { name: "Saw Lead", wave: 0x21, atk: 1, dec: 5, sus: 12, rel: 4, pw: 0, filter: true, resonance: 5 },
};

function getPatch(prog: number): SidPatch {
    if (GM_PRESETS[prog]) return GM_PRESETS[prog];
    if (prog >= 0 && prog < 8) return GM_PRESETS[0]; 
    if (prog >= 32 && prog < 40) return GM_PRESETS[33]; 
    if (prog >= 40 && prog < 56) return GM_PRESETS[48];
    return DEFAULT_PATCH;
}

function parseSmfLocal(midiData: ArrayBuffer) {
    const view = new DataView(midiData);
    const b = new Uint8Array(midiData);
    if (b.length < 14 || view.getUint32(0) !== 0x4d546864) {
        SystemLogger.log('MidiParser', "Invalid MIDI Header", 'error');
        return { events: [], tempos: [], ppq: 480 };
    }
    const trackCount = view.getUint16(10);
    const timeDiv = view.getUint16(12);
    let ppq = 480;
    if ((timeDiv & 0x8000) === 0) ppq = timeDiv & 0x7FFF; 
    
    const events: any[] = [];
    const tempos: any[] = [];
    let ptr = 14;

    const readVLQ = () => {
        let val = 0;
        let shift = 0;
        while (true) {
            if (ptr >= b.length) break;
            const byte = b[ptr++];
            val = val | ((byte & 0x7f) << shift);
            shift += 7;
            if ((byte & 0x80) === 0) break;
        }
        // VLQ in SMF is Big Endian actually...
        // Let's correct standard VLQ reading:
        return 0; // Placeholder, corrected below
    };

    // Corrected VLQ Reader (Big Endian)
    const readVLQ_BE = () => {
        let val = 0;
        while (true) {
            if (ptr >= b.length) break;
            const byte = b[ptr++];
            val = (val << 7) | (byte & 0x7f);
            if ((byte & 0x80) === 0) break;
        }
        return val;
    };

    for (let t = 0; t < trackCount; t++) {
        while (ptr < b.length - 4 && view.getUint32(ptr) !== 0x4d54726b) ptr++; 
        if (ptr >= b.length - 4) break;
        ptr += 4; 
        const len = view.getUint32(ptr); ptr += 4;
        const end = ptr + len;
        let tick = 0; 
        let runningStatus = 0;

        while (ptr < end) {
            const delta = readVLQ_BE();
            tick += delta;
            if (ptr >= end) break;
            
            let status = b[ptr];
            let type = 0;
            let ch = 0;

            if (status >= 0x80) {
                ptr++;
                if (status < 0xF0) runningStatus = status;
                type = status & 0xF0;
                ch = status & 0x0F;
            } else {
                status = runningStatus;
                type = status & 0xF0;
                ch = status & 0x0F;
            }

            if (type === 0x80) { const n = b[ptr++]; const v = b[ptr++]; events.push({ tick, kind: 'off', ch, note: n, vel: v }); }
            else if (type === 0x90) { const n = b[ptr++]; const v = b[ptr++]; events.push({ tick, kind: v > 0 ? 'on' : 'off', ch, note: n, vel: v }); }
            else if (type === 0xB0) { const cc = b[ptr++]; const val = b[ptr++]; events.push({ tick, kind: 'cc', ch, cc, val }); }
            else if (type === 0xC0) { const prog = b[ptr++]; events.push({ tick, kind: 'pc', ch, program: prog }); }
            else if (type === 0xE0) { const l = b[ptr++]; const m = b[ptr++]; events.push({ tick, kind: 'pb', ch, val: ((m << 7) | l) - 8192 }); }
            else if (status === 0xFF) { 
                const mt = b[ptr++]; const ml = readVLQ_BE();
                if (mt === 0x51 && ml === 3) {
                    const mpqn = (b[ptr] << 16) | (b[ptr + 1] << 8) | b[ptr + 2];
                    tempos.push({ tick, mpqn });
                }
                ptr += ml;
            } else if (status === 0xF0 || status === 0xF7) { const len = readVLQ_BE(); ptr += len; }
        }
    }
    return { events: events.sort((a:any, b:any) => a.tick - b.tick), tempos: tempos.sort((a:any, b:any) => a.tick - b.tick), ppq };
}

const FREQ_TABLE = new Float32Array(128).map((_, i) => 440 * Math.pow(2, (i - 69) / 12));

class ChannelState {
    patch: SidPatch = DEFAULT_PATCH;
    pb = 0; modWheel = 0; sustain = false; lfoPhase = 0;
}

class VoiceState {
    channelIdx = -1; note = -1; freq = 0; pw = 0; ctrl = 0; adsr = 0;
    gate = false; isDrum = false; pendingRelease = false;
    lastTriggerCycle = 0;
}

export async function compileMidiToSidTrace(midiData: ArrayBuffer, options: { clock?: number; filename?: string }): Promise<ParsedTrace> {
    const { events, ppq, tempos } = parseSmfLocal(midiData);
    const clock = options.clock || CLOCK_PAL;
    const fps = 50; 
    const cyclesPerFrame = Math.floor(clock / fps);
    const MAX_SIM_STEP = 2500; 

    if (tempos.length === 0 || tempos[0].tick > 0) tempos.unshift({ tick: 0, mpqn: 500000 });
    
    const cycleEvents = [];
    let curTick = 0;
    let curTimeUs = 0.0;
    let curMpqn = 500000;
    let tempoIdx = 0;

    const clockPerUs = clock / 1000000.0;

    for (const e of events) {
        const delta = e.tick - curTick;
        if (delta > 0) {
            while(tempoIdx < tempos.length && tempos[tempoIdx].tick < e.tick) {
                const t = tempos[tempoIdx];
                const segDelta = t.tick - curTick;
                if (segDelta > 0) {
                    curTimeUs += (segDelta * curMpqn) / ppq;
                    curTick = t.tick;
                }
                curMpqn = t.mpqn;
                tempoIdx++;
            }
            const remaining = e.tick - curTick;
            curTimeUs += (remaining * curMpqn) / ppq;
            curTick = e.tick;
        }
        
        cycleEvents.push({
            ...e,
            absCycles: Math.floor(curTimeUs * clockPerUs)
        });
    }

    const totalDurationCycles = cycleEvents.length > 0 ? cycleEvents[cycleEvents.length-1].absCycles + clock : clock;
    
    const channels = Array.from({length: 16}, () => new ChannelState());
    const voices = Array.from({length: 3}, () => new VoiceState());
    const drumProc = new DrumProcessor(1);
    
    const traceEvents: SidEvent[] = [];
    const frames: number[][] = [];
    
    let currentCycle = 0;
    let nextFrameCycle = 0;
    let eventIdx = 0;

    const emit = (c: number, r: number, v: number) => {
        traceEvents.push({ cycles: Math.floor(c), reg: r, val: v & 0xFF });
    };

    const handleNoteOff = (chIdx: number, note: number) => {
        const ch = channels[chIdx];
        voices.forEach((v, i) => {
            if (!v.isDrum && v.channelIdx === chIdx && v.note === note) {
                if (ch.sustain) {
                    v.pendingRelease = true;
                } else {
                    v.gate = false;
                    const off = i * 7;
                    const ctrl = v.ctrl & 0xFE;
                    emit(currentCycle, off + SID_REG.V1_CTRL, ctrl);
                    v.ctrl = ctrl;
                }
            }
        });
    };

    while (currentCycle < totalDurationCycles) {
        const nextEventCycle = (eventIdx < cycleEvents.length) ? cycleEvents[eventIdx].absCycles : Number.MAX_SAFE_INTEGER;
        const distToFrame = nextFrameCycle - currentCycle;
        const distToEvent = nextEventCycle - currentCycle;
        
        let step = Math.min(distToFrame, distToEvent, MAX_SIM_STEP);
        if (step < 0) step = 0; 

        const targetCycle = currentCycle + step;
        const dtSeconds = step / clock;
        
        if (dtSeconds > 0) {
            channels.forEach((ch) => { ch.lfoPhase += dtSeconds * 5.0; });
        }

        currentCycle = targetCycle;

        if (currentCycle >= nextFrameCycle) {
            const regs = new Array(32).fill(0);
            voices.forEach((v, i) => {
                const off = i * 7;
                regs[off] = v.freq & 0xFF;
                regs[off+1] = (v.freq >> 8) & 0xFF;
                regs[off+2] = v.pw & 0xFF;
                regs[off+3] = (v.pw >> 8) & 0xF;
                regs[off+4] = v.ctrl;
                regs[off+5] = v.adsr >> 8;
                regs[off+6] = v.adsr & 0xFF;
            });
            regs[24] = 0x0F; 
            frames.push(regs);
            nextFrameCycle += cyclesPerFrame;
        }

        if (currentCycle >= nextEventCycle && eventIdx < cycleEvents.length) {
            while (eventIdx < cycleEvents.length && cycleEvents[eventIdx].absCycles <= currentCycle) {
                const e = cycleEvents[eventIdx++];
                
                if (e.ch === 9) {
                    if (e.kind === 'on') {
                        const scaledVel = Math.floor(e.vel * 0.5);
                        drumProc.trigger(0, e.note, scaledVel);
                        voices[2].isDrum = true;
                        voices[2].channelIdx = 9;
                    } else if (e.kind === 'off') {
                        drumProc.release(0);
                    }
                } else {
                    const ch = channels[e.ch];
                    if (e.kind === 'pc') ch.patch = getPatch(e.program);
                    else if (e.kind === 'cc') {
                        if (e.cc === 1) ch.modWheel = e.val;
                        else if (e.cc === 64) {
                            const prevSustain = ch.sustain;
                            ch.sustain = e.val >= 64;
                            if (prevSustain && !ch.sustain) {
                                voices.forEach((v, i) => {
                                    if (v.channelIdx === e.ch && v.pendingRelease) {
                                        v.gate = false;
                                        v.pendingRelease = false;
                                        const off = i * 7;
                                        const ctrl = v.ctrl & 0xFE;
                                        emit(currentCycle, off + SID_REG.V1_CTRL, ctrl);
                                        v.ctrl = ctrl;
                                    }
                                });
                            }
                        }
                    }
                    else if (e.kind === 'pb') ch.pb = e.val;
                    else if (e.kind === 'on') {
                        if (e.vel > 0) {
                            let candidates = voices.map((v, i) => ({v, i})).filter(c => !c.v.isDrum);
                            let pick = candidates.find(c => c.v.channelIdx === e.ch && c.v.note === e.note);
                            if (!pick) {
                                const freeVoices = candidates.filter(c => !c.v.gate);
                                if (freeVoices.length > 0) {
                                    freeVoices.sort((a, b) => a.v.lastTriggerCycle - b.v.lastTriggerCycle);
                                    pick = freeVoices[0];
                                }
                            }
                            if (!pick && candidates.length > 0) {
                                candidates.sort((a, b) => a.v.lastTriggerCycle - b.v.lastTriggerCycle);
                                pick = candidates[0];
                            }

                            if (pick) {
                                const vIdx = pick.i;
                                const v = voices[vIdx];
                                v.channelIdx = e.ch;
                                v.note = e.note;
                                v.gate = true;
                                v.pendingRelease = false;
                                v.lastTriggerCycle = currentCycle;
                                
                                const off = vIdx * 7;
                                const patch = ch.patch;
                                const wf = patch.wave;
                                const adsr = (patch.atk << 12) | (patch.dec << 8) | (patch.sus << 4) | patch.rel;
                                
                                emit(currentCycle, off + SID_REG.V1_AD, adsr >> 8);
                                emit(currentCycle, off + SID_REG.V1_SR, adsr & 0xFF);
                                emit(currentCycle, off + SID_REG.V1_PW_LO, patch.pw & 0xFF);
                                emit(currentCycle, off + SID_REG.V1_PW_HI, (patch.pw >> 8) & 0xF);

                                emit(currentCycle, off + SID_REG.V1_CTRL, wf & 0xFE); 
                                emit(currentCycle + 50, off + SID_REG.V1_CTRL, wf | 0x01);

                                v.ctrl = wf | 0x01;
                                v.adsr = adsr;
                                v.pw = patch.pw;
                            }
                        } else {
                            handleNoteOff(e.ch, e.note);
                        }
                    } else if (e.kind === 'off') {
                        handleNoteOff(e.ch, e.note);
                    }
                }
            }
        }

        if (voices[2].isDrum) {
            const d = drumProc.process(0, dtSeconds, clock);
            const off = 14;
            const fLo = d.freq & 0xFF; const fHi = d.freq >> 8;
            if (fLo !== (voices[2].freq & 0xFF)) emit(currentCycle, off, fLo);
            if (fHi !== (voices[2].freq >> 8)) emit(currentCycle, off+1, fHi);
            
            const ad = (d.adsr.a << 4) | d.adsr.d;
            const sr = (d.adsr.s << 4) | d.adsr.r;
            const adsrVal = (ad << 8) | sr;
            
            if (adsrVal !== voices[2].adsr) {
                if (ad !== (voices[2].adsr >> 8)) emit(currentCycle, off+5, ad);
                if (sr !== (voices[2].adsr & 0xFF)) emit(currentCycle, off+6, sr);
                voices[2].adsr = adsrVal;
            }

            if (d.ctrl !== voices[2].ctrl) emit(currentCycle, off+4, d.ctrl);
            
            voices[2].freq = d.freq;
            voices[2].ctrl = d.ctrl;

            if (!drumProc.voices[0].active && drumProc.voices[0].releaseTime > 0.5) {
                voices[2].isDrum = false;
                voices[2].channelIdx = -1;
            }
        }

        voices.forEach((v, i) => {
            if (v.isDrum || v.channelIdx === -1) return;
            const ch = channels[v.channelIdx];
            const note = v.note;
            const vib = Math.sin(ch.lfoPhase) * (ch.patch.vibDepth || 0) * (ch.modWheel / 127);
            const pb = ch.pb / 8192 * 2; 
            const hz = FREQ_TABLE[note] * Math.pow(2, (pb + vib) / 12);
            const freqReg = Math.min(65535, Math.floor((hz * 16777216) / clock));
            
            if (freqReg !== v.freq) {
                v.freq = freqReg;
                const off = i * 7;
                emit(currentCycle, off, v.freq & 0xFF);
                emit(currentCycle, off+1, v.freq >> 8);
            }
            
            const pwm = Math.sin(ch.lfoPhase * 0.5) * 50; 
            const pwReg = CLAMP(Math.floor(ch.patch.pw + pwm), 0, 4095);
            if (pwReg !== v.pw) {
                v.pw = pwReg;
                const off = i * 7;
                emit(currentCycle, off+2, v.pw & 0xFF);
                emit(currentCycle, off+3, v.pw >> 8);
            }
        });
    }

    return {
        header: { clock, song: options.filename || "Midi Import", author: "SidStation Pro", copyright: "Auto-Gen", originalFilename: options.filename },
        frames, events: traceEvents.sort((a,b) => a.cycles - b.cycles)
    };
}
