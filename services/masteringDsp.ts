
/**
 * Analog Mojo Stereo DSP Kernel V21.0
 * Features:
 * - Hysteresis Tape Saturation
 * - Stable, Denormal-Safe Float Math
 */

export const DENORM = 1e-24;
const FINITE = (x: number) => (Math.abs(x) < DENORM || !Number.isFinite(x) ? 0 : x);
const CLAMP = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));

// --- AUDIO WORKLET CODE INJECTION ---
// Note: We use a simple object for the code to avoid import issues in the worklet scope.
export const MASTERING_DSP_CODE = `
// ==========================================
// DSP KERNEL: UTILITIES
// ==========================================
const DENORM = 1e-24;
const FINITE = (x) => (Math.abs(x) < DENORM || !Number.isFinite(x) ? 0 : x);
const CLAMP = (x, min, max) => Math.max(min, Math.min(max, x));

class RingBuffer {
    constructor(length) {
        this.size = length | 0;
        this.buf = new Float32Array(this.size);
        this.w = 0; this.r = 0;
    }
    push(v) { this.buf[this.w] = FINITE(v); this.w = (this.w + 1) % this.size; }
    read() { const v = this.buf[this.r]; this.r = (this.r + 1) % this.size; return v; }
}

class Oversample2x {
    constructor() { this.z1 = 0; }
    process(x, fn) {
        const x0 = x; const x1 = (x + this.z1) * 0.5; this.z1 = x;
        return (fn(x0) + fn(x1)) * 0.5;
    }
}

class TapeSat {
    constructor() { this.z = 0; }
    // Hysteresis-like effect using state
    process(x, drive, bias) {
        const inVal = x * drive + bias;
        // Simulating magnetic hysteresis lag
        this.z = this.z * 0.4 + inVal * 0.6;
        const shaped = Math.tanh(this.z);
        return shaped;
    }
}

class SidColor {
    constructor() { this.dc = 0; this.model = '6581'; }
    setModel(m) { this.model = m; }
    process(x) {
        x = FINITE(x);
        if (this.model === '6581') {
            const driven = x * 1.4;
            const colored = Math.tanh(driven);
            this.dc += (colored - this.dc) * 0.002;
            return FINITE((colored + this.dc * 0.02) * 0.85); 
        } else {
            return CLAMP(x * 1.1, -1.0, 1.0);
        }
    }
}

class StereoLookAheadLimiter {
    constructor(sampleRate) {
        this.lookaheadMs = 5.0; 
        const len = Math.ceil(sampleRate * (this.lookaheadMs / 1000)) + 1;
        this.bufL = new RingBuffer(len); this.bufR = new RingBuffer(len);
        this.env = 0;
        this.att = Math.exp(-1.0 / (sampleRate * 0.002)); 
        this.rel = Math.exp(-1.0 / (sampleRate * 0.100)); 
    }
    process(l, r, ceiling) {
        l = FINITE(l); r = FINITE(r);
        const peak = Math.max(Math.abs(l), Math.abs(r));
        if (peak > this.env) this.env = this.env * this.att + peak * (1.0 - this.att);
        else this.env = this.env * this.rel + peak * (1.0 - this.rel);
        this.bufL.push(l); this.bufR.push(r);
        let g = 1.0;
        if (this.env > ceiling) g = ceiling / this.env;
        return [this.bufL.read() * g, this.bufR.read() * g];
    }
}

class TiltEQ {
    constructor(s) { this.s = s; this.lp = 0; }
    reset() { this.lp = 0; }
    process(x, tilt) {
        x = FINITE(x);
        const f = 650.0 / this.s;
        this.lp += f * (x - this.lp);
        const hp = x - this.lp;
        return FINITE(x * 0.2 + (this.lp * (1.0 + (0.5 - tilt) * 3.0) + hp * (1.0 + (tilt - 0.5) * 3.0)));
    }
}

class Exciter {
    constructor() { this.hp = 0; }
    reset() { this.hp = 0; }
    process(x, amt, freq) {
        x = FINITE(x);
        this.hp += freq * (x - this.hp);
        const high = x - this.hp;
        const dist = Math.tanh(high * 5.0) * 0.2; 
        return x + dist * amt;
    }
}

class SubWeight {
    constructor(s) { this.s = s; this.lp = 0; }
    reset() { this.lp = 0; }
    process(x, w) {
        x = FINITE(x);
        const f = 120.0 / this.s * 6.28; 
        this.lp += f * (x - this.lp);
        const fat = Math.tanh(this.lp * 2.0) * 0.5;
        return x + fat * w;
    }
}

class StereoImager {
    process(l, r, width) {
        const m = (l + r) * 0.5;
        const s = (l - r) * 0.5 * width;
        return [m + s, m - s];
    }
}

class BBDChorus {
    constructor(sampleRate) {
        this.s = sampleRate;
        this.len = Math.floor(sampleRate * 0.04); 
        this.buf = new Float32Array(this.len);
        this.ptr = 0; this.phi = 0;
    }
    reset() { this.buf.fill(0); this.ptr=0; this.phi=0; }
    process(x, depth, rate, mix) {
        x = FINITE(x);
        this.phi += (rate * 6.28) / this.s;
        if(this.phi > 6.28) this.phi -= 6.28;
        const mod = Math.sin(this.phi) * depth * 0.005 * this.s; 
        const offset = (0.015 * this.s) + mod; 
        let rPtr = this.ptr - offset;
        while(rPtr < 0) rPtr += this.len;
        const i = Math.floor(rPtr);
        const f = rPtr - i;
        const i2 = (i + 1) % this.len;
        const delayed = this.buf[i] * (1-f) + this.buf[i2] * f;
        this.buf[this.ptr] = x;
        this.ptr = (this.ptr + 1) % this.len;
        return x * (1-mix) + delayed * mix;
    }
}

class StereoDelay {
    constructor(s) {
        this.s = s;
        this.len = Math.floor(s * 1.0); 
        this.bufL = new Float32Array(this.len);
        this.bufR = new Float32Array(this.len);
        this.p = 0;
    }
    reset() { this.bufL.fill(0); this.bufR.fill(0); this.p = 0; }
    process(l, r, ms, feed, mix) {
        const delaySamps = Math.floor((Math.max(10, ms)/1000)*this.s);
        let rp = this.p - delaySamps;
        while(rp < 0) rp += this.len;
        const dl = this.bufL[rp]; const dr = this.bufR[rp];
        const outL = l + dl * mix; const outR = r + dr * mix;
        this.bufL[this.p] = FINITE(l + dr * feed * 0.8);
        this.bufR[this.p] = FINITE(r + dl * feed * 0.8);
        this.p = (this.p + 1) % this.len;
        return [outL, outR];
    }
}

class MasteringChain {
    constructor(sampleRate) {
        this.s = sampleRate;
        this.sidL = new SidColor(); this.sidR = new SidColor();
        this.osL = new Oversample2x(); this.osR = new Oversample2x();
        this.tapeL = new TapeSat(); this.tapeR = new TapeSat();
        this.subL = new SubWeight(this.s); this.subR = new SubWeight(this.s);
        this.tiltL = new TiltEQ(this.s); this.tiltR = new TiltEQ(this.s);
        this.excL = new Exciter(); this.excR = new Exciter();
        this.img = new StereoImager();
        this.choL = new BBDChorus(this.s); this.choR = new BBDChorus(this.s);
        this.dly = new StereoDelay(this.s);
        this.limiter = new StereoLookAheadLimiter(this.s);
        this.p = {
            eq: {enabled: true, tilt: 0.45},
            tape: {enabled: true, drive: 1.15, bias: 0.02},
            exciter: {enabled: true, amount: 0.05, freq: 8500},
            imager: {enabled: true, width: 1.05},
            limiter: {enabled: true, ceiling: 0.98},
            chorus: {enabled: true, depth: 0.25, rate: 0.5, mix: 0.1},
            reverb: {active: true, mix: 0.1, time: 350, feedback: 0.4},
            output: {gain: 1.0}
        };
    }
    reset() {
        this.subL.reset(); this.subR.reset();
        this.tiltL.reset(); this.tiltR.reset();
        this.excL.reset(); this.excR.reset();
        this.choL.reset(); this.choR.reset();
        this.dly.reset();
    }
    updateParams(p) { if(p) this.p = p; }
    setModel(m) { this.sidL.setModel(m); this.sidR.setModel(m); }
    process(l, r) {
        l = FINITE(l); r = FINITE(r);
        l = this.sidL.process(l); r = this.sidR.process(r);
        if (this.p.tape?.enabled) {
            const drive = this.p.tape.drive || 1.0;
            const bias = this.p.tape.bias || 0.0;
            l = this.osL.process(l, (x) => this.tapeL.process(x, drive, bias));
            r = this.osR.process(r, (x) => this.tapeR.process(x, drive, bias));
        }
        l = this.subL.process(l, 0.3); r = this.subR.process(r, 0.3);
        if (this.p.eq?.enabled) { l = this.tiltL.process(l, this.p.eq.tilt); r = this.tiltR.process(r, this.p.eq.tilt); }
        if (this.p.exciter?.enabled) { const f = (this.p.exciter.freq || 8000) / this.s; l = this.excL.process(l, this.p.exciter.amount, f); r = this.excR.process(r, this.p.exciter.amount, f); }
        if (this.p.imager?.enabled) { const res = this.img.process(l, r, this.p.imager.width); l = res[0]; r = res[1]; }
        if (this.p.chorus?.enabled) { const { depth, rate, mix } = this.p.chorus; l = this.choL.process(l, depth, rate, mix); r = this.choR.process(r, depth, rate, mix); }
        if (this.p.reverb?.active) { const { time, feedback, mix } = this.p.reverb; const d = this.dly.process(l, r, time, feedback, mix); l = d[0]; r = d[1]; }
        const gain = this.p.output?.gain || 1.0; l *= gain; r *= gain;
        if (this.p.limiter?.enabled) { const res = this.limiter.process(l, r, this.p.limiter.ceiling || 0.99); l = res[0]; r = res[1]; }
        return [l, r];
    }
}
`;

// --- MAIN THREAD FALLBACK CLASS ---
export class MasteringChain {
    sidL: any; sidR: any;
    tapeL: any; tapeR: any;
    tiltL: any; tiltR: any;
    dly: any;
    params: any = {};
    sr: number;

    constructor(sampleRate: number) {
        this.sr = sampleRate;
        // Simplified fallback instances for main thread visualizer/export if needed
        this.sidL = { process: (x:number)=>x, setModel: ()=>{} }; 
        this.sidR = { process: (x:number)=>x, setModel: ()=>{} };
        this.tapeL = { process: (x:number)=>x }; 
        this.tapeR = { process: (x:number)=>x };
        this.tiltL = { process: (x:number)=>x }; 
        this.tiltR = { process: (x:number)=>x };
        this.dly = { process: (l:number, r:number)=>[l,r] };
    }

    updateParams(p: any) { this.params = p; }
    setModel(m: string) { /* */ }
    reset() { /* */ }

    process(l: number, r: number): [number, number] {
        // Main thread minimal processing for offline render speed
        // Actual DSP logic is in the string above for AudioWorklet
        return [l, r];
    }
}
