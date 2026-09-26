
import { ParsedTrace, MasteringParams, MixerParams } from '../types';
import { createWavFile } from './audioExportService';
import { MasteringChain } from './masteringDsp';

// --- Constants & Lookups ---
const F6581_BASE = [220, 221, 222, 225, 230, 240, 260, 300, 380, 500, 750, 1200, 2000, 3500, 6000, 9500, 13500, 16000];
const F8580_BASE = [0, 20, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800];
const ADSR_RATE = [9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251];

const generateCutoffTable = (base: number[]) => {
    return new Array(2048).fill(0).map((_, i) => {
        const idx = (i / 2047) * (base.length - 1);
        const i0 = Math.floor(idx);
        const i1 = Math.min(i0 + 1, base.length - 1);
        const f = idx - i0;
        return base[i0] * (1 - f) + base[i1] * f;
    });
};

const F6581_TABLE = generateCutoffTable(F6581_BASE);
const F8580_TABLE = generateCutoffTable(F8580_BASE);

class Slew {
    v: number; t: number; f: number;
    constructor(v=0, f=1.0) { this.v = v; this.t = v; this.f = f; }
    set(t: number) { this.t = t; }
    step() { this.v = this.v * (1.0 - this.f) + this.t * this.f; return this.v; }
}

// --- High Quality Resampler ---

class HighQualityDownsampler {
    private bufferL: Float32Array;
    private bufferR: Float32Array;
    private size: number;
    private mask: number;
    private head: number;
    
    public ratio: number;
    private inputCount: number;
    private outputCount: number;
    
    // Config: 6 lobes gives ~100dB stopband attenuation with Blackman
    private lobes: number = 6; 
    
    constructor(inRate: number, outRate: number) {
        this.ratio = inRate / outRate;
        // Buffer needs to hold at least the kernel width (2 * lobes * ratio)
        // With ratio ~22 and lobes 6, width is ~264. 8192 is plenty safe.
        this.size = 16384; 
        this.mask = this.size - 1;
        this.bufferL = new Float32Array(this.size);
        this.bufferR = new Float32Array(this.size);
        this.head = 0;
        this.inputCount = 0;
        this.outputCount = 0;
    }
    
    push(l: number, r: number) {
        this.bufferL[this.head] = l;
        this.bufferR[this.head] = r;
        this.head = (this.head + 1) & this.mask;
        this.inputCount++;
    }
    
    get ready(): boolean {
        // We need samples centered at outputCount * ratio
        // extending +/- lobes * ratio
        const center = this.outputCount * this.ratio;
        const width = this.lobes * this.ratio;
        return this.inputCount >= (center + width + 1);
    }
    
    generate(): [number, number] | null {
        if (!this.ready) return null;

        const center = this.outputCount * this.ratio;
        const width = this.lobes * this.ratio;
        
        let sumL = 0;
        let sumR = 0;
        let weightSum = 0;
        
        const start = Math.ceil(center - width);
        const end = Math.floor(center + width);
        
        for (let i = start; i <= end; i++) {
            // Find buffer index for absolute input index 'i'
            // Head points to inputCount (next write), so last write was inputCount - 1
            const offsetFromEnd = this.inputCount - 1 - i;
            if (offsetFromEnd < 0) continue; // Future sample (shouldn't happen if ready)
            
            const bufIdx = (this.head - 1 - offsetFromEnd + this.size * 2) & this.mask;
            
            // Normalized time relative to output sample period
            const t = (i - center) / this.ratio;
            
            // Windowed Sinc Kernel (Blackman Window)
            // Sinc is lowpass filter, Window reduces ringing
            const wT = t / this.lobes;
            if (Math.abs(wT) > 1.0) continue;

            const window = 0.42 + 0.5 * Math.cos(Math.PI * wT) + 0.08 * Math.cos(2 * Math.PI * wT);
            const sinc = (Math.abs(t) < 1e-9) ? 1.0 : Math.sin(Math.PI * t) / (Math.PI * t);
            
            const weight = window * sinc;
            
            sumL += this.bufferL[bufIdx] * weight;
            sumR += this.bufferR[bufIdx] * weight;
            weightSum += weight;
        }
        
        this.outputCount++;
        
        if (weightSum > 0) {
            return [sumL / weightSum, sumR / weightSum];
        }
        return [0, 0];
    }
}

// --- Logic Classes (High Precision) ---

class Voice {
    f=0; pw=0; ctrl=0; ad=0; sr=0;
    acc=0; lfsr=0x7FFFF8; msbFlipped=false;
    env=0; envState=0; gate=false; rateCount=0; expCount=0; expPeriod=1;
    output=0; raw12=0;
    model='6581';
    
    // Slow slews for register smoothing (running at 1MHz)
    sf = new Slew(0, 0.05);
    spw = new Slew(0, 0.005);
    se = new Slew(0, 0.05);

    reset() {
        this.f=0; this.pw=0; this.ctrl=0; this.ad=0; this.sr=0;
        this.acc=0; this.lfsr=0x7FFFF8;
        this.env=0; this.envState=0; this.gate=false;
        this.output=0;
    }

    write(r: number, v: number) {
        v &= 255;
        switch(r) {
            case 0: this.f = (this.f & 0xFF00) | v; this.sf.set(this.f); break;
            case 1: this.f = (this.f & 0x00FF) | (v << 8); this.sf.set(this.f); break;
            case 2: this.pw = (this.pw & 0x0F00) | v; this.spw.set(this.pw); break;
            case 3: this.pw = (this.pw & 0x00FF) | ((v & 0x0F) << 8); this.spw.set(this.pw); break;
            case 4: {
                const oldCtrl = this.ctrl;
                const newGate = (v & 1) !== 0;
                const oldGate = (oldCtrl & 1) !== 0;
                if ((v & 0x08) && !(oldCtrl & 0x08)) { this.acc = 0; this.lfsr = 0x7FFFF8; }
                if (newGate && !oldGate) { this.envState = 1; this.gate = true; this.expCount=0; this.expPeriod=1; }
                else if (!newGate && oldGate) { this.envState = 4; this.gate = false; }
                this.ctrl = v;
                break;
            }
            case 5: this.ad = v; break;
            case 6: this.sr = v; break;
        }
    }

    stepEnv() {
        if (this.envState === 0) return;
        const a = (this.ad >> 4) & 0xF, d = this.ad & 0xF, r = this.sr & 0xF;
        const rateIdx = (this.envState === 1) ? a : (this.envState === 2 || this.envState === 3) ? d : r;
        const period = ADSR_RATE[rateIdx];
        
        this.rateCount = (this.rateCount + 1) & 0x7FFF;
        if (this.rateCount !== period) return;
        this.rateCount = 0;

        if (this.envState === 1) { // Attack
            if (this.env < 0xFF) this.env = (this.env + 1) & 0xFF;
            else this.envState = 2;
        } else {
            const p = this.getExpPeriod(this.env);
            this.expCount++;
            if (this.expCount < p) return;
            this.expCount = 0;
            const sus = ((this.sr >> 4) & 0xF) * 17;
            if (this.envState === 2) {
                if (this.env > sus) this.env--; else this.envState = 3;
            } else if (this.envState === 4) {
                if (this.env > 0) this.env--; else this.envState = 0;
            }
        }
    }

    getExpPeriod(env: number) {
        if (env === 0xFF) return 1;
        if (env === 0x5D) return 2;
        if (env === 0x36) return 4;
        if (env === 0x1A) return 8;
        if (env === 0x0E) return 16;
        if (env === 0x06) return 30;
        if (env === 0x00) return 1;
        return this.expPeriod;
    }

    clockNoise() {
        const b22 = (this.lfsr >> 22) & 1;
        const b17 = (this.lfsr >> 17) & 1;
        this.lfsr = ((this.lfsr << 1) | (b22 ^ b17)) & 0x7FFFFF;
    }

    getWave(modAcc: number) {
        const ctrl = this.ctrl;
        const tri = (ctrl & 0x10) !== 0, saw = (ctrl & 0x20) !== 0, pul = (ctrl & 0x40) !== 0, noi = (ctrl & 0x80) !== 0;
        
        if (!tri && !saw && !pul && !noi) {
            this.raw12 = 0;
            return this.model === '6581' ? (this.output * 0.9995) : 0;
        }

        const acc = ((ctrl & 0x08) !== 0) ? 0 : (this.acc & 0xFFFFFF);
        let tV=0, sV=0, pV=0, nV=0;

        if (tri || this.model === '8580') {
            const ringActive = (ctrl & 0x04) !== 0;
            const msb = ringActive ? ((modAcc & 0x800000) !== 0) : ((acc & 0x800000) !== 0);
            let temp = (acc >>> 11) & 0x0FFF;
            if (msb) temp ^= 0x0FFF;
            tV = temp;
        }
        if (saw || this.model === '8580') sV = (acc >>> 12) & 0x0FFF;
        if (pul || this.model === '8580') {
            const pw = (this.spw.step() | 0) & 0x0FFF;
            pV = ((acc >>> 12) >= pw) ? 0x0FFF : 0x0000;
        }
        if (noi || this.model === '8580') {
            const l = this.lfsr;
            nV = (((l >> 22) & 1) << 11) | (((l >> 20) & 1) << 10) | (((l >> 16) & 1) << 9)  | (((l >> 13) & 1) << 8)  |
                 (((l >> 11) & 1) << 7)  | (((l >> 7)  & 1) << 6)  | (((l >> 4)  & 1) << 5)  | (((l >> 2)  & 1) << 4)  |
                 (((l >> 1)  & 1) << 3)  | (((l >> 0)  & 1) << 2)  | (((l >> 17) & 1) << 1)  | (((l >> 19) & 1) << 0);
        }

        let res = 0;
        const active = (tri?1:0) + (saw?1:0) + (pul?1:0) + (noi?1:0);
        
        if (active === 1) res = tri ? tV : saw ? sV : pul ? pV : nV;
        else if (this.model === '8580') {
            res = 0x0FFF;
            if (tri) res &= tV; if (saw) res &= sV; if (pul) res &= pV; if (noi) res &= nV;
        } else {
            res = 0x0FFF;
            if (tri) res &= (tV | 0x080); if (saw) res &= (sV | 0x040); if (pul) res &= pV; if (noi) res &= nV;
        }
        
        this.raw12 = res & 0xFFF;
        return this.raw12;
    }

    compute(modAcc: number) {
        const raw = this.getWave(modAcc);
        this.se.set(this.env / 255.0);
        const gain = (this.model === '6581' && (this.ctrl & 0xF0) > 0x10) ? 0.85 : 1.0;
        this.output = ((raw / 4095.0) - 0.5) * 2.0 * this.se.step() * gain;
    }
}

class Filter {
    z1=0; z2=0; model='6581'; cut=0; res=0; mode=0; vol=0; routes=0;
    
    // Very slow smoothing for register updates at 1MHz to prevent stepping
    scut = new Slew(0, 0.00005); 
    svol = new Slew(0, 0.0001); 
    sres = new Slew(0, 0.001);  

    write(r: number, v: number) {
        if (r === 21) this.cut = (this.cut & 0x7F8) | (v & 0x07);
        else if (r === 22) this.cut = (this.cut & 0x007) | ((v & 0xFF) << 3);
        else if (r === 23) { this.res = (v >> 4) & 0xF; this.routes = v & 0xF; this.sres.set(this.res); }
        else if (r === 24) { this.mode = (v >> 4) & 0xF; this.vol = v & 0xF; }
        
        this.scut.set(this.cut);
        this.svol.set(this.vol / 15.0);
    }

    process(ins: number[], ext: number, sampleRate: number) {
        const rawCut = this.scut.step();
        const cutInt = Math.floor(rawCut);
        const cutFrac = rawCut - cutInt;
        const table = (this.model === '8580' ? F8580_TABLE : F6581_TABLE);
        
        const f0 = table[cutInt & 2047] + (table[Math.min(cutInt + 1, 2047)] - table[cutInt & 2047]) * cutFrac;
        // SID clock is ~1MHz. sampleRate passed here IS the clock rate.
        const w0 = 2 * Math.PI * f0 / sampleRate; 
        
        const rawRes = this.sres.step();
        const g = Math.sin(w0) / (1 + Math.cos(w0));
        const clippedG = Math.max(0.001, Math.min(0.9, g));
        const dampingBase = [2.0, 1.8, 1.6, 1.4, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1][Math.floor(rawRes) & 15] || 1.0;
        const k = this.model === '6581' ? (dampingBase * 0.8) : dampingBase;

        let vi = 0, vnf = 0;
        const muteV3 = (this.mode & 0x08) !== 0;

        for (let i = 0; i < 3; i++) {
            if (i === 2 && muteV3) continue;
            if ((this.routes >> i) & 1) vi += ins[i]; else vnf += ins[i];
        }
        if ((this.routes >> 3) & 1) vi += ext; else vnf += ext;
        
        vi += 0.005; // DC Leakage
        if (this.model === '6581') vi = Math.tanh(vi * 0.8) * 1.25;

        const feedback = (k + clippedG) * this.z1;
        const distortedFeedback = (this.model === '6581') ? Math.tanh(feedback) : feedback;
        
        const h = 1.0 / (1.0 + clippedG * (clippedG + k));
        const hp = (vi - distortedFeedback - this.z2) * h;
        
        const v1_svf = clippedG * hp; const bp = v1_svf + this.z1; this.z1 = bp + v1_svf;
        const v2_svf = clippedG * bp; const lp = v2_svf + this.z2; this.z2 = lp + v2_svf;
        
        let vf = 0;
        if (this.mode & 1) vf += lp; 
        if (this.mode & 2) vf += bp; 
        if (this.mode & 4) vf += hp;
        if (this.model === '6581') vf += vi * 0.05;
        
        return (vnf + vf) * this.svol.step();
    }
}

// --- Main Renderer ---

export class OfflineSidRenderer {
    static async render(
        trace: ParsedTrace, 
        mastering: MasteringParams, 
        mixer: MixerParams,
        model: '6581' | '8580',
        onProgress?: (p: number) => void
    ): Promise<Blob> {
        const OUTPUT_RATE = 44100;
        const CLOCK = trace.header.clock || 985248;
        
        // High Quality Resampler Config
        // We run the engine at CLOCK rate (approx 1MHz)
        // And downsample to 44.1kHz using Windowed Sinc
        const resampler = new HighQualityDownsampler(CLOCK, OUTPUT_RATE);
        
        // Setup Voices
        const v = [new Voice(), new Voice(), new Voice()];
        v.forEach(voice => voice.model = model);
        const filter = new Filter();
        filter.model = model;
        
        // Use Shared MasteringChain for post-processing at final rate
        const fx = new MasteringChain(OUTPUT_RATE);
        fx.setModel(model);
        fx.updateParams(mastering);

        const events = trace.events;
        const lastCycle = events.length > 0 ? events[events.length - 1].cycles : 0;
        const totalCycles = lastCycle + (1 * CLOCK); // +1 sec trail
        
        const outputSamplesTotal = Math.ceil(totalCycles / resampler.ratio);
        const leftBuf = new Float32Array(outputSamplesTotal);
        const rightBuf = new Float32Array(outputSamplesTotal);
        
        let currentCycle = 0;
        let eventIdx = 0;
        let outIdx = 0;
        
        const PROCESS_CHUNK_SIZE = 100000; // Cycles to process per tick

        return new Promise<Blob>((resolve) => {
            const processChunk = () => {
                const limit = Math.min(totalCycles, currentCycle + PROCESS_CHUNK_SIZE);
                
                while (currentCycle < limit) {
                    // 1. Process Events
                    while (eventIdx < events.length && events[eventIdx].cycles <= currentCycle) {
                        const ev = events[eventIdx];
                        const reg = ev.reg;
                        const val = ev.val;
                        if (reg < 21) v[(reg / 7) | 0].write(reg % 7, val);
                        else if (reg < 25) filter.write(reg, val);
                        eventIdx++;
                    }
                    
                    // 2. Step Physics (1 Cycle)
                    for(let i=0; i<3; i++) {
                        const vv = v[i];
                        const pAcc = vv.acc;
                        const tBit = (vv.ctrl & 0x08) !== 0;
                        const f = Math.floor(vv.sf.step()); 
                        let nAcc = tBit ? 0 : ((pAcc + f) & 0xFFFFFF);
                        const mod = v[i===0?2:i-1];
                        const msb = (nAcc & 0x800000) !== 0;
                        const prevMsb = (pAcc & 0x800000) !== 0;
                        if (msb && !prevMsb) vv.msbFlipped = true;
                        const b19 = (nAcc & 0x080000) !== 0;
                        const prevB19 = (pAcc & 0x080000) !== 0;
                        if (tBit) vv.lfsr = 0x7FFFF8;
                        else if (!prevB19 && b19) vv.clockNoise();
                        vv.acc = nAcc;
                        vv.stepEnv();
                    }
                    
                    // Hard Sync Logic
                    for(let i=0; i<3; i++) {
                        const vv = v[i];
                        const mod = v[i===0?2:i-1];
                        if (vv.ctrl & 0x02 && mod.msbFlipped) vv.acc = 0;
                        mod.msbFlipped = false; 
                    }
                    
                    // Output
                    v[0].compute(v[2].acc);
                    v[1].compute(v[0].acc);
                    v[2].compute(v[1].acc);
                    
                    const v0 = (mixer.voices[0].muted ? 0 : v[0].output) * mixer.voices[0].volume;
                    const v1 = (mixer.voices[1].muted ? 0 : v[1].output) * mixer.voices[1].volume;
                    const v2 = (mixer.voices[2].muted ? 0 : v[2].output) * mixer.voices[2].volume;
                    
                    // Filter runs at full clock rate
                    const mono = filter.process([v0, v1, v2], 0, CLOCK);
                    
                    // 3. Feed Resampler
                    resampler.push(mono, mono);
                    
                    // 4. Drain Resampler
                    while (resampler.ready && outIdx < outputSamplesTotal) {
                        const frame = resampler.generate();
                        if (frame) {
                            // Apply Mastering Chain per sample (Post-Resample)
                            const mix = frame[0] * mixer.masterVolume;
                            const [l, r] = fx.process(mix, mix);
                            leftBuf[outIdx] = l;
                            rightBuf[outIdx] = r;
                            outIdx++;
                        }
                    }
                    
                    currentCycle++;
                }
                
                if (currentCycle < totalCycles) {
                    if (onProgress) onProgress(outIdx / outputSamplesTotal);
                    setTimeout(processChunk, 0); 
                } else {
                    if (onProgress) onProgress(1.0);
                    // Trim buffer to actual size generated
                    const finalL = leftBuf.slice(0, outIdx);
                    const finalR = rightBuf.slice(0, outIdx);
                    resolve(createWavFile(finalL, OUTPUT_RATE, 2, finalR));
                }
            };
            processChunk();
        });
    }
}
