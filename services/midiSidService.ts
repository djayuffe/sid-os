
import { ParsedTrace, SidEvent } from '../types';
import { CLOCK_PAL } from './sidService';
import { DrumProcessor } from './drumProcessor';
import { selectSidNotes, type MidiReductionMode, type ReductionNote } from './midiReductionService';

const CLAMP = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

interface SidPatch {
    name: string;
    wave: number; 
    atk: number; dec: number; sus: number; rel: number;
    pw: number;
    filter: boolean;
    cutoff?: number;
    vibDepth?: number;
    resonance?: number;
    filterMode?: number;
    coupled?: 'ring' | 'sync';
}

// Tighter envelope defaults to prevent mud
const DEFAULT_PATCH: SidPatch = { name: "Default", wave: 0x40, atk: 0, dec: 8, sus: 10, rel: 4, pw: 0x800, filter: false };

const GM_PRESETS: Record<number, SidPatch> = {
    0: { name: "Grand Piano", wave: 0x40, atk: 0, dec: 9, sus: 0, rel: 6, pw: 0x400, filter: false },
    9: { name: "Glockenspiel", wave: 0x10, atk: 0, dec: 9, sus: 0, rel: 5, pw: 0, filter: false, coupled: "ring" },
    11: { name: "Vibraphone", wave: 0x10, atk: 0, dec: 5, sus: 12, rel: 5, pw: 0, filter: false, vibDepth: 0.5 },
    16: { name: "Drawbar", wave: 0x41, atk: 1, dec: 0, sus: 15, rel: 2, pw: 0x800, filter: false },
    19: { name: "Church", wave: 0x10, atk: 4, dec: 4, sus: 15, rel: 6, pw: 0, filter: true, cutoff: 0x3C0, resonance: 8 },
    25: { name: "Steel Gtr", wave: 0x20, atk: 0, dec: 8, sus: 10, rel: 5, pw: 0, filter: false },
    29: { name: "Overdrive", wave: 0x41, atk: 0, dec: 9, sus: 12, rel: 4, pw: 0x600, filter: true, cutoff: 0x520, resonance: 4 },
    33: { name: "Finger Bass", wave: 0x10, atk: 0, dec: 6, sus: 12, rel: 4, pw: 0x200, filter: true, cutoff: 0x2C0, resonance: 2 },
    38: { name: "Synth Bass 1", wave: 0x20, atk: 0, dec: 8, sus: 10, rel: 4, pw: 0, filter: true, cutoff: 0x300, resonance: 6 },
    40: { name: "Violin", wave: 0x20, atk: 5, dec: 6, sus: 10, rel: 5, pw: 0, filter: false, vibDepth: 0.8 },
    48: { name: "Strings", wave: 0x41, atk: 8, dec: 4, sus: 12, rel: 8, pw: 0x800, filter: false },
    80: { name: "Square Lead", wave: 0x40, atk: 1, dec: 5, sus: 12, rel: 4, pw: 0x800, filter: false, coupled: "sync" },
    81: { name: "Saw Lead", wave: 0x21, atk: 1, dec: 5, sus: 12, rel: 4, pw: 0, filter: true, cutoff: 0x600, resonance: 5 },
};

function getPatch(prog: number): SidPatch {
    if (GM_PRESETS[prog]) return GM_PRESETS[prog];
    if (prog >= 0 && prog < 8) return GM_PRESETS[0]; 
    if (prog >= 8 && prog < 16) return GM_PRESETS[prog === 11 ? 11 : 9];
    if (prog >= 16 && prog < 24) return GM_PRESETS[16];
    if (prog >= 24 && prog < 32) return GM_PRESETS[25];
    if (prog >= 56 && prog < 64) return { ...GM_PRESETS[81], name: 'Brass', atk: 3, filter: true };
    if (prog >= 64 && prog < 72) return { ...DEFAULT_PATCH, name: 'Reed', pw: 0x380, filter: true, cutoff: 0x500, filterMode: 2 };
    if (prog >= 72 && prog < 80) return { ...GM_PRESETS[11], name: 'Pipe', atk: 2, sus: 13 };
    if (prog >= 80 && prog < 88) return GM_PRESETS[81];
    if (prog >= 88 && prog < 104) return { ...GM_PRESETS[48], name: 'Pad', filter: true, cutoff: 0x600, resonance: 3 };
    if (prog >= 104 && prog < 120) return GM_PRESETS[25];
    if (prog >= 120) return { ...DEFAULT_PATCH, name: 'FX', wave: 0x80, sus: 6, filter: true, cutoff: 0x500, filterMode: 4 };
    if (prog >= 32 && prog < 40) return GM_PRESETS[33]; 
    if (prog >= 40 && prog < 56) return GM_PRESETS[48];
    return DEFAULT_PATCH;
}

function parseSmfLocal(midiData: ArrayBuffer) {
    const view = new DataView(midiData);
    const b = new Uint8Array(midiData);
    if (b.length < 14 || view.getUint32(0) !== 0x4d546864) {
        throw new Error('Invalid Standard MIDI file header');
    }
    const headerLength = view.getUint32(4);
    if (headerLength < 6 || headerLength + 8 > b.length) {
        throw new Error('Invalid Standard MIDI file header length');
    }
    const format = view.getUint16(8);
    const trackCount = view.getUint16(10);
    const timeDiv = view.getUint16(12);
    if ((timeDiv & 0x8000) !== 0) {
        throw new Error('SMPTE-timed MIDI files are not supported');
    }
    const ppq = timeDiv & 0x7FFF;
    if (format > 1 || trackCount === 0 || ppq === 0 || (format === 0 && trackCount !== 1)) {
        throw new Error('MIDI file has no tracks or an invalid tick division');
    }
    
    const events: any[] = [];
    const tempos: any[] = [];
    let eventOrder = 0;
    let ptr = headerLength + 8;

    // Corrected VLQ Reader (Big Endian)
    const readVLQ_BE = (end: number) => {
        let val = 0;
        for (let count = 0; count < 4; count++) {
            if (ptr >= end) throw new Error('Truncated MIDI variable-length value');
            const byte = b[ptr++];
            val = (val << 7) | (byte & 0x7f);
            if ((byte & 0x80) === 0) return val;
        }
        throw new Error('Invalid MIDI variable-length value');
    };

    const readDataByte = (end: number) => {
        if (ptr >= end) throw new Error('Truncated MIDI channel message');
        const value = b[ptr++];
        if (value >= 0x80) throw new Error('Invalid MIDI data byte');
        return value;
    };

    for (let t = 0; t < trackCount; t++) {
        if (ptr + 8 > b.length || view.getUint32(ptr) !== 0x4d54726b) {
            throw new Error(`Expected MIDI track ${t + 1}`);
        }
        ptr += 4; 
        const len = view.getUint32(ptr); ptr += 4;
        const end = ptr + len;
        if (end > b.length) throw new Error(`MIDI track ${t + 1} exceeds file length`);
        let tick = 0; 
        let runningStatus = 0;

        while (ptr < end) {
            const delta = readVLQ_BE(end);
            tick += delta;
            if (!Number.isSafeInteger(tick)) {
                throw new Error('MIDI event time exceeds the supported range');
            }
            if (ptr >= end) throw new Error('Truncated MIDI event after delta time');
            if (events.length + tempos.length > 500000) throw new Error('MIDI import exceeds the event safety limit');
            
            let status = b[ptr];
            let type = 0;
            let ch = 0;

            if (status >= 0x80) {
                ptr++;
                if (status < 0xF0) runningStatus = status;
                else runningStatus = 0;
                type = status & 0xF0;
                ch = status & 0x0F;
            } else {
                if (runningStatus === 0) throw new Error('MIDI data byte encountered without running status');
                status = runningStatus;
                type = status & 0xF0;
                ch = status & 0x0F;
            }

            if (type === 0x80) { const n = readDataByte(end); const v = readDataByte(end); events.push({ tick, kind: 'off', ch, note: n, vel: v, order: eventOrder++ }); }
            else if (type === 0x90) { const n = readDataByte(end); const v = readDataByte(end); events.push({ tick, kind: v > 0 ? 'on' : 'off', ch, note: n, vel: v, order: eventOrder++ }); }
            else if (type === 0xA0) { const note = readDataByte(end); const val = readDataByte(end); events.push({ tick, kind: 'polyPressure', ch, note, val, order: eventOrder++ }); }
            else if (type === 0xB0) { const cc = readDataByte(end); const val = readDataByte(end); events.push({ tick, kind: 'cc', ch, cc, val, order: eventOrder++ }); }
            else if (type === 0xC0) { const prog = readDataByte(end); events.push({ tick, kind: 'pc', ch, program: prog, order: eventOrder++ }); }
            else if (type === 0xD0) { events.push({ tick, kind: 'pressure', ch, val: readDataByte(end), order: eventOrder++ }); }
            else if (type === 0xE0) { const l = readDataByte(end); const m = readDataByte(end); events.push({ tick, kind: 'pb', ch, val: ((m << 7) | l) - 8192, order: eventOrder++ }); }
            else if (status === 0xFF) { 
                if (ptr >= end) throw new Error('Truncated MIDI meta event');
                const mt = b[ptr++]; const ml = readVLQ_BE(end);
                if (ptr + ml > end) throw new Error('MIDI meta event exceeds its track');
                if (mt === 0x51 && ml !== 3) throw new Error('MIDI tempo event must contain three bytes');
                if (mt === 0x2F) {
                    if (ml !== 0) throw new Error('Invalid MIDI end-of-track event');
                    ptr = end;
                    break;
                }
                if (mt === 0x51) {
                    const mpqn = (b[ptr] << 16) | (b[ptr + 1] << 8) | b[ptr + 2];
                    if (mpqn === 0) throw new Error('MIDI tempo event has an invalid zero tempo');
                    tempos.push({ tick, mpqn });
                }
                ptr += ml;
            } else if (status === 0xF0 || status === 0xF7) {
                const eventLength = readVLQ_BE(end);
                if (ptr + eventLength > end) throw new Error('MIDI SysEx event exceeds its track');
                ptr += eventLength;
            } else {
                throw new Error(`Unsupported MIDI status byte 0x${status.toString(16)}`);
            }
        }
    }
    return {
        // Preserve authored order, including zero-length on/off pairs and
        // controller changes between same-tick notes. Track order breaks ties.
        events: events.sort((a: any, b: any) => a.tick - b.tick || a.order - b.order),
        tempos: tempos.sort((a:any, b:any) => a.tick - b.tick),
        ppq
    };
}

const midiNoteToHz = (note: number) => 440 * Math.pow(2, (note - 69) / 12);


export interface MidiSidOptions {
    clock?: number;
    filename?: string;
    reduction?: MidiReductionMode;
    arpeggioHz?: number;
    coupledEffects?: boolean;
}
class ChannelState {
    program = 0; patch = getPatch(0);
    pb = 0; mod = 0; pressure = 0; volume = 100; expression = 127;
    sustain = false; sostenuto = false; soft = false;
    brightness: number | null = null; resonance: number | null = null;
    attack: number | null = null; decay: number | null = null; release: number | null = null;
    vibratoRate = 5; vibratoDepth = 0.5; vibratoDelay = 0;
    rpnMsb = 127; rpnLsb = 127;
    parameters = new Map<number, [number, number]>([[0, [2, 0]], [1, [64, 0]], [2, [64, 0]]]);
    phase = 0;
    get gain() { return this.volume / 127 * this.expression / 127 * (this.soft ? 0.7 : 1); }
    get bendRange() { const p = this.parameters.get(0)!; return p[0] + Math.min(99, p[1]) / 100; }
    get tuning() { const f = this.parameters.get(1)!; return ((f[0] * 128 + f[1]) - 8192) / 8192 + this.parameters.get(2)![0] - 64; }
}
interface HeldNote extends ReductionNote {
    patch: SidPatch;
    pressure: number;
    sostenuto: boolean;
    pitch: number;
}
interface Slot {
    note: HeldNote | null;
    releaseUntil: number;
    source: boolean;
}
const ADSR_CYCLES = [9,32,63,95,149,220,267,313,392,977,1954,3126,3907,11720,19532,31251];

export async function compileMidiToSidTrace(midiData: ArrayBuffer, options: MidiSidOptions = {}): Promise<ParsedTrace> {
    const { events, ppq, tempos } = parseSmfLocal(midiData);
    if (!events.some(e => e.kind === 'on')) throw new Error('MIDI file contains no note events to convert');
    const clock = options.clock ?? CLOCK_PAL;
    if (!Number.isSafeInteger(clock) || clock < 100000 || clock > 2000000) throw new Error('MIDI conversion requires a SID clock between 100000 and 2000000 Hz');
    const reduction = options.reduction ?? 'balanced';
    if (reduction !== 'balanced' && reduction !== 'arpeggio') throw new Error('Unknown MIDI reduction mode');
    const arpHz = options.arpeggioHz ?? 12;
    if (!Number.isFinite(arpHz) || arpHz < 1 || arpHz > 50) throw new Error('Arpeggio rate must be between 1 and 50 Hz');
    const coupledEffects = options.coupledEffects ?? true;
    const fps = clock >= 1000000 ? 60 : 50;

    // Tempo integration uses rational tick intervals; integer rounding happens
    // only at the final SID-cycle boundary, never at intermediate video frames.
    let tick = 0, seconds = 0, mpqn = 500000, tempoIndex = 0;
    const cycleEvents = events.map(e => {
        while (tempoIndex < tempos.length && tempos[tempoIndex].tick <= e.tick) {
            const t = tempos[tempoIndex++];
            seconds += (t.tick - tick) * mpqn / (ppq * 1000000);
            tick = t.tick; mpqn = t.mpqn;
        }
        seconds += (e.tick - tick) * mpqn / (ppq * 1000000);
        tick = e.tick;
        return { ...e, cycle: Math.round(seconds * clock) };
    });
    const last = cycleEvents.at(-1)!.cycle;
    const autoRelease = last + Math.ceil(clock / fps);
    // Retain enough tail for the slowest supported SID release. This is bounded
    // after compilation below by the actual releases, not a fixed long hold.
    if (!Number.isSafeInteger(autoRelease) || autoRelease > clock * 600) throw new Error('MIDI import exceeds the 10-minute safety limit');

    const channels = Array.from({ length: 16 }, () => new ChannelState());
    const held = new Map<number, HeldNote>();
    const slots: Slot[] = Array.from({ length: 3 }, () => ({ note: null, releaseUntil: 0, source: false }));
    const regs = new Array(32).fill(0);
    const traceEvents: SidEvent[] = [], frames: number[][] = [];
    const heard = new Set<number>(), folded = new Set<number>(), restored = new Set<number>();
    const report = { inputNotes: 0, soundedNotes: 0, omittedNotes: 0, peakPolyphony: 0, voiceSteals: 0, restoredNotes: 0, octaveFoldedNotes: 0, coupledUpdates: 0, reduction };
    const drum = new DrumProcessor(1);
    let drumId = -1, drumEnd = 0, drumGateEnd = 0;
    const drumQueue: { id: number; key: number }[] = [];
    let serial = 0, current = 0, eventIndex = 0, frameIndex = 0, controlIndex = 0, arpIndex = 0;
    let nextFrame = 0, nextControl = 0, nextArp = 0, released = false;
    let previousCycle = 0, iterations = 0;

    const emit = (reg: number, value: number, force = false) => {
        const byte = Math.round(value) & 255;
        if (force || regs[reg] !== byte) {
            if (traceEvents.length >= 2000000) throw new Error('MIDI conversion exceeds the register-write safety limit');
            regs[reg] = byte; traceEvents.push({ cycles: current, reg, val: byte });
        }
    };
    const releaseLength = (index: number) => ADSR_CYCLES[regs[index * 7 + 6] & 15] * 756;
    const clearSlot = (index: number, immediate = false) => {
        const slot = slots[index], off = index * 7;
        if (slot.note) {
            emit(off + 4, immediate ? 0 : regs[off + 4] & 0xFE);
            slot.releaseUntil = immediate ? current : current + releaseLength(index);
            // Keep patch ownership during release so the shared filter doesn't
            // abruptly dump a filtered envelope into the unfiltered path.
            if (immediate) slot.note = null;
        }
    };
    const removeReleased = (channel: number) => {
        const ch = channels[channel];
        for (const [id, n] of held) if (n.channel === channel && !n.down && !ch.sustain && !n.sostenuto) held.delete(id);
    };
    const controller = (e: any) => {
        const ch = channels[e.ch];
        switch (e.cc) {
            case 1: ch.mod = e.val; break;
            case 7: ch.volume = e.val; break;
            case 11: ch.expression = e.val; break;
            case 64: ch.sustain = e.val >= 64; removeReleased(e.ch); break;
            case 66:
                if (e.val >= 64 && !ch.sostenuto) for (const n of held.values()) if (n.channel === e.ch && n.down) n.sostenuto = true;
                ch.sostenuto = e.val >= 64;
                if (!ch.sostenuto) { for (const n of held.values()) if (n.channel === e.ch) n.sostenuto = false; removeReleased(e.ch); }
                break;
            case 67: ch.soft = e.val >= 64; break;
            case 71: ch.resonance = e.val; break;
            case 72: ch.release = e.val; break;
            case 73: ch.attack = e.val; break;
            case 74: ch.brightness = e.val; break;
            case 75: ch.decay = e.val; break;
            case 76: ch.vibratoRate = 0.5 + e.val / 127 * 11.5; break;
            case 77: ch.vibratoDepth = e.val / 127 * 2; break;
            case 78: ch.vibratoDelay = e.val / 127 * 2; break;
            case 101: ch.rpnMsb = e.val; break;
            case 100: ch.rpnLsb = e.val; break;
            case 99: case 98: ch.rpnMsb = 127; ch.rpnLsb = 127; break; // NRPN selection cancels RPN.
            case 6: case 38: case 96: case 97: {
                if (ch.rpnMsb !== 0 || !ch.parameters.has(ch.rpnLsb)) break;
                const p = ch.parameters.get(ch.rpnLsb)!;
                if (e.cc === 6) p[0] = e.val;
                else if (e.cc === 38) p[1] = e.val;
                else if (ch.rpnLsb === 1) {
                    const value = CLAMP(p[0] * 128 + p[1] + (e.cc === 96 ? 1 : -1), 0, 16383);
                    p[0] = value >> 7; p[1] = value & 127;
                } else p[0] = CLAMP(p[0] + (e.cc === 96 ? 1 : -1), 0, 127);
                break;
            }
            case 120:
                for (const [id, n] of held) if (n.channel === e.ch) held.delete(id);
                slots.forEach((s, i) => { if (s.note?.channel === e.ch) clearSlot(i, true); });
                if (e.ch === 9) { drum.voices[0].active = false; drumId = -1; emit(18, 0); }
                break;
            case 123:
                for (const n of held.values()) if (n.channel === e.ch) n.down = false;
                removeReleased(e.ch);
                if (e.ch === 9) drum.release(0);
                break;
            case 121: {
                // Volume, program and registered tuning are not reset by CC121.
                const reset = new ChannelState();
                reset.volume = ch.volume; reset.program = ch.program; reset.patch = ch.patch; reset.parameters = ch.parameters;
                channels[e.ch] = reset;
                for (const n of held.values()) if (n.channel === e.ch) n.sostenuto = false;
                removeReleased(e.ch);
                break;
            }
        }
    };
    const registerFrequency = (pitch: number) => CLAMP(Math.round(midiNoteToHz(pitch) * 16777216 / clock), 1, 65535);
    const pitchFor = (n: HeldNote) => {
        const ch = channels[n.channel];
        const amount = Math.max(ch.mod, ch.pressure, n.pressure) / 127;
        const vibrato = current - n.start >= ch.vibratoDelay * clock
            ? Math.sin(ch.phase) * Math.max(ch.vibratoDepth, n.patch.vibDepth ?? 0) * amount : 0;
        const bend = ch.pb / (ch.pb < 0 ? 8192 : 8191) * ch.bendRange;
        return n.pitch + ch.tuning + bend + vibrato;
    };
    const envelope = (n: HeldNote, index: number) => {
        const ch = channels[n.channel], p = n.patch;
        const setting = (cc: number | null, base: number) => cc === null ? base : CLAMP(Math.round(base + (cc - 64) / 8), 0, 15);
        const strength = n.velocity / 127 * ch.gain;
        const a = setting(ch.attack, p.atk);
        // For zero-sustain plucks, velocity affects decay rather than multiplying zero.
        const d = setting(ch.decay, p.sus === 0 ? CLAMP(p.dec - Math.round((1 - strength) * 3), 0, 15) : p.dec);
        const s = Math.round(p.sus * strength), r = setting(ch.release, p.rel);
        emit(index * 7 + 5, a * 16 + d);
        emit(index * 7 + 6, CLAMP(s, 0, 15) * 16 + r);
    };

    emit(24, 15, true);
    while (true) {
        const elapsed = (current - previousCycle) / clock;
        for (const ch of channels) ch.phase = (ch.phase + elapsed * ch.vibratoRate * Math.PI * 2) % (Math.PI * 2);
        previousCycle = current;
        // Advance an old drum before processing new triggers; a new hit starts at age zero.
        let drumOutput = drumId >= 0 ? drum.process(0, elapsed, clock) : null;
        if (drumId >= 0 && current >= drumGateEnd) { drum.release(0); drumOutput = drum.process(0, 0, clock); }
        if (drumId >= 0 && (current >= drumEnd || !drum.voices[0].active)) {
            emit(18, 0); drum.voices[0].active = false; drumId = -1; drumOutput = null;
            slots[2] = { note: null, releaseUntil: 0, source: false };
        }

        // A single percussion oscillator cannot play a simultaneous kit chord.
        // Resolve the whole cycle before triggering so file ordering cannot let
        // a quiet hi-hat erase the kick or inflate the retained-note report.
        const pendingDrums = new Map<number, { id: number; key: number; velocity: number }>();
        while (eventIndex < cycleEvents.length && cycleEvents[eventIndex].cycle <= current) {
            const e = cycleEvents[eventIndex++];
            const ch = channels[e.ch];
            if (e.kind === 'pc') { ch.program = e.program; ch.patch = getPatch(e.program); }
            else if (e.kind === 'cc') {
                controller(e);
                if (e.ch === 9) {
                    if (e.cc === 120 || e.cc === 123) pendingDrums.clear();
                    if (drumId >= 0) drumOutput = drum.process(0, 0, clock);
                }
            }
            else if (e.kind === 'pb') ch.pb = e.val;
            else if (e.kind === 'pressure') ch.pressure = e.val;
            else if (e.kind === 'polyPressure') { for (const n of held.values()) if (n.channel === e.ch && n.key === e.note) n.pressure = e.val; }
            else if (e.ch === 9) {
                if (e.kind === 'on') {
                    const id = serial++; report.inputNotes++;
                    if (drumQueue.length >= 4096) throw new Error('Too many unmatched percussion notes');
                    drumQueue.push({ id, key: e.note });
                    pendingDrums.set(id, { id, key: e.note, velocity: e.vel });
                } else if (e.kind === 'off') {
                    const q = drumQueue.findIndex(n => n.key === e.note);
                    if (q >= 0) {
                        const id = drumQueue.splice(q, 1)[0].id;
                        pendingDrums.delete(id);
                        if (id === drumId) { drum.release(0); drumOutput = drum.process(0, 0, clock); }
                    }
                }
            } else if (e.kind === 'on') {
                if (held.size >= 4096) throw new Error('Too many simultaneous MIDI notes');
                const id = serial++; report.inputNotes++;
                let pitch = e.note;
                while (midiNoteToHz(pitch) * 16777216 / clock > 65535) pitch -= 12;
                if (pitch !== e.note) folded.add(id);
                held.set(id, { id, channel: e.ch, key: e.note, velocity: e.vel, start: current,
                    down: true, sostenuto: false, pressure: 0, program: ch.program, patch: ch.patch, pitch });
            } else if (e.kind === 'off') {
                // Match source-note instances, including notes currently omitted
                // by the reduction. Never let a stale note-off cut a newer steal.
                const n = [...held.values()].find(n => n.channel === e.ch && n.key === e.note && n.down);
                if (n) { n.down = false; if (!ch.sustain && !n.sostenuto) held.delete(n.id); }
            }
        }
        const drumPriority = (key: number) => [35,36].includes(key) ? 6 : [38,40].includes(key) ? 5
            : [39,41,43,45,47,48,50].includes(key) ? 4 : [49,51,52,55,57,59].includes(key) ? 3
            : [42,44,46].includes(key) ? 1 : 2;
        const hit = [...pendingDrums.values()].filter(n => Math.round(n.velocity * channels[9].gain) > 0)
            .sort((a, b) => drumPriority(b.key) - drumPriority(a.key)
            || b.velocity - a.velocity || a.key - b.key || a.id - b.id)[0];
        if (hit && Math.round(hit.velocity * channels[9].gain) > 0) {
            // Each hit has bounded occupancy, after which held melody returns.
            clearSlot(2, true); emit(18, 0, true);
            drum.trigger(0, hit.key, Math.round(hit.velocity * channels[9].gain)); drumId = hit.id;
            const type = drum.voices[0].patch!.type;
            const gateSeconds = type === 'CRASH' ? 0.6 : type === 'HAT_OPEN' ? 0.22 : type === 'HAT_CLOSED' ? 0.035 : 0.12;
            drumGateEnd = current + Math.round(clock * gateSeconds);
            drumEnd = drumGateEnd + Math.round(clock * (type === 'CRASH' ? 0.3 : 0.12));
            drumOutput = drum.process(0, 0, clock);
        }
        if (!released && current >= autoRelease) { held.clear(); drum.release(0); if (drumId >= 0) drumOutput = drum.process(0, 0, clock); released = true; }

        const pool = [...held.values()].filter(n => channels[n.channel].gain > 0);
        report.peakPolyphony = Math.max(report.peakPolyphony, pool.length + (drumId >= 0 ? 1 : 0));
        const sounding = new Set(slots.filter(s => s.note && (regs[slots.indexOf(s) * 7 + 4] & 1)).map(s => s.note!.id));
        const desired = selectSidNotes(pool, drumId >= 0 ? 2 : 3, sounding, reduction, Math.floor(current * arpHz / clock));
        const wanted = new Set(desired.map(n => n.id));
        for (let i = 0; i < 3; i++) {
            if (i === 2 && drumId >= 0) continue;
            const s = slots[i];
            if (s.source) { emit(i * 7 + 4, 0); s.source = false; }
            if (s.note && !wanted.has(s.note.id) && (regs[i * 7 + 4] & 1)) {
                const muted = channels[s.note.channel].gain === 0;
                clearSlot(i, muted);
            }
            if (s.note && !(regs[i * 7 + 4] & 1) && current >= s.releaseUntil) { emit(i * 7 + 4, 0); s.note = null; }
        }
        // Reserve a suitable pair for effects only with spare capacity.
        const assigning = [...desired].sort((a, b) => Number(!!b.patch.coupled) - Number(!!a.patch.coupled) || a.key - b.key);
        for (const n of assigning) {
            let index = slots.findIndex((s, i) => s.note?.id === n.id && (regs[i * 7 + 4] & 1) && !(i === 2 && drumId >= 0));
            if (index >= 0) continue;
            const free = slots.map((s, i) => ({ s, i })).filter(({ s, i }) => !(i === 2 && drumId >= 0) && (!s.note || !wanted.has(s.note.id) || !(regs[i * 7 + 4] & 1)));
            free.sort((a, b) => Number(!!a.s.note) - Number(!!b.s.note) || a.s.releaseUntil - b.s.releaseUntil || a.i - b.i);
            if (!free.length) continue;
            index = free[0].i;
            const old = slots[index].note;
            if (old && held.has(old.id) && old.id !== n.id) report.voiceSteals++;
            if (heard.has(n.id)) restored.add(n.id);
            heard.add(n.id);
            // Always establish a real gate transition before reusing an envelope.
            emit(index * 7 + 4, 0, true);
            slots[index] = { note: n, releaseUntil: 0, source: false };
            envelope(n, index);
            const f = registerFrequency(pitchFor(n));
            emit(index * 7, f & 255); emit(index * 7 + 1, f >> 8);
            emit(index * 7 + 4, (n.patch.wave & 0xF0) | 1, true);
        }

        let source3Off = false;
        for (let i = 0; i < 3; i++) {
            const s = slots[i], n = s.note;
            if (!n || !(regs[i * 7 + 4] & 1) || (i === 2 && drumId >= 0)) continue;
            const ch = channels[n.channel], p = n.patch;
            let frequency = registerFrequency(pitchFor(n)), ctrl = (p.wave & 0xF0) | 1;
            const sourceIndex = (i + 2) % 3, source = slots[sourceIndex];
            if (coupledEffects && frequency <= 32767 && p.coupled && drumId < 0 && !source.note && !source.source && !s.source) {
                // Ring needs triangle; sync uses a pitched source and a brighter slave.
                const sourceFrequency = p.coupled === 'ring' ? Math.min(65535, frequency * 2) : frequency;
                if (p.coupled === 'sync') { frequency = Math.min(65535, frequency * 2); ctrl |= 2; }
                else ctrl = 0x15;
                source.source = true;
                emit(sourceIndex * 7, sourceFrequency & 255); emit(sourceIndex * 7 + 1, sourceFrequency >> 8);
                emit(sourceIndex * 7 + 4, 0);
                source3Off ||= sourceIndex === 2;
                report.coupledUpdates++;
            }
            emit(i * 7, frequency & 255); emit(i * 7 + 1, frequency >> 8);
            envelope(n, i);
            if (p.wave & 0x40) {
                const strength = n.velocity / 127 * ch.gain;
                const depth = 32 + Math.max(ch.mod, ch.pressure, n.pressure) * 3;
                const pw = CLAMP(Math.round(p.pw * (0.55 + strength * 0.45) + Math.sin(ch.phase) * depth), 32, 4063);
                emit(i * 7 + 2, pw & 255); emit(i * 7 + 3, pw >> 8);
            }
            emit(i * 7 + 4, ctrl);
        }
        if (drumId >= 0 && drumOutput) {
            if (channels[9].gain === 0) { emit(18, 0); drumId = -1; drum.voices[0].active = false; }
            else {
                const d = drumOutput;
                if (d.ctrl & 1) heard.add(drumId);
                emit(14, d.freq & 255); emit(15, d.freq >> 8);
                emit(16, d.pw & 255); emit(17, d.pw >> 8);
                emit(19, d.adsr.a * 16 + d.adsr.d); emit(20, d.adsr.s * 16 + d.adsr.r); emit(18, d.ctrl);
            }
        }

        // There is ONE analog filter, not a filter per MIDI channel. Blend
        // requested settings by note strength and retain release-tail routing.
        let route = 0, weight = 0, cutoff = 0, resonance = 0, mode = 1, ownerWeight = -1;
        for (let i = 0; i < 3; i++) {
            const n = slots[i].note;
            if (!n || (i === 2 && drumId >= 0)) continue;
            const ch = channels[n.channel], p = n.patch;
            if (!p.filter && ch.brightness === null && ch.resonance === null) continue;
            const w = Math.max(0.01, n.velocity / 127 * ch.gain);
            route |= 1 << i; weight += w;
            const pressure = Math.max(n.pressure, ch.pressure) / 127;
            cutoff += CLAMP((p.cutoff ?? 1400) * Math.pow(2, ((ch.brightness ?? 64) - 64) / 48) + pressure * 160, 0, 2047) * w;
            resonance += (ch.resonance === null ? (p.resonance ?? 0) : ch.resonance / 127 * 15) * w;
            if (w > ownerWeight) { mode = p.filterMode ?? 1; ownerWeight = w; }
        }
        const cut = weight ? Math.round(cutoff / weight) : 0;
        emit(21, cut & 7); emit(22, cut >> 3);
        emit(23, (weight ? Math.round(resonance / weight) << 4 : 0) | route);
        emit(24, 15 | (route ? mode << 4 : 0) | (source3Off ? 128 : 0));

        if (current >= nextFrame) { frames.push([...regs]); nextFrame = Math.floor(++frameIndex * clock / fps); }
        if (current >= nextControl) nextControl = Math.floor(++controlIndex * clock / 200);
        if (current >= nextArp) nextArp = Math.ceil(++arpIndex * clock / arpHz);
        const tailEnd = Math.max(autoRelease + Math.ceil(clock * 0.2), ...slots.map(s => s.releaseUntil), drumId >= 0 ? drumEnd : 0);
        if (released && current >= tailEnd) break;
        const milestones = [nextFrame, nextControl, cycleEvents[eventIndex]?.cycle ?? Infinity, released ? tailEnd : autoRelease];
        if (reduction === 'arpeggio') milestones.push(nextArp);
        if (drumId >= 0) milestones.push(drumGateEnd, drumEnd);
        for (const s of slots) if (s.note && !(regs[slots.indexOf(s) * 7 + 4] & 1)) milestones.push(s.releaseUntil);
        current = Math.min(...milestones.filter(c => c > current));
        if (!Number.isSafeInteger(current)) throw new Error('Invalid MIDI conversion timeline');
        // Avoid monopolizing the UI for the full duration of a long conversion.
        if (++iterations % 4096 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    report.soundedNotes = heard.size; report.omittedNotes = report.inputNotes - heard.size;
    report.octaveFoldedNotes = folded.size; report.restoredNotes = restored.size;
    return { header: { clock, fps, song: options.filename || 'MIDI Import', originalFilename: options.filename, midiReduction: report },
        frames, events: traceEvents };
}
