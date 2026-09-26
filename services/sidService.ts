
import { ParsedTrace, SidEvent, MasteringParams, MixerParams } from '../types';
import { MASTERING_DSP_CODE } from './masteringDsp';
import { generateHifiWorkletCode } from './hifiSidService';
import { SystemLogger } from './Logger';

/**
 * SID OS playback core
 * - Fixed AudioWorklet Race Conditions
 * - Added Register Constants
 * - Improved Cycle Timing
 */

export const CLOCK_PAL = 985248;
export const CLOCK_NTSC = 1022727;

export const SID_REG = {
    V1_FREQ_LO: 0, V1_FREQ_HI: 1, V1_PW_LO: 2, V1_PW_HI: 3, V1_CTRL: 4, V1_AD: 5, V1_SR: 6,
    V2_FREQ_LO: 7, V2_FREQ_HI: 8, V2_PW_LO: 9, V2_PW_HI: 10, V2_CTRL: 11, V2_AD: 12, V2_SR: 13,
    V3_FREQ_LO: 14, V3_FREQ_HI: 15, V3_PW_LO: 16, V3_PW_HI: 17, V3_CTRL: 18, V3_AD: 19, V3_SR: 20,
    FC_LO: 21, FC_HI: 22, RES_FILT: 23, MODE_VOL: 24,
    POT_X: 25, POT_Y: 26, OSC3: 27, ENV3: 28
};

const NOTES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];

export function getNoteName(freq: number, clock: number): string {
    if (freq < 50) return '---'; 
    const hz = (freq * clock) / 16777216;
    if (hz <= 0 || !Number.isFinite(hz)) return '---';
    const midi = Math.round(69 + 12 * Math.log2(hz / 440));
    if (midi < 0 || !Number.isFinite(midi)) return '---';
    const oct = Math.floor(midi / 12);
    const note = NOTES[midi % 12];
    const safeOct = Math.max(0, Math.min(9, oct));
    return `${note}${safeOct}`;
}

export function midiNoteToFreq(note: number, clock: number): number {
    const safeNote = Number(note);
    if (!Number.isFinite(safeNote)) return 0;
    const hz = 440 * Math.pow(2, (safeNote - 69) / 12);
    const val = Math.round((hz * 16777216) / clock);
    if (!Number.isFinite(val)) return 0;
    return Math.max(0, Math.min(65535, val));
}

export function generateWaveformPoints(ctrl: number, pw: number, freq: number, points: number, phaseOffset: number): number[] {
    const arr = new Float32Array(points);
    const isTri = (ctrl & 0x10) !== 0;
    const isSaw = (ctrl & 0x20) !== 0;
    const isPul = (ctrl & 0x40) !== 0;
    const isNoi = (ctrl & 0x80) !== 0;
    const duty = pw / 4095;

    for (let i = 0; i < points; i++) {
        const phase = (phaseOffset + i / points) % 1.0;
        let v = 0;
        let active = 0;
        
        if (isTri) { v += (Math.abs(phase - 0.5) * 4 - 1); active++; }
        if (isSaw) { v += (phase * 2 - 1); active++; }
        if (isPul) { v += (phase < duty ? 1 : -1); active++; }
        if (isNoi) { v += Math.random() * 2 - 1; active++; }
        
        if (active > 1) v /= active;
        if (active === 0) v = 0;
        
        arr[i] = v;
    }
    return Array.from(arr);
}

export function analyzeArpeggio(freqs: number[]): { x: number, y: number } | null {
    if (freqs.length < 3) return null;
    const f0 = freqs[0];
    if (f0 <= 0) return null;
    if (freqs[1] > f0 && freqs[2] > freqs[1]) {
        const s1 = Math.round(12 * Math.log2(freqs[1] / f0));
        const s2 = Math.round(12 * Math.log2(freqs[2] / f0));
        if (s1 > 0 && s1 < 16 && s2 > s1 && s2 < 16) {
            return { x: s1, y: s2 };
        }
    }
    return null;
}

export function detectVibrato(freqs: number[]): boolean {
    if (freqs.length < 6) return false;
    let fluc = 0;
    let prevDir = 0;
    for(let i=1; i<freqs.length; i++) {
        const diff = freqs[i] - freqs[i-1];
        if (diff !== 0) {
            const dir = Math.sign(diff);
            if (dir !== prevDir && prevDir !== 0) fluc++;
            prevDir = dir;
        }
    }
    return fluc > 1;
}

export function parseTraceFile(content: string): ParsedTrace | null {
    try {
        let json: any;
        try {
            json = JSON.parse(content);
        } catch {
            const records = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
            json = records.reduce((trace, record) => {
                if (Array.isArray(record)) {
                    trace.frames.push(record);
                    return trace;
                }
                if (!record || typeof record !== 'object') {
                    throw new Error('JSONL records must be objects or register arrays');
                }
                if (record.header && (typeof record.header !== 'object' || Array.isArray(record.header))) {
                    throw new Error('JSONL header must be an object');
                }
                if (record.frames !== undefined && !Array.isArray(record.frames)) {
                    throw new Error('JSONL frames must be an array');
                }
                if (record.events !== undefined && !Array.isArray(record.events)) {
                    throw new Error('JSONL events must be an array');
                }
                trace.header = { ...trace.header, ...(record.header || {}) };
                trace.frames.push(...(record.frames || (record.frame !== undefined ? [record.frame] : [])));
                trace.events.push(...(record.events || (record.event !== undefined ? [record.event] : [])));
                return trace;
            }, { header: {} as Record<string, unknown>, frames: [] as unknown[], events: [] as unknown[] });
        }
        if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray(json.frames)) {
            throw new Error('Trace data must contain a frames array');
        }
        if (json.frames.length === 0) throw new Error('Trace data contains no frames');
        if (json.header !== undefined && (!json.header || typeof json.header !== 'object' || Array.isArray(json.header))) {
            throw new Error('Trace header must be an object');
        }
        const header = { ...(json.header || {}), clock: Number(json.header?.clock) || CLOCK_PAL, song: String(json.header?.song || 'Unknown') };
        if (!Number.isFinite(header.clock) || header.clock <= 0) throw new Error('Trace clock must be a positive number');
        
        const frames = json.frames.map((frame: any, frameIndex: number) => {
            const values = Array.isArray(frame) || frame instanceof Uint8Array
                ? Array.from(frame)
                : frame && typeof frame === 'object' ? Object.values(frame) : null;
            if (!values || values.length < 25) {
                throw new Error(`Trace frame ${frameIndex + 1} must contain at least 25 SID registers`);
            }
            return values.slice(0, 32).map((value, register) => {
                const number = Number(value);
                if (!Number.isInteger(number) || number < 0 || number > 255) {
                    throw new Error(`Trace frame ${frameIndex + 1}, register ${register} is not a byte`);
                }
                return number;
            });
        });
        
        if (json.events !== undefined && !Array.isArray(json.events)) {
            throw new Error('Trace events must be an array');
        }
        let events = json.events;
        if (!events || events.length === 0) {
            const framesPerSecond = Number(json.header?.fps) || 50;
            if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) throw new Error('Trace FPS must be a positive number');
            const cyclesPerFrame = Math.max(1, Math.round(header.clock / framesPerSecond));
            const previous = new Array(32).fill(-1);
            events = frames.flatMap((frame: number[], frameIndex: number) => frame.slice(0, 32).flatMap((value, reg) => {
                const safeValue = Number(value) & 0xFF;
                if (previous[reg] === safeValue) return [];
                previous[reg] = safeValue;
                return [{ cycles: frameIndex * cyclesPerFrame, reg, val: safeValue }];
            }));
        } else {
            events = events.map((event: any, index: number) => {
                if (!event || typeof event !== 'object') throw new Error(`Trace event ${index + 1} must be an object`);
                const cycles = Number(event.cycles);
                const reg = Number(event.reg);
                const val = Number(event.val);
                if (!Number.isSafeInteger(cycles) || cycles < 0 || !Number.isInteger(reg) || reg < 0 || reg > 31 || !Number.isInteger(val) || val < 0 || val > 255) {
                    throw new Error(`Trace event ${index + 1} has invalid cycle, register, or value`);
                }
                return { cycles, reg, val, index };
            }).sort((a: SidEvent & { index: number }, b: SidEvent & { index: number }) => a.cycles - b.cycles || a.index - b.index)
              .map(({ index, ...event }: SidEvent & { index: number }) => event);
        }
        
        return {
            header,
            frames: frames,
            events: events
        };
    } catch (e) {
        SystemLogger.log('Trace parser', 'Unable to parse trace data.', 'error', e);
        return null;
    }
}

export function getRegsAtCycle(trace: ParsedTrace | null | undefined, targetCycle: number): number[] {
  if (!trace) return new Array(32).fill(0);
  const regs = new Uint8Array(32);
  const tgt = targetCycle | 0;
  const events: SidEvent[] = (trace as any).events || [];
  // Binary search could be better, but linear is safe for now
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if ((e.cycles | 0) > tgt) break;
    regs[e.reg & 0x1F] = e.val & 0xFF;
  }
  return Array.from(regs);
}

const F6581_BASE = [220, 221, 222, 225, 230, 240, 260, 300, 380, 500, 750, 1200, 2000, 3500, 6000, 9500, 13500, 16000];
const F8580_BASE = [0, 20, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800];

function generateWorkletCode(): string {
  // We don't inject MASTERING_DSP_CODE via regex anymore to avoid issues.
  // Instead we rely on the implementation inside.
  return `
(function(){
/* INJECTED DSP */
${MASTERING_DSP_CODE}

const F6581 = __F6581__;
const F8580 = __F8580__;
const ADSR_RATE = [9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251];

const getExpPeriod = (env) => {
    if (env >= 255) return 1; if (env >= 93) return 2; if (env >= 54) return 4;
    if (env >= 26) return 8; if (env >= 14) return 16; if (env >= 6) return 30;
    return 1;
};

class Slew {
  constructor(v=0, f=0.001) { this.v=v; this.t=v; this.f=f; }
  set(t) { this.t=t; }
  step() { this.v = this.v*(1.0-this.f) + this.t*this.f; return this.v; }
}

class Voice {
  constructor(i) { this.i = i; this.model = '6581'; this.reset(); }
  reset() {
    this.f = 0; this.pw = 0; this.ctrl = 0; this.ad = 0; this.sr = 0;
    this.acc = 0; this.lfsr = 0x7FFFFF; this.env = 0;
    this.phase = 0; this.gate = false; this.rateCount = 0; this.expCount = 0;
    this.output = 0; this.raw12 = 0; this.lastBit19 = 0; this.msbFlipped = false;
    this.sAcc = 0; this.sCnt = 0;
    this.sf = new Slew(0, 0.05); this.spw = new Slew(0, 0.01); this.se = new Slew(0, 0.05);
  }
  write(r, v) {
    v &= 255;
    switch(r) {
      case 0: this.f = (this.f & 0xFF00) | v; this.sf.set(this.f); break;
      case 1: this.f = (this.f & 0x00FF) | (v << 8); this.sf.set(this.f); break;
      case 2: this.pw = (this.pw & 0x0F00) | v; this.spw.set(this.pw); break;
      case 3: this.pw = (this.pw & 0x00FF) | ((v & 0x0F) << 8); this.spw.set(this.pw); break;
      case 4: {
        const ng = (v & 0x01) !== 0;
        if (ng && !this.gate) { this.phase = 1; this.expCount = 0; }
        else if (!ng && this.gate) { this.phase = 4; }
        if (v & 0x08) { this.acc = 0; this.lfsr = 0x7FFFFF; }
        this.ctrl = v; this.gate = ng;
        break;
      }
      case 5: this.ad = v; break;
      case 6: this.sr = v; break;
    }
  }
  stepEnv() {
    if (this.phase === 0) { this.env = 0; return; }
    const a = (this.ad >> 4) & 0xF, d = this.ad & 0xF, r = this.sr & 0xF;
    const rate = (this.phase === 1) ? a : ((this.phase === 2 || this.phase === 3) ? d : r);
    if (++this.rateCount >= ADSR_RATE[rate]) {
      this.rateCount = 0;
      if (this.phase === 1) { if (this.env < 255) this.env++; else this.phase = 2; }
      else {
        if (++this.expCount >= getExpPeriod(this.env)) {
          this.expCount = 0;
          const sus = (this.sr >> 4) * 17;
          if (this.phase === 2) { if (this.env > sus) this.env--; else this.phase = 3; }
          else if (this.phase === 4) { if (this.env > 0) this.env--; else this.phase = 0; }
        }
      }
    }
  }
  clockNoise() {
    const b22 = (this.lfsr >> 22) & 1;
    const b17 = (this.lfsr >> 17) & 1;
    this.lfsr = ((this.lfsr << 1) | (b22 ^ b17)) & 0x7FFFFF;
  }
  getWave(modAcc) {
    const ctrl = this.ctrl; if (ctrl & 0x08) return 0;
    const tri = ctrl & 0x10, saw = ctrl & 0x20, pul = ctrl & 0x40, noi = ctrl & 0x80;
    if (noi) {
      const l = this.lfsr;
      return (((l>>22)&1)<<11 | ((l>>20)&1)<<10 | ((l>>16)&1)<<9 | ((l>>13)&1)<<8 | 
              ((l>>11)&1)<<7 | ((l>>7)&1)<<6 | ((l>>4)&1)<<5 | ((l>>2)&1)<<4);
    }
    let tV = 0, sV = 0, pV = 0;
    const ringActive = (ctrl & 0x04) !== 0;
    const msb = ringActive ? ((modAcc & 0x800000) !== 0) : ((this.acc & 0x800000) !== 0);
    
    if (tri) {
      let temp = (this.acc >> 11) & 0x0FFF; 
      if (msb) temp ^= 0x0FFF;
      tV = (temp << 1) & 0xFFF;
    }
    if (saw) sV = (this.acc >> 12) & 0xFFF;
    if (pul) pV = ((this.acc >> 12) >= (this.spw.step() & 0xFFF) ? 0xFFF : 0x000);
    
    const active = (tri?1:0) + (saw?1:0) + (pul?1:0);
    if (active === 0) return 0;
    if (active === 1) return tri?tV : (saw?sV : pV);
    
    let res = 0xFFF;
    if (this.model === '8580') { 
        if (tri) res &= tV; if (saw) res &= sV; if (pul) res &= pV; 
    } else { 
        if (tri) res &= (tV | 0x080); if (saw) res &= (sV | 0x040); if (pul) res &= pV; 
    }
    return res & 0xFFF;
  }
  accumulate(modAcc) {
    this.raw12 = this.getWave(modAcc);
    this.se.set(this.env / 255.0);
    const val = ((this.raw12 / 2048.0) - 1.0) * this.se.step();
    this.sAcc += val;
    this.sCnt++;
  }
  getSample() {
    if (this.sCnt === 0) return this.output;
    this.output = this.sAcc / this.sCnt;
    this.sAcc = 0; this.sCnt = 0;
    return this.output;
  }
}

class Filter {
  constructor() {
    this.z1=0; this.z2=0; this.model='6581'; this.cut=0; this.res=0; this.mode=0; this.vol=0; this.routes=0;
    this.scut=new Slew(0,0.01); this.svol=new Slew(0,0.01);
  }
  write(r, v) {
    if (r === 21) this.cut = (this.cut & 0x7F8) | (v & 0x07);
    else if (r === 22) this.cut = (this.cut & 0x007) | (v << 3);
    else if (r === 23) { this.res = v >> 4; this.routes = v & 0xF; }
    else if (r === 24) { this.mode = v >> 4; this.vol = v & 0xF; }
    this.scut.set(this.cut); this.svol.set(this.vol / 15.0);
  }
  process(ins, ext) {
    const rawCut = this.scut.step();
    const f0 = (this.model === '8580' ? F8580 : F6581)[Math.floor(rawCut)&2047];
    const fs8 = sampleRate * 8;
    const g = Math.min(0.9, Math.max(0.001, Math.tan(3.14159 * f0 / fs8)));
    const k = [1.8,1.6,1.4,1.2,1.0,0.8,0.6,0.5,0.4,0.3,0.2,0.1,0.05,0.02,0.01,0.005][this.res];
    let vi = 0, vnf = 0;
    const muteV3 = (this.mode & 0x08) !== 0;
    for(let i=0; i<3; i++) { 
        if (i === 2 && muteV3) continue;
        if ((this.routes >> i) & 1) vi += ins[i]; else vnf += ins[i]; 
    }
    if ((this.routes >> 3) & 1) vi += ext; else vnf += ext;
    if (this.model === '6581') vi = Math.max(-2.0, Math.min(2.0, vi * 1.2)); 
    const h = 1.0 / (1.0 + g * (g + k));
    const hp = (vi - (k + g) * this.z1 - this.z2) * h;
    const vBP = g * hp; const bp = vBP + this.z1; this.z1 = vBP + bp;
    const vLP = g * bp; const lp = vLP + this.z2; this.z2 = vLP + lp;
    if (!Number.isFinite(this.z1)) this.z1 = 0;
    if (!Number.isFinite(this.z2)) this.z2 = 0;
    let vf = 0; 
    if (this.mode & 1) vf += lp; if (this.mode & 2) vf += bp; if (this.mode & 4) vf += hp;
    return (vnf + vf) * this.svol.step() * 0.5;
  }
}

class Decim {
  constructor() { this.y1=0; }
  proc(x) { this.y1 = this.y1 + 0.3 * (x - this.y1); return this.y1; }
}

class SidProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.v = [new Voice(0), new Voice(1), new Voice(2)];
    this.f = new Filter(); this.m = new MasteringChain(sampleRate); this.d = new Decim();
    this.ev = []; this.ei = 0; this.cy = 0; this.ncQ = 0n; this.clk = 985248; this.spd = 1.0; this.ply = false;
    this.regs = new Uint8Array(32); this.act = new Uint8Array(32);
    this.msk = [true, true, true]; this.sc=0; this.vPeaks=[0,0,0]; this.vRms=[0,0,0]; this.mPeaks=[0,0];
    this.mixerGains = [1.0, 1.0, 1.0]; this.masterVol = 0.5;
    this.port.onmessage = (e) => {
        const { type, payload } = e.data || {};
        if (type === 'DATA') { this.ev = payload.events || []; this.clk = payload.clock|0; this.ei=0; this.cy=0; this.ncQ=0n; }
        else if (type === 'PLAY') this.ply = !!payload;
        else if (type === 'MODEL') { this.f.model = payload; this.v.forEach(v=>v.model=payload); }
        else if (type === 'MASTER') this.m.updateParams(payload);
        else if (type === 'MASK') this.msk = payload;
        else if (type === 'LIVE') this.write(payload.reg, payload.val);
        else if (type === 'MIXER') { this.masterVol = payload.masterVolume; payload.voices.forEach((v, i) => { this.mixerGains[i] = v.muted ? 0 : v.volume; }); }
    };
  }
  write(r, v) {
    r &= 31; v &= 255; if (this.regs[r] !== v) this.act[r] = 255; this.regs[r] = v;
    if (r < 21) this.v[(r/7)|0].write(r % 7, v); else if (r < 25) this.f.write(r, v);
  }
  process(inputs, outputs) {
    const outL = outputs[0][0], outR = outputs[0][1]; if (!outL) return true;
    const step = BigInt(Math.floor(((this.clk * this.spd) / sampleRate / 8) * 4294967296.0));
    let dcOffset = 0;
    if (this.f.model === '6581') { const vol = this.f.vol; dcOffset = (vol - 7.5) / 15.0 * 0.08; }

    for (let i=0; i<outL.length; i++) {
      let sum = 0;
      for (let s=0; s<8; s++) {
        if (this.ply) {
          this.ncQ += step; const target = Number(this.ncQ >> 32n);
          while (this.cy < target) {
            while (this.ei < this.ev.length && (this.ev[this.ei].cycles|0) <= this.cy) { this.write(this.ev[this.ei].reg, this.ev[this.ei].val); this.ei++; }
            const p0 = this.v[0].acc; const p1 = this.v[1].acc; const p2 = this.v[2].acc;
            const inc0 = (this.v[0].sf.step() | 0); const inc1 = (this.v[1].sf.step() | 0); const inc2 = (this.v[2].sf.step() | 0);
            let n0 = (p0 + inc0) & 0xFFFFFF; let n1 = (p1 + inc1) & 0xFFFFFF; let n2 = (p2 + inc2) & 0xFFFFFF;
            const f0 = (n0 & 0x800000) && !(p0 & 0x800000); const f1 = (n1 & 0x800000) && !(p1 & 0x800000); const f2 = (n2 & 0x800000) && !(p2 & 0x800000);
            if ((this.v[0].ctrl & 0x02) && f2) n0 = 0; if ((this.v[1].ctrl & 0x02) && f0) n1 = 0; if ((this.v[2].ctrl & 0x02) && f1) n2 = 0;
            if (this.v[0].ctrl & 0x08) n0 = 0; if (this.v[1].ctrl & 0x08) n1 = 0; if (this.v[2].ctrl & 0x08) n2 = 0;
            this.v[0].acc = n0; this.v[0].msbFlipped = f0; this.v[1].acc = n1; this.v[1].msbFlipped = f1; this.v[2].acc = n2; this.v[2].msbFlipped = f2;
            const b19_0 = (n0 & 0x080000) && !(p0 & 0x080000); const b19_1 = (n1 & 0x080000) && !(p1 & 0x080000); const b19_2 = (n2 & 0x080000) && !(p2 & 0x080000);
            if (this.v[0].ctrl & 0x08) this.v[0].lfsr = 0x7FFFF8; else if (b19_0) this.v[0].clockNoise();
            if (this.v[1].ctrl & 0x08) this.v[1].lfsr = 0x7FFFF8; else if (b19_1) this.v[1].clockNoise();
            if (this.v[2].ctrl & 0x08) this.v[2].lfsr = 0x7FFFF8; else if (b19_2) this.v[2].clockNoise();
            this.v.forEach(x => x.stepEnv());
            this.v[0].accumulate(p2); this.v[1].accumulate(p0); this.v[2].accumulate(p1);
            this.cy++;
          }
        } else {
            this.v[0].accumulate(this.v[2].acc); this.v[1].accumulate(this.v[0].acc); this.v[2].accumulate(this.v[1].acc);
        }
        const v0 = this.v[0].getSample(); const v1 = this.v[1].getSample(); const v2 = this.v[2].getSample();
        const ins = [(this.msk[0]?v0:0) * this.mixerGains[0], (this.msk[1]?v1:0) * this.mixerGains[1], (this.msk[2]?v2:0) * this.mixerGains[2]];
        if (this.f.model === '6581') { ins[0] += dcOffset * 0.1; ins[1] += dcOffset * 0.1; ins[2] += dcOffset * 0.1; }
        sum += this.f.process(ins, 0);
        for(let j=0; j<3; j++) { let val=Math.abs(ins[j]); this.vPeaks[j]=Math.max(this.vPeaks[j], val); this.vRms[j]+=val*val; }
      }
      let avg = sum / 8.0; if (this.f.model === '6581') avg += dcOffset;
      const [fL, fR] = this.m.process((this.d.proc(avg)) * this.masterVol, (this.d.proc(avg)) * this.masterVol);
      outL[i] = fL; if (outR) outR[i] = fR;
      this.mPeaks[0]=Math.max(this.mPeaks[0], Math.abs(fL)); this.mPeaks[1]=Math.max(this.mPeaks[1], Math.abs(fR));
    }
    if (++this.sc >= 15) {
      this.regs[0x1B] = (this.v[2].raw12 >> 4) & 0xFF;
      this.regs[0x1C] = this.v[2].env;
      this.port.postMessage({ type:'STATUS', cy:this.cy, regs:Array.from(this.regs), act:Array.from(this.act), vS:this.v.map(v=>({level:v.env/255, state:v.envState, freq:v.f, pw:v.pw, ctrl:v.ctrl, phase: v.acc})), phys:{temp:30+this.vRms.reduce((a,b)=>a+b,0)*15, power:0.7, vSupply:12}, vPeaks:[...this.vPeaks], vRms:this.vRms.map(x=>Math.sqrt(x/1920)), mPeaks:[...this.mPeaks] });
      this.sc=0; this.vPeaks.fill(0); this.vRms.fill(0); this.mPeaks.fill(0);
    }
    return true;
  }
}
registerProcessor('sid-processor', SidProcessor);
})();
`;
}

export class SidPlayer {
  node: AudioWorkletNode | null = null;
  volatileCycles = 0; volatileRegs: number[] = new Array(32).fill(0); volatileVoiceStates = Array(3).fill(0).map(() => ({ level: 0, state: 0, freq: 0, pw: 0, ctrl: 0, phase: 0 }));
  volatilePhysics = { temp: 36, power: 0.7, vSupply: 12.0 }; volatileVoicePeaks = [0,0,0]; volatileVoiceRms = [0,0,0]; volatileMasterPeaks = [0,0];
  ctx: AudioContext; isPlaying = false;
  clk = CLOCK_PAL;
  readyPromise: Promise<void> | null = null;

  constructor(ctx: AudioContext) { this.ctx = ctx; }

  async init(engineType: 'STD' | 'HIFI' = 'STD'): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
        const f6581 = new Array(2048).fill(0).map((_, i) => {
          const idx = (i / 2047) * (F6581_BASE.length - 1);
          const i0 = Math.floor(idx), i1 = Math.min(i0 + 1, F6581_BASE.length - 1), f = idx - i0;
          return F6581_BASE[i0] * (1 - f) + F6581_BASE[i1] * f;
        });
        const f8580 = new Array(2048).fill(0).map((_, i) => {
          const idx = (i / 2047) * (F8580_BASE.length - 1);
          const i0 = Math.floor(idx), i1 = Math.min(i0 + 1, F8580_BASE.length - 1), f = idx - i0;
          return F8580_BASE[i0] * (1 - f) + F8580_BASE[i1] * f;
        });

        let code;
        let procName;

        if (engineType === 'HIFI') {
            code = generateHifiWorkletCode();
            procName = 'hifi-sid-processor';
        } else {
            code = generateWorkletCode();
            procName = 'sid-processor';
        }

        code = code.replace(/__F6581__/g, JSON.stringify(f6581)).replace(/__F8580__/g, JSON.stringify(f8580));
        
        const blob = new Blob([code], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await this.ctx.audioWorklet.addModule(url);
        this.node = new AudioWorkletNode(this.ctx, procName);
        this.node.connect(this.ctx.destination);
        
        this.node.port.onmessage = (e) => {
          if (e.data.type === 'STATUS') {
            this.volatileCycles = e.data.cy; this.volatileRegs = e.data.regs;
            this.volatileVoiceStates = e.data.vS; this.volatilePhysics = e.data.phys;
            this.volatileVoicePeaks = e.data.vPeaks; this.volatileVoiceRms = e.data.vRms; this.volatileMasterPeaks = e.data.mPeaks;
          }
        };
    })();
    return this.readyPromise;
  }

  async setData(ev: SidEvent[], clk?: number) {
      await this.readyPromise; 
      const sorted = [...ev].sort((a,b) => a.cycles - b.cycles);
      // Trace formats commonly omit $D418 when it is implicit in a frame dump.
      // A fresh worklet starts at volume zero, so establish a sensible SID
      // default only when the trace does not set volume at startup itself.
      const hasInitialVolume = sorted.some(event => event.reg === SID_REG.MODE_VOL && event.cycles === 0);
      if (!hasInitialVolume) sorted.unshift({ cycles: 0, reg: SID_REG.MODE_VOL, val: 0x0F });
      this.clk = clk || CLOCK_PAL; 
      this.node?.port.postMessage({ type: 'DATA', payload: { events: sorted, clock: this.clk } }); 
  }
  
  async setVoiceMask(m: [boolean, boolean, boolean]) { await this.readyPromise; this.node?.port.postMessage({ type: 'MASK', payload: m }); }
  async play() { 
      await this.readyPromise;
      if (this.ctx.state === 'suspended') await this.ctx.resume(); 
      this.isPlaying = true; 
      this.node?.port.postMessage({ type: 'PLAY', payload: true }); 
  }
  async pause() { await this.readyPromise; this.isPlaying = false; this.node?.port.postMessage({ type: 'PLAY', payload: false }); }
  async seek(cycles: number) { await this.readyPromise; this.node?.port.postMessage({ type: 'SEEK', payload: cycles }); }
  async setModel(model: '6581' | '8580') { await this.readyPromise; this.node?.port.postMessage({ type: 'MODEL', payload: model }); }
  async setMasteringParams(p: MasteringParams) { await this.readyPromise; this.node?.port.postMessage({ type: 'MASTER', payload: p }); }
  async setMixerParams(p: MixerParams) { await this.readyPromise; this.node?.port.postMessage({ type: 'MIXER', payload: p }); }
  
  liveWrite(reg: number, val: number) { this.node?.port.postMessage({ type: 'LIVE', payload: { reg, val } }); }

  getEstimatedCycles() { return this.volatileCycles; }
  destroy() { this.node?.disconnect(); this.node = null; this.readyPromise = null; }
}
