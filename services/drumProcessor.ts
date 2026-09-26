
// Studio-Grade Drum Processor for SID (Bit-Perfect Edition)
// Optimized for clean, artifact-free transients and tight rhythm

const CLAMP = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export type DrumType = 'KICK' | 'SNARE' | 'HAT_CLOSED' | 'HAT_OPEN' | 'TOM' | 'CLAP' | 'CRASH' | 'PERC';

interface DrumPatch {
    type: DrumType;
    baseFreq: number;
    endFreq: number;
    slideTime: number;
    wave: number;     
    atk: number; dec: number; sus: number; rel: number;
    sweepCurve: 'EXP' | 'LIN';
    chokeGroup?: number;
}

const DRUM_MAP: Record<number, DrumPatch> = {
    // Kicks
    35: { type: 'KICK', baseFreq: 150, endFreq: 40, slideTime: 0.05, wave: 0x10, atk: 0, dec: 8, sus: 0, rel: 6, sweepCurve: 'EXP' }, 
    36: { type: 'KICK', baseFreq: 220, endFreq: 30, slideTime: 0.07, wave: 0x10, atk: 0, dec: 9, sus: 0, rel: 7, sweepCurve: 'EXP' }, // 808-ish Deep
    
    // Snares
    38: { type: 'SNARE', baseFreq: 2200, endFreq: 1200, slideTime: 0.08, wave: 0x80, atk: 0, dec: 9, sus: 0, rel: 6, sweepCurve: 'LIN' }, 
    40: { type: 'SNARE', baseFreq: 3500, endFreq: 1800, slideTime: 0.05, wave: 0x80, atk: 0, dec: 7, sus: 0, rel: 5, sweepCurve: 'LIN' }, 
    
    // Hats
    42: { type: 'HAT_CLOSED', baseFreq: 9000, endFreq: 9000, slideTime: 0, wave: 0x80, atk: 0, dec: 1, sus: 0, rel: 1, sweepCurve: 'LIN', chokeGroup: 1 },
    44: { type: 'HAT_CLOSED', baseFreq: 8000, endFreq: 8000, slideTime: 0, wave: 0x80, atk: 0, dec: 2, sus: 0, rel: 1, sweepCurve: 'LIN', chokeGroup: 1 },
    46: { type: 'HAT_OPEN', baseFreq: 7500, endFreq: 7500, slideTime: 0, wave: 0x80, atk: 0, dec: 8, sus: 1, rel: 8, sweepCurve: 'LIN', chokeGroup: 1 },
    
    // Toms
    41: { type: 'TOM', baseFreq: 300, endFreq: 80, slideTime: 0.15, wave: 0x10, atk: 0, dec: 9, sus: 0, rel: 5, sweepCurve: 'EXP' },
    43: { type: 'TOM', baseFreq: 450, endFreq: 120, slideTime: 0.12, wave: 0x10, atk: 0, dec: 8, sus: 0, rel: 5, sweepCurve: 'EXP' },
    45: { type: 'TOM', baseFreq: 600, endFreq: 160, slideTime: 0.10, wave: 0x10, atk: 0, dec: 7, sus: 0, rel: 5, sweepCurve: 'EXP' },
    
    // Misc
    39: { type: 'CLAP', baseFreq: 1800, endFreq: 1800, slideTime: 0, wave: 0x80, atk: 0, dec: 9, sus: 0, rel: 6, sweepCurve: 'LIN' },
    49: { type: 'CRASH', baseFreq: 9500, endFreq: 6000, slideTime: 0.8, wave: 0x80, atk: 0, dec: 11, sus: 6, rel: 9, sweepCurve: 'LIN', chokeGroup: 2 },
    57: { type: 'CRASH', baseFreq: 9800, endFreq: 5000, slideTime: 1.0, wave: 0x80, atk: 0, dec: 12, sus: 7, rel: 10, sweepCurve: 'LIN', chokeGroup: 2 }
};

interface DrumVoiceState {
    active: boolean;
    note: number;
    velocity: number;
    patch: DrumPatch | null;
    age: number; 
    releasePhase: boolean;
    releaseTime: number; 
}

export class DrumProcessor {
    voices: DrumVoiceState[];

    constructor(voiceCount: number = 3) {
        this.voices = Array.from({length: voiceCount}, () => ({
            active: false, note: 0, velocity: 0, patch: null, age: 0, releasePhase: false, releaseTime: 0
        }));
    }

    trigger(voiceIdx: number, note: number, velocity: number) {
        if (voiceIdx < 0 || voiceIdx >= this.voices.length) return;

        const patch = DRUM_MAP[note] || DRUM_MAP[note % 12 + 35] || DRUM_MAP[36];
        
        if (patch.chokeGroup !== undefined) {
            for (let i = 0; i < this.voices.length; i++) {
                if (this.voices[i].active && this.voices[i].patch?.chokeGroup === patch.chokeGroup) {
                    this.voices[i].active = false; 
                }
            }
        }

        this.voices[voiceIdx] = {
            active: true,
            note: note,
            velocity: velocity,
            patch: patch,
            age: 0,
            releasePhase: false,
            releaseTime: 0
        };
    }

    release(voiceIdx: number) {
        if (voiceIdx < 0 || voiceIdx >= this.voices.length) return;
        const v = this.voices[voiceIdx];
        if (v.active && !v.releasePhase) {
            v.releasePhase = true;
            v.releaseTime = v.age; 
        }
    }

    process(voiceIdx: number, dt: number, clockFreq: number): {
        freq: number;
        pw: number;
        ctrl: number;
        adsr: { a: number, d: number, s: number, r: number };
    } {
        // Return parked state (not 0) to avoid "00 00" artifacts in registers
        // Using freq=1024 (approx 60Hz) as a safe parking spot
        if (voiceIdx < 0 || voiceIdx >= this.voices.length) {
            return { freq: 1024, pw: 0x800, ctrl: 0, adsr: { a:0, d:0, s:0, r:0 } };
        }

        const v = this.voices[voiceIdx];
        if (!v.active || !v.patch) {
            return { freq: 1024, pw: 0x800, ctrl: 0, adsr: { a:0, d:0, s:0, r:0 } };
        }

        v.age += dt;
        const p = v.patch;
        const velScale = v.velocity / 127;

        const baseFreq = p.baseFreq; 
        
        let currentFreq = baseFreq;
        if (p.slideTime > 0) {
            const t = Math.min(1.0, v.age / p.slideTime);
            if (p.sweepCurve === 'EXP') {
                const factor = 1.0 - Math.pow(t, 0.4); // Sharper kick transient
                currentFreq = p.endFreq + (baseFreq - p.endFreq) * factor;
            } else {
                currentFreq = baseFreq + (p.endFreq - baseFreq) * t;
            }
        } else {
            currentFreq = baseFreq;
        }

        // Safety & Cleanup: NaN protection
        if (!Number.isFinite(currentFreq) || currentFreq < 0) currentFreq = 0;
        
        // Critical Fix: Ensure clockFreq is positive to prevent Infinity
        const safeClock = (clockFreq && clockFreq > 0) ? clockFreq : 985248;

        const freqReg = Math.round((currentFreq * 16777216) / safeClock);
        // Clamp minimum frequency to 1 to avoid 0x0000 stall
        const safeFreq = CLAMP(freqReg, 1, 65535);
        
        let ctrl = p.wave;
        
        if (!v.releasePhase) ctrl |= 0x01;

        // Dynamic Release for Choked Hats - make it snappy
        let finalDec = p.dec;
        let finalRel = p.rel;
        if ((p.type === 'HAT_OPEN' || p.type === 'HAT_CLOSED' || p.type === 'CRASH') && v.releasePhase) {
            finalRel = 1; // Almost instant cut for tight rhythm
        }

        // Velocity Scaling
        let finalSus = p.sus;
        if (p.sus > 0) {
            finalSus = Math.floor(p.sus * velScale);
        }

        const timeout = (p.type === 'HAT_CLOSED') ? 0.2 : 3.0; // Shorter timeout for hats
        const timeSinceRelease = v.releasePhase ? (v.age - v.releaseTime) : 0;
        
        if (v.releasePhase && timeSinceRelease > timeout) {
            v.active = false;
            // Return parked state on transition to inactive
            return { freq: 1024, pw: 0x800, ctrl: 0, adsr: { a:0, d:0, s:0, r:0 } };
        }

        return {
            freq: safeFreq,
            pw: 0x800,
            ctrl: ctrl,
            adsr: { a: p.atk, d: finalDec, s: finalSus, r: finalRel }
        };
    }
}
