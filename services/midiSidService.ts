
import { ParsedTrace, SidEvent } from '../types';
import { CLOCK_PAL, SID_REG } from './sidService';
import { DrumProcessor } from './drumProcessor';

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
}

// Tighter envelope defaults to prevent mud
const DEFAULT_PATCH: SidPatch = { name: "Default", wave: 0x40, atk: 0, dec: 8, sus: 10, rel: 4, pw: 0x800, filter: false };

const GM_PRESETS: Record<number, SidPatch> = {
    0: { name: "Grand Piano", wave: 0x40, atk: 0, dec: 9, sus: 0, rel: 6, pw: 0x400, filter: false },
    11: { name: "Vibraphone", wave: 0x10, atk: 0, dec: 5, sus: 12, rel: 5, pw: 0, filter: false, vibDepth: 0.5 },
    16: { name: "Drawbar", wave: 0x41, atk: 1, dec: 0, sus: 15, rel: 2, pw: 0x800, filter: false },
    19: { name: "Church", wave: 0x10, atk: 4, dec: 4, sus: 15, rel: 6, pw: 0, filter: true, cutoff: 0x3C0, resonance: 8 },
    25: { name: "Steel Gtr", wave: 0x20, atk: 0, dec: 8, sus: 10, rel: 5, pw: 0, filter: false },
    29: { name: "Overdrive", wave: 0x41, atk: 0, dec: 9, sus: 12, rel: 4, pw: 0x600, filter: true, cutoff: 0x520, resonance: 4 },
    33: { name: "Finger Bass", wave: 0x10, atk: 0, dec: 6, sus: 12, rel: 4, pw: 0x200, filter: true, cutoff: 0x2C0, resonance: 2 },
    38: { name: "Synth Bass 1", wave: 0x20, atk: 0, dec: 8, sus: 10, rel: 4, pw: 0, filter: true, cutoff: 0x300, resonance: 6 },
    40: { name: "Violin", wave: 0x20, atk: 5, dec: 6, sus: 10, rel: 5, pw: 0, filter: false, vibDepth: 0.8 },
    48: { name: "Strings", wave: 0x41, atk: 8, dec: 4, sus: 12, rel: 8, pw: 0x800, filter: false },
    80: { name: "Square Lead", wave: 0x40, atk: 1, dec: 5, sus: 12, rel: 4, pw: 0x800, filter: false },
    81: { name: "Saw Lead", wave: 0x21, atk: 1, dec: 5, sus: 12, rel: 4, pw: 0, filter: true, cutoff: 0x600, resonance: 5 },
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
            if (ptr >= end) break;
            
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
            else if (type === 0xA0) { readDataByte(end); readDataByte(end); }
            else if (type === 0xB0) { const cc = readDataByte(end); const val = readDataByte(end); events.push({ tick, kind: 'cc', ch, cc, val, order: eventOrder++ }); }
            else if (type === 0xC0) { const prog = readDataByte(end); events.push({ tick, kind: 'pc', ch, program: prog, order: eventOrder++ }); }
            else if (type === 0xD0) { readDataByte(end); }
            else if (type === 0xE0) { const l = readDataByte(end); const m = readDataByte(end); events.push({ tick, kind: 'pb', ch, val: ((m << 7) | l) - 8192, order: eventOrder++ }); }
            else if (status === 0xFF) { 
                if (ptr >= end) throw new Error('Truncated MIDI meta event');
                const mt = b[ptr++]; const ml = readVLQ_BE(end);
                if (ptr + ml > end) throw new Error('MIDI meta event exceeds its track');
                if (mt === 0x51 && ml === 3) {
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
    const priority = (kind: string) => kind === 'cc' || kind === 'pc' || kind === 'pb' ? 0 : kind === 'off' ? 1 : 2;
    return {
        events: events.sort((a: any, b: any) => a.tick - b.tick || priority(a.kind) - priority(b.kind) || a.order - b.order),
        tempos: tempos.sort((a:any, b:any) => a.tick - b.tick),
        ppq
    };
}

const midiNoteToHz = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

class ChannelState {
    patch: SidPatch = DEFAULT_PATCH;
    pb = 0; modWheel = 0; sustain = false; lfoPhase = 0;
    // General MIDI defaults: channel volume 100, expression 127.
    volume = 100;
    expression = 127;
    // MIDI defaults to a ±2-semitone bend range. RPN 0,0 plus data-entry
    // controllers may replace it with the range authored by the sequence.
    rpnMsb = 127;
    rpnLsb = 127;
    dataEntryMsb = 2;
    dataEntryLsb = 0;
    pitchBendRange = 2;

    get gain() {
        return (this.volume * this.expression) / (127 * 127);
    }
}

class VoiceState {
    channelIdx = -1; note = -1; freq = 0; pw = 0; ctrl = 0; adsr = 0;
    gate = false; isDrum = false; pendingRelease = false;
    // A MIDI program change applies to future note-ons. Keep the selected
    // patch on the voice so an already sounding note is not retroactively
    // rewritten when its channel changes program.
    patch: SidPatch = DEFAULT_PATCH;
    velocity = 127;
    lastTriggerOrder = 0;
}

export async function compileMidiToSidTrace(midiData: ArrayBuffer, options: { clock?: number; filename?: string }): Promise<ParsedTrace> {
    const { events, ppq, tempos } = parseSmfLocal(midiData);
    if (!events.some(event => event.kind === 'on' || event.kind === 'off')) {
        throw new Error('MIDI file contains no note events to convert');
    }
    const clock = options.clock ?? CLOCK_PAL;
    if (!Number.isSafeInteger(clock) || clock <= 0) {
        throw new Error('MIDI conversion requires a positive integer SID clock');
    }
    const fps = clock >= 1_000_000 ? 60 : 50;
    // Keep the simulation advancing even for diagnostic clocks below the video
    // rate. Real PAL/NTSC clocks remain unchanged by this guard.
    const cyclesPerFrame = Math.max(1, Math.floor(clock / fps));
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

    const lastInputCycle = cycleEvents.length > 0 ? cycleEvents[cycleEvents.length - 1].absCycles : 0;
    // A missing final note-off is malformed MIDI, not an instruction to hold a
    // note for an arbitrary second. Keep it alive for one video frame so the
    // trigger is observable/audible, then enter the normal SID release phase.
    // Valid MIDI note-offs are processed at their exact event cycles.
    const autoReleaseCycle = lastInputCycle + cyclesPerFrame;
    const releaseTailCycles = Math.max(Math.floor(clock * 0.2), cyclesPerFrame * 2);
    const totalDurationCycles = autoReleaseCycle + releaseTailCycles;
    const maxDurationCycles = clock * 600;
    if (!Number.isSafeInteger(totalDurationCycles) || totalDurationCycles > maxDurationCycles) {
        throw new Error('MIDI import exceeds the 10-minute safety limit');
    }
    
    const channels = Array.from({length: 16}, () => new ChannelState());
    const voices = Array.from({length: 3}, () => new VoiceState());
    const drumProc = new DrumProcessor(1);
    
    const traceEvents: SidEvent[] = [];
    const frames: number[][] = [];
    let filterCutoff = 0;
    let filterResRoute = 0;
    let filterModeVolume = 0x0F;
    let nextTriggerOrder = 0;
    
    let currentCycle = 0;
    let nextFrameCycle = 0;
    let nextFrameIndex = 0;
    let eventIdx = 0;
    let autoReleaseDone = false;

    const emit = (c: number, r: number, v: number) => {
        traceEvents.push({ cycles: Math.floor(c), reg: r, val: v & 0xFF });
    };

    const refreshFilter = () => {
        // SID filter registers are global. Route every currently gated voice
        // whose *captured* program patch uses the filter. The most recently
        // triggered filtered voice owns the single cutoff/resonance setting.
        const filtered = voices
            .map((voice, index) => ({ voice, index }))
            .filter(({ voice }) => !voice.isDrum && voice.gate && voice.patch.filter);
        const nextModeVolume = filtered.length > 0 ? 0x1F : 0x0F;
        const latest = filtered.reduce<typeof filtered[number] | undefined>((selected, candidate) =>
            !selected || candidate.voice.lastTriggerOrder > selected.voice.lastTriggerOrder ? candidate : selected,
        undefined);
        const nextRoute = filtered.reduce((route, { index }) => route | (1 << index), 0)
            | (((latest?.voice.patch.resonance ?? 0) & 0x0F) << 4);
        const nextCutoff = latest
            ? CLAMP(Math.round(latest.voice.patch.cutoff ?? 0x400), 0, 0x7FF)
            : 0;

        if (nextCutoff !== filterCutoff) {
            filterCutoff = nextCutoff;
            emit(currentCycle, SID_REG.FC_LO, filterCutoff & 0x07);
            emit(currentCycle, SID_REG.FC_HI, filterCutoff >> 3);
        }
        if (nextRoute !== filterResRoute) {
            filterResRoute = nextRoute;
            emit(currentCycle, SID_REG.RES_FILT, filterResRoute);
        }
        if (nextModeVolume !== filterModeVolume) {
            filterModeVolume = nextModeVolume;
            emit(currentCycle, SID_REG.MODE_VOL, filterModeVolume);
        }
    };

    // MIDI has no SID master-volume equivalent. Set $D418 explicitly so the
    // generated voice events are audible in a fresh SID register state.
    emit(0, SID_REG.MODE_VOL, 0x0F);

    const handleNoteOff = (chIdx: number, note: number) => {
        const ch = channels[chIdx];
        // MIDI permits overlapping instances of the same note on one channel.
        // Release exactly the oldest matching voice (FIFO) rather than cutting
        // every matching note at once.
        const match = voices
            .map((voice, index) => ({ voice, index }))
            .filter(({ voice }) => !voice.isDrum && voice.gate && voice.channelIdx === chIdx && voice.note === note)
            .sort((a, b) => a.voice.lastTriggerOrder - b.voice.lastTriggerOrder)[0];
        if (!match) return;
        if (ch.sustain) {
            match.voice.pendingRelease = true;
            return;
        }
        match.voice.gate = false;
        const off = match.index * 7;
        const ctrl = match.voice.ctrl & 0xFE;
        emit(currentCycle, off + SID_REG.V1_CTRL, ctrl);
        match.voice.ctrl = ctrl;
        refreshFilter();
    };

    const updateVoiceEnvelope = (voice: VoiceState, index: number) => {
        if (voice.isDrum || !voice.gate || voice.channelIdx < 0) return;
        const channel = channels[voice.channelIdx];
        const velocityScale = (0.35 + (0.65 * (voice.velocity / 127))) * channel.gain;
        const sustain = CLAMP(Math.round(voice.patch.sus * velocityScale), 0, 15);
        const adsr = (voice.patch.atk << 12) | (voice.patch.dec << 8) | (sustain << 4) | voice.patch.rel;
        if (adsr === voice.adsr) return;
        const off = index * 7;
        if ((adsr >> 8) !== (voice.adsr >> 8)) emit(currentCycle, off + SID_REG.V1_AD, adsr >> 8);
        if ((adsr & 0xFF) !== (voice.adsr & 0xFF)) emit(currentCycle, off + SID_REG.V1_SR, adsr & 0xFF);
        voice.adsr = adsr;
    };

    const updateChannelEnvelopes = (channelIndex: number) => {
        voices.forEach((voice, index) => {
            if (voice.channelIdx === channelIndex) updateVoiceEnvelope(voice, index);
        });
    };

    const releaseChannelVoices = (channelIndex: number, honorSustain: boolean) => {
        const channel = channels[channelIndex];
        let released = false;
        voices.forEach((voice, index) => {
            if (voice.isDrum || !voice.gate || voice.channelIdx !== channelIndex) return;
            if (honorSustain && channel.sustain) {
                voice.pendingRelease = true;
                return;
            }
            voice.gate = false;
            voice.pendingRelease = false;
            voice.ctrl &= 0xFE;
            emit(currentCycle, index * 7 + SID_REG.V1_CTRL, voice.ctrl);
            released = true;
        });
        if (released) refreshFilter();
    };

    const releaseAllVoices = () => {
        voices.forEach((voice, index) => {
            if (!voice.gate) return;
            voice.gate = false;
            voice.pendingRelease = false;
            const off = index * 7;
            voice.ctrl &= 0xFE;
            emit(currentCycle, off + SID_REG.V1_CTRL, voice.ctrl);
        });
        if (voices[2].isDrum) drumProc.release(0);
        refreshFilter();
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

        if (currentCycle >= nextEventCycle && eventIdx < cycleEvents.length) {
            while (eventIdx < cycleEvents.length && cycleEvents[eventIdx].absCycles <= currentCycle) {
                const e = cycleEvents[eventIdx++];
                
                if (e.ch === 9 && (e.kind === 'on' || e.kind === 'off')) {
                    if (e.kind === 'on') {
                        // Channel 10 reserves SID voice 3 while a drum is active.
                        // Stop any previously allocated melodic note before the drum
                        // takes ownership of those registers.
                        if (!voices[2].isDrum && voices[2].gate) {
                            emit(currentCycle, 14 + SID_REG.V1_CTRL, voices[2].ctrl & 0xFE);
                        }
                        drumProc.trigger(0, e.note, e.vel);
                        voices[2].isDrum = true;
                        voices[2].channelIdx = 9;
                        voices[2].note = e.note;
                        voices[2].gate = false;
                        voices[2].pendingRelease = false;
                        refreshFilter();
                    } else if (e.kind === 'off' && voices[2].isDrum && voices[2].note === e.note) {
                        // A channel-10 note-off belongs only to its matching
                        // percussion trigger. This prevents an older note-off
                        // from cutting a newer hit sharing SID voice 3.
                        drumProc.release(0);
                    }
                } else {
                    const ch = channels[e.ch];
                    if (e.kind === 'pc') ch.patch = getPatch(e.program);
                    else if (e.kind === 'cc') {
                        if (e.cc === 1) ch.modWheel = e.val;
                        else if (e.cc === 101) ch.rpnMsb = e.val;
                        else if (e.cc === 100) ch.rpnLsb = e.val;
                        else if (e.cc === 6) {
                            ch.dataEntryMsb = e.val;
                            if (ch.rpnMsb === 0 && ch.rpnLsb === 0) {
                                ch.pitchBendRange = ch.dataEntryMsb + (ch.dataEntryLsb / 100);
                            }
                        }
                        else if (e.cc === 38) {
                            ch.dataEntryLsb = e.val;
                            if (ch.rpnMsb === 0 && ch.rpnLsb === 0) {
                                ch.pitchBendRange = ch.dataEntryMsb + (ch.dataEntryLsb / 100);
                            }
                        }
                        else if (e.cc === 7) {
                            ch.volume = e.val;
                            updateChannelEnvelopes(e.ch);
                        }
                        else if (e.cc === 11) {
                            ch.expression = e.val;
                            updateChannelEnvelopes(e.ch);
                        }
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
                                refreshFilter();
                            }
                        }
                        else if (e.cc === 120) {
                            // All Sound Off bypasses sustain and immediately
                            // drops every melodic gate on the channel.
                            releaseChannelVoices(e.ch, false);
                            if (e.ch === 9) drumProc.release(0);
                        }
                        else if (e.cc === 123) {
                            // All Notes Off behaves like matching note-offs and
                            // therefore remains subject to the sustain pedal.
                            releaseChannelVoices(e.ch, true);
                            if (e.ch === 9) drumProc.release(0);
                        }
                        else if (e.cc === 121) {
                            // Reset All Controllers restores GM defaults. A
                            // pedal reset must release notes it had been holding.
                            const wasSustaining = ch.sustain;
                            ch.pb = 0;
                            ch.modWheel = 0;
                            ch.volume = 100;
                            ch.expression = 127;
                            ch.rpnMsb = 127;
                            ch.rpnLsb = 127;
                            ch.dataEntryMsb = 2;
                            ch.dataEntryLsb = 0;
                            ch.pitchBendRange = 2;
                            ch.sustain = false;
                            if (wasSustaining) {
                                voices.forEach((voice, index) => {
                                    if (voice.channelIdx === e.ch && voice.pendingRelease) {
                                        voice.gate = false;
                                        voice.pendingRelease = false;
                                        voice.ctrl &= 0xFE;
                                        emit(currentCycle, index * 7 + SID_REG.V1_CTRL, voice.ctrl);
                                    }
                                });
                                refreshFilter();
                            }
                            updateChannelEnvelopes(e.ch);
                        }
                    }
                    else if (e.kind === 'pb') ch.pb = e.val;
                    else if (e.kind === 'on') {
                        if (e.vel > 0) {
                            let candidates = voices.map((v, i) => ({v, i})).filter(c => !c.v.isDrum);
                            let pick = candidates.find(c => c.v.channelIdx === e.ch && c.v.note === e.note && !c.v.gate);
                            if (!pick) {
                                const freeVoices = candidates.filter(c => !c.v.gate);
                                if (freeVoices.length > 0) {
                                    freeVoices.sort((a, b) => a.v.lastTriggerOrder - b.v.lastTriggerOrder);
                                    pick = freeVoices[0];
                                }
                            }
                            if (!pick && candidates.length > 0) {
                                candidates.sort((a, b) => a.v.lastTriggerOrder - b.v.lastTriggerOrder);
                                pick = candidates[0];
                            }

                            if (pick) {
                                const vIdx = pick.i;
                                const v = voices[vIdx];
                                // Voice stealing must explicitly clear the old
                                // gate before replacing its pitch/envelope.
                                // Without this write, a stolen ADSR can remain
                                // logically held and make short notes sound stuck.
                                if (v.gate) {
                                    v.gate = false;
                                    v.pendingRelease = false;
                                    v.ctrl &= 0xFE;
                                    emit(currentCycle, vIdx * 7 + SID_REG.V1_CTRL, v.ctrl);
                                    refreshFilter();
                                }
                                v.channelIdx = e.ch;
                                v.note = e.note;
                                v.gate = true;
                                v.pendingRelease = false;
                                v.lastTriggerOrder = nextTriggerOrder++;
                                v.velocity = e.vel;
                                
                                const off = vIdx * 7;
                                const patch = ch.patch;
                                v.patch = patch;
                                const wf = patch.wave;
                                // SID has no per-voice velocity register. Map MIDI
                                // velocity onto sustain while retaining a usable floor
                                // and the selected patch's envelope shape.
                                const velocityScale = (0.35 + (0.65 * (e.vel / 127))) * ch.gain;
                                const sustain = CLAMP(Math.round(patch.sus * velocityScale), 0, 15);
                                const adsr = (patch.atk << 12) | (patch.dec << 8) | (sustain << 4) | patch.rel;
                                
                                emit(currentCycle, off + SID_REG.V1_AD, adsr >> 8);
                                emit(currentCycle, off + SID_REG.V1_SR, adsr & 0xFF);
                                emit(currentCycle, off + SID_REG.V1_PW_LO, patch.pw & 0xFF);
                                emit(currentCycle, off + SID_REG.V1_PW_HI, (patch.pw >> 8) & 0xF);

                                // Keep both sides of a hard restart in the same MIDI
                                // event slot. A delayed gate-on can otherwise occur
                                // after a same-tick or very short note-off and leave a
                                // SID voice permanently gated.
                                emit(currentCycle, off + SID_REG.V1_CTRL, wf & 0xFE);
                                emit(currentCycle, off + SID_REG.V1_CTRL, wf | 0x01);

                                v.ctrl = wf | 0x01;
                                v.adsr = adsr;
                                v.pw = patch.pw;
                                refreshFilter();
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

        if (!autoReleaseDone && currentCycle >= autoReleaseCycle) {
            releaseAllVoices();
            autoReleaseDone = true;
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

            if (!drumProc.voices[0].active) {
                if (voices[2].ctrl !== 0) emit(currentCycle, off + 4, 0);
                voices[2].isDrum = false;
                voices[2].channelIdx = -1;
                voices[2].ctrl = 0;
                voices[2].gate = false;
            }
        }

        voices.forEach((v, i) => {
            if (v.isDrum || v.channelIdx === -1) return;
            const ch = channels[v.channelIdx];
            const note = v.note;
            const vib = Math.sin(ch.lfoPhase) * (v.patch.vibDepth || 0) * (ch.modWheel / 127);
            const pb = (ch.pb / 8192) * ch.pitchBendRange;
            const hz = midiNoteToHz(note) * Math.pow(2, (pb + vib) / 12);
            const freqReg = Math.min(65535, Math.round((hz * 16777216) / clock));
            
            if (freqReg !== v.freq) {
                v.freq = freqReg;
                const off = i * 7;
                emit(currentCycle, off, v.freq & 0xFF);
                emit(currentCycle, off+1, v.freq >> 8);
            }
            
            const pwm = Math.sin(ch.lfoPhase * 0.5) * 50;
            const pwReg = CLAMP(Math.floor(v.patch.pw + pwm), 0, 4095);
            if (pwReg !== v.pw) {
                v.pw = pwReg;
                const off = i * 7;
                emit(currentCycle, off+2, v.pw & 0xFF);
                emit(currentCycle, off+3, v.pw >> 8);
            }
        });

        // Snapshot after event, drum, envelope, and pitch updates. Taking the
        // frame first made a note-on at an exact frame boundary appear one
        // frame late in tracker and piano-roll visualizations.
        if (currentCycle >= nextFrameCycle) {
            const regs = new Array(32).fill(0);
            voices.forEach((v, i) => {
                const off = i * 7;
                regs[off] = v.freq & 0xFF;
                regs[off + 1] = (v.freq >> 8) & 0xFF;
                regs[off + 2] = v.pw & 0xFF;
                regs[off + 3] = (v.pw >> 8) & 0x0F;
                regs[off + 4] = v.ctrl;
                regs[off + 5] = v.adsr >> 8;
                regs[off + 6] = v.adsr & 0xFF;
            });
            regs[SID_REG.FC_LO] = filterCutoff & 0x07;
            regs[SID_REG.FC_HI] = filterCutoff >> 3;
            regs[SID_REG.RES_FILT] = filterResRoute;
            regs[SID_REG.MODE_VOL] = filterModeVolume;
            frames.push(regs);
            nextFrameIndex++;
            // Use the exact rational clock/fps relationship. A fixed floored
            // interval drifts on NTSC clocks because 1,022,727 / 60 is not an
            // integer number of SID cycles.
            nextFrameCycle = Math.max(currentCycle + 1, Math.floor((nextFrameIndex * clock) / fps));
        }
    }

    return {
        header: { clock, fps, song: options.filename || "Midi Import", author: "SidStation Pro", copyright: "Auto-Gen", originalFilename: options.filename },
        frames, events: traceEvents.sort((a,b) => a.cycles - b.cycles)
    };
}
