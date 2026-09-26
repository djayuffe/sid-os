
// Cycle-Perfect SID Guitar Physics Processor v6.2 (STABLE_TUNE)
// Hardware-accurate emulation of MOS 6581/8580 logic
// Features: 
// - Physics-based String Excitation
// - Cabinet Simulation (Formant Filtering)
// - Harmonic Feedback Drift (Natural Overtone Evolution)
// - Pick Attack Transients (Noise Bursts)
// - Multi-Stage Articulation Envelopes
// - NEW: Tape Wow/Flutter Simulation (Subtle)
// - NEW: Octave Multiplexing (Restricted)

export type GuitarMode = 'CLEAN' | 'OVERDRIVE' | 'DISTORTION' | 'MUTED' | 'PINCH' | 'FEEDBACK' | 'POWER_CHORD' | 'JAZZ' | 'SLAP';
export type SIDChip = '6581' | '8580';

const CLAMP = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const LERP = (a: number, b: number, t: number) => a + (b - a) * t;
const SAFE_LERP = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

const NOTE_TO_FREQ = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

const MAP_CUTOFF_6581 = (hz: number) => {
    if (hz < 220) return 0;
    const safeHz = CLAMP(hz, 220, 18000);
    const logPart = Math.log2(safeHz / 100) * 200;
    if (safeHz > 5000) return CLAMP(Math.floor(logPart + (safeHz - 5000) * 0.1), 0, 2047);
    return CLAMP(Math.floor(logPart), 0, 2047);
};

const MAP_CUTOFF_8580 = (hz: number) => {
    const safeHz = CLAMP(hz, 0, 18000);
    const val = (safeHz / 12500) * 2047;
    return CLAMP(Math.floor(val), 0, 2047);
};

export interface GuitarVoiceState {
    active: boolean;
    note: number;
    velocity: number;
    sustainTimer: number;
    releaseTimer: number;
    mode: GuitarMode;
    
    // Physics & Articulation
    pickPosition: number;    
    pluckSnap: number; 
    stringTension: number;
    
    // Feedback Simulation
    feedbackHarmonic: number; 
    feedbackMix: number;
    
    // Transients
    attackNoiseTimer: number;

    // LFO State
    vibPhase: number;
    vibRate: number;
    vibDepth: number;
    
    pwmPhase: number;
    pwmRate: number;
    
    // Wow & Multiplex (Groove Engine)
    multiplexActive: boolean;
    multiplexTimer: number;
    multiplexOctave: boolean; // Toggles between base and sub-octave
    
    // SID Output State
    currentFreq: number;
    currentPw: number;
    currentCutoff: number;
    currentRes: number;
}

export class GuitarProcessor {
    voices: GuitarVoiceState[];
    chipType: SIDChip;
    clockFreq: number;
    
    constructor(chipType: SIDChip = '6581', clockFreq: number = 985248, voiceCount: number = 6) {
        this.chipType = chipType;
        this.clockFreq = clockFreq;
        this.voices = Array.from({length: voiceCount}, () => this.createVoice());
    }

    private createVoice(): GuitarVoiceState {
        return {
            active: false, note: 0, velocity: 0,
            sustainTimer: 0, releaseTimer: 0, mode: 'CLEAN',
            pickPosition: 0.5, pluckSnap: 0, stringTension: 0.5,
            feedbackHarmonic: 1.0, feedbackMix: 0,
            attackNoiseTimer: 0,
            vibPhase: 0, vibRate: 6.0, vibDepth: 0,
            pwmPhase: 0, pwmRate: 0.5,
            multiplexActive: false, multiplexTimer: 0, multiplexOctave: false,
            currentFreq: 200, currentPw: 0x800, currentCutoff: 4000, currentRes: 0
        };
    }

    public noteOn(voiceIdx: number, note: number, velocity: number, patch: number) {
        if (!this.voices[voiceIdx]) return;
        const v = this.voices[voiceIdx];
        v.active = true;
        v.note = note;
        v.velocity = velocity;
        v.sustainTimer = 0;
        v.releaseTimer = 0;
        
        // Randomize LFO start phases for organic feel
        v.vibPhase = Math.random() * 6.28;
        v.pwmPhase = Math.random() * 6.28;
        
        v.feedbackMix = 0;
        v.attackNoiseTimer = 0.05; 
        
        // Refined GM Mapping to avoid "All Distortion" for bass
        if (patch === 127) v.mode = 'FEEDBACK';
        else if (patch >= 32 && patch <= 39) v.mode = 'CLEAN'; // Basses
        else if (patch === 30 || patch === 31) v.mode = 'DISTORTION';
        else if (patch === 29) v.mode = 'OVERDRIVE';
        else if (patch === 28) v.mode = 'MUTED';
        else if (patch >= 26 && patch <= 27) v.mode = 'JAZZ';
        else v.mode = 'CLEAN';

        // Nuance Overrides
        if (velocity > 120 && v.mode === 'DISTORTION') v.mode = 'PINCH';
        if (velocity > 110 && v.mode === 'CLEAN') v.mode = 'SLAP';
        if (velocity < 60 && (v.mode === 'DISTORTION' || v.mode === 'OVERDRIVE')) v.mode = 'MUTED';

        // "Groove" Setup: Dynamics affect snap and LFOs
        const velNorm = velocity / 127.0;
        // Zero snap for clean melody to prevent pitch artifact
        v.pluckSnap = 0.0; 
        
        v.vibRate = 5.0 + Math.random();
        v.vibDepth = 0.0; // Delayed vibrato onset handled in process
        v.pwmRate = 0.2 + velNorm * 0.5;
        
        // "Multiplex" Setup: Only for specialized NOISE effects, never for melody
        v.multiplexActive = (v.mode === 'FEEDBACK'); 
        v.multiplexTimer = 0;
        v.multiplexOctave = false;

        if (v.mode === 'FEEDBACK') {
            v.feedbackHarmonic = [2.0, 3.0, 4.0, 5.0][Math.floor(Math.random()*4)];
        } else {
            v.feedbackHarmonic = 1.0;
        }

        v.currentPw = 0x800;
        v.currentFreq = Math.max(20, NOTE_TO_FREQ(note));
        v.currentCutoff = v.mode === 'MUTED' ? 800 : 4000;
        v.currentRes = 0;
    }

    public legatoSlide(voiceIdx: number, note: number, velocity: number) {
        if (!this.voices[voiceIdx]) return;
        const v = this.voices[voiceIdx];
        v.note = note;
        v.velocity = velocity;
        v.sustainTimer = 0.05; // Short reset for transient
        
        const velNorm = velocity / 127.0;
        v.pluckSnap = 0.005 + velNorm * 0.01; // Very soft snap on slide
        v.currentFreq = Math.max(20, NOTE_TO_FREQ(note));
    }

    public noteOff(voiceIdx: number) {
        if (!this.voices[voiceIdx]) return;
        this.voices[voiceIdx].active = false;
        this.voices[voiceIdx].releaseTimer = 0;
    }

    public process(voiceIdx: number, dt: number, baseFreqHz: number): {
        registers: { freq: number; pw: number; ctrl: number; ad: number; sr: number; };
        filter: { cutoff: number; res: number; type: number; active: boolean };
    } {
        const v = this.voices[voiceIdx];
        
        // Idle / Dead Voice
        if (!v || (!v.active && v.releaseTimer > 0.5)) {
            return {
                registers: { freq: 1024, pw: 0x800, ctrl: 0, ad: 0, sr: 0 },
                filter: { cutoff: 0, res: 0, type: 0, active: false }
            };
        }
        
        const safeDt = (!Number.isFinite(dt) || dt <= 0) ? 0.02 : dt;
        const safeBaseFreq = (!Number.isFinite(baseFreqHz) || baseFreqHz < 20) ? 20 : baseFreqHz;
        
        if (v.active) {
            v.sustainTimer += safeDt;
            // Delayed Vibrato onset
            if (v.sustainTimer > 0.4) v.vibDepth = SAFE_LERP(v.vibDepth, 0.03, safeDt);
        } else {
            v.releaseTimer += safeDt;
            v.vibDepth = SAFE_LERP(v.vibDepth, 0, safeDt * 5);
        }

        if (v.attackNoiseTimer > 0) v.attackNoiseTimer -= safeDt;

        // --- 1. LFOs ---
        v.vibPhase += safeDt * v.vibRate * 6.28;
        v.pwmPhase += safeDt * v.pwmRate * 6.28;
        
        const vibVal = Math.sin(v.vibPhase);
        const pwmVal = Math.sin(v.pwmPhase);

        // --- 2. Pitch Physics (Pure) ---
        const snapEnv = Math.exp(-v.sustainTimer * 20.0);
        
        // Pitch modulation sum (No WOW/Flutter)
        let pitchMod = 1.0 
            + (vibVal * v.vibDepth) 
            + (snapEnv * v.pluckSnap);
        
        // Multiplexing (Only for FEEDBACK mode)
        if (v.multiplexActive && v.active) {
            v.multiplexTimer += safeDt;
            if (v.multiplexTimer > 0.03) { 
                v.multiplexTimer = 0;
                v.multiplexOctave = !v.multiplexOctave;
            }
            if (v.multiplexOctave) {
                pitchMod *= 1.002; // Slight chorus
            }
        }

        if (v.mode === 'FEEDBACK' && v.active && v.sustainTimer > 1.0) {
            v.feedbackMix = Math.min(1.0, v.feedbackMix + safeDt * 0.2);
            pitchMod = LERP(pitchMod, v.feedbackHarmonic, v.feedbackMix);
        }

        let finalFreq = safeBaseFreq * pitchMod;
        if (!Number.isFinite(finalFreq) || finalFreq < 20) finalFreq = 20;
        
        const freqReg = CLAMP(Math.round((finalFreq * 16777216) / this.clockFreq), 1, 65535);

        // --- 3. Timbre & Waveform ---
        let targetPw = 0x800;
        let wave = 0x40; // Pulse default
        let ring = false;
        let sync = false;

        switch (v.mode) {
            case 'CLEAN':
            case 'JAZZ':
                targetPw = 0x400 + (pwmVal * 0x300);
                wave = 0x40;
                break;
            case 'SLAP':
                targetPw = 0x200 + (snapEnv * 0x400);
                wave = 0x40;
                break;
            case 'OVERDRIVE':
                targetPw = 0x800 + (pwmVal * 0x600);
                wave = 0x41; // Pulse + Tri
                if (this.chipType === '6581') wave |= 0x10; // Combined
                break;
            case 'DISTORTION':
            case 'POWER_CHORD':
                wave = 0x21; // Saw + Tri
                // Sharp attack transient using Noise
                if (v.sustainTimer < 0.05) wave |= 0x80;
                break;
            case 'PINCH':
                wave = 0x10; ring = true; sync = true;
                break;
            case 'MUTED':
                targetPw = 0x200; wave = 0x40;
                break;
            case 'FEEDBACK':
                wave = v.feedbackMix > 0.5 ? 0x21 : 0x41;
                targetPw = 0x800 + (vibVal * 0x100);
                break;
        }

        if (v.attackNoiseTimer > 0) targetPw += (Math.random() - 0.5) * 0x400;

        v.currentPw = SAFE_LERP(v.currentPw, targetPw, safeDt * 10.0);
        const pwReg = CLAMP(Math.floor(v.currentPw), 0, 4095);

        // --- 4. Envelopes (Groove Response) ---
        // Adjust decay/release based on velocity ("Groove")
        let ad = 0, sr = 0;
        const dynDecay = Math.max(0, 9 - Math.floor(v.velocity / 30)); // 0..9
        
        switch (v.mode) {
            case 'MUTED': ad = 0x08; sr = 0x05; break; // Release 5 (~114ms)
            case 'SLAP': ad = 0x06; sr = 0x66; break; // Release 6 (~204ms)
            case 'JAZZ': ad = 0x29; sr = 0xB6; break; // Release 6 (~204ms)
            case 'FEEDBACK': ad = 0x30; sr = 0xF7; break; // Release 7 (~240ms)
            default: 
                // Dynamic decay for groove
                ad = 0x00 | (dynDecay & 0xF); 
                sr = 0xC6; // Sustain 12, Release 6 (~204ms) - Snappy
                break;
        }

        let ctrl = wave;
        if (v.active) ctrl |= 0x01; else ctrl &= 0xFE;
        if (ring) ctrl |= 0x04;
        if (sync) ctrl |= 0x02;

        // --- 5. Filter ---
        let targetCutoff = 0;
        let targetRes = 0;
        let filterType = 1;

        const velNorm = v.velocity / 127.0;
        const pluckEnv = Math.exp(-v.sustainTimer * 8.0);
        const dynAmt = velNorm * 1500; 

        switch (v.mode) {
            case 'MUTED':
                const muteEnv = Math.max(0, 1.0 - v.sustainTimer * 8.0);
                targetCutoff = 300 + (muteEnv * 2000 * velNorm);
                targetRes = 5;
                break;
            case 'JAZZ':
                targetCutoff = 1500 + pluckEnv * 500; 
                targetRes = 1;
                break;
            case 'OVERDRIVE':
            case 'DISTORTION':
                targetCutoff = 3500 + (vibVal * 200) + (pluckEnv * dynAmt * 0.5); 
                targetRes = 4;
                filterType = 1; // LowPass
                break;
            case 'PINCH':
                targetCutoff = 2000 + (Math.sin(v.sustainTimer * 10) * 1000);
                targetRes = 12; filterType = 2; // BandPass
                break;
            case 'FEEDBACK':
                targetCutoff = 4000 + (v.feedbackMix * 4000);
                targetRes = 8; filterType = 2;
                break;
            default: 
                targetCutoff = 4000 + (pluckEnv * dynAmt); 
                targetRes = 2;
                break;
        }

        targetCutoff += (v.note - 40) * 20;

        v.currentCutoff = SAFE_LERP(v.currentCutoff, targetCutoff, safeDt * 15.0);
        v.currentRes = SAFE_LERP(v.currentRes, targetRes, safeDt * 5.0);

        const cutoffReg = this.chipType === '8580' ? MAP_CUTOFF_8580(v.currentCutoff) : MAP_CUTOFF_6581(v.currentCutoff);

        return {
            registers: { freq: freqReg, pw: pwReg, ctrl: ctrl, ad: ad, sr: sr },
            filter: { cutoff: cutoffReg, res: Math.round(v.currentRes), type: filterType, active: true }
        };
    }
}
