
import { ParsedTrace, SidEvent, MasteringParams, MixerParams } from '../types';
import { MASTERING_DSP_CODE } from './masteringDsp';
import { generateHifiWorkletCode } from './hifiSidService';
import { SystemLogger } from './Logger';
import { SID_CONTROL_CODE, sidEvents, sidClock, sidRegister, sidByte, sidSpeed, sidMask, sidMixer, sidSeek, type SidSeekOptions } from './sidPlaybackControls';

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
    const safeClock = Number(clock);
    if (!Number.isFinite(safeNote) || !Number.isFinite(safeClock) || safeClock <= 0) return 0;
    const hz = 440 * Math.pow(2, (safeNote - 69) / 12);
    const val = Math.round((hz * 16777216) / safeClock);
    if (!Number.isFinite(val)) return 0;
    return Math.max(0, Math.min(65535, val));
}

export function generateWaveformPoints(ctrl: number, pw: number, freq: number, points: number, phaseOffset: number): number[] {
    if (!Number.isInteger(points) || points <= 0 || points > 1_000_000) return [];
    const arr = new Float32Array(points);
    const isTri = (ctrl & 0x10) !== 0;
    const isSaw = (ctrl & 0x20) !== 0;
    const isPul = (ctrl & 0x40) !== 0;
    const isNoi = (ctrl & 0x80) !== 0;
    const duty = Math.max(0, Math.min(1, Number(pw) / 4095));

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
            const framesPerSecond = json.header?.fps === undefined
                ? (header.clock >= 1_000_000 ? 60 : 50) : Number(json.header.fps);
            if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) throw new Error('Trace FPS must be a positive number');
            const cyclesPerFrame = header.clock / framesPerSecond;
            const previous = new Array(32).fill(-1);
            events = frames.flatMap((frame: number[], frameIndex: number) => frame.slice(0, 32).flatMap((value, reg) => {
                const safeValue = Number(value) & 0xFF;
                if (previous[reg] === safeValue) return [];
                previous[reg] = safeValue;
                return [{ cycles: Math.floor(frameIndex * cyclesPerFrame), reg, val: safeValue }];
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
  const tgt = Number.isFinite(targetCycle) ? Math.max(0, targetCycle) : 0;
  const events: SidEvent[] = (trace as any).events || [];
  // Preserve precision for long traces; bitwise coercion wraps after 2^31.
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (events[mid].cycles <= tgt) lo = mid + 1;
    else hi = mid;
  }
  for (let i = 0; i < lo; i++) {
    const e = events[i];
    regs[e.reg & 0x1F] = e.val & 0xFF;
  }
  return Array.from(regs);
}

const F6581_BASE = [220, 221, 222, 225, 230, 240, 260, 300, 380, 500, 750, 1200, 2000, 3500, 6000, 9500, 13500, 16000];
const F8580_BASE = [0, 20, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800];

export function generateWorkletCode(): string {
  // We don't inject MASTERING_DSP_CODE via regex anymore to avoid issues.
  // Instead we rely on the implementation inside.
  return `
(function(){
/* INJECTED DSP */
${MASTERING_DSP_CODE}
${SID_CONTROL_CODE}

const F6581 = __F6581__;
const F8580 = __F8580__;
const ADSR_RATE = [9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251];

const getExpPeriod = (env) => {
    if (env > 93) return 1; if (env > 54) return 2; if (env > 26) return 4;
    if (env > 14) return 8; if (env > 6) return 16;
    return env > 0 ? 30 : 1;
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
    this.rateCount = (this.rateCount + 1) & 0x7FFF;
    if (this.rateCount === ADSR_RATE[rate]) {
      this.rateCount = 0;
      if (this.phase === 1) { if (this.env < 255) this.env++; if (this.env === 255) this.phase = 2; }
      else {
        if (++this.expCount >= getExpPeriod(this.env)) {
          this.expCount = 0;
          const sus = (this.sr >> 4) * 17;
          if (this.phase === 2 || this.phase === 3) { if (this.env > sus) this.env--; this.phase = this.env <= sus ? 3 : 2; }
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
    const ctrl = this.ctrl; if (!(ctrl & 0xF0)) return 2048;
    const tri = ctrl & 0x10, saw = ctrl & 0x20, pul = ctrl & 0x40, noi = ctrl & 0x80;
    if (noi) {
      const l = this.lfsr;
      return (((l>>22)&1)<<11 | ((l>>20)&1)<<10 | ((l>>16)&1)<<9 | ((l>>13)&1)<<8 | 
              ((l>>11)&1)<<7 | ((l>>7)&1)<<6 | ((l>>4)&1)<<5 | ((l>>2)&1)<<4);
    }
    let tV = 0, sV = 0, pV = 0;
    const ringActive = (ctrl & 0x04) !== 0;
    const msb = ((this.acc ^ (ringActive ? modAcc : 0)) & 0x800000) !== 0;
    
    if (tri) {
      let temp = (this.acc >> 11) & 0x0FFF; 
      if (msb) temp ^= 0x0FFF;
      tV = temp;
    }
    if (saw) sV = (this.acc >> 12) & 0xFFF;
    if (pul) pV = ((this.acc >> 12) >= (this.pw & 0xFFF) ? 0xFFF : 0x000);
    
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
    const g = Math.min(0.9, Math.max(0, Math.tan(3.14159 * f0 / fs8)));
    const k = [1.8,1.6,1.4,1.2,1.0,0.8,0.6,0.5,0.4,0.3,0.2,0.1,0.05,0.02,0.01,0.005][this.res];
    let vi = 0, vnf = 0;
    const muteV3 = (this.mode & 0x08) !== 0;
    for(let i=0; i<3; i++) { 
        if (i === 2 && muteV3 && !(this.routes & 4)) continue;
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
    this.f = new Filter(); this.fR = new Filter(); this.m = new MasteringChain(sampleRate); this.d = new Decim(); this.dR = new Decim();
    this.ev = []; this.ei = 0; this.cy = 0; this.ncQ = 0n; this.clk = 985248; this.spd = 1.0; this.ply = false;
    this.regs = new Uint8Array(32); this.act = new Uint8Array(32);
    this.msk = [true, true, true]; this.sc=0; this.vPeaks=[0,0,0]; this.vRms=[0,0,0]; this.mPeaks=[0,0]; this.vRmsSamples = 0;
    this.mixerGains = [1.0, 1.0, 1.0]; this.mixerPans = [0,0,0]; this.masterVol = 0.5;
    this.seekTarget = null; this.seekReports = 0;
    this.port.onmessage = (e) => {
      const { type, payload } = e.data || {};
      try {
        if (type === 'DISPOSE') { this.stopped = true; return; }
        if (type === 'DATA') {
          const events = sidEvents(payload?.events), clock = sidClock(payload?.clock);
          this.ev = events; this.clk = clock; this.resetState(0);
        } else if (type === 'PLAY') this.ply = payload === true;
        else if (type === 'SEEK') {
          const request = typeof payload === 'object' && payload !== null
            ? sidSeek(payload.cycles,payload.mode) : sidSeek(payload);
          this.resetState(request.cycles,request.mode === 'replay');
        } else if (type === 'SPEED') this.spd = sidSpeed(payload);
        else if (type === 'MODEL') {
          if (payload !== '6581' && payload !== '8580') throw new Error('Invalid SID model');
          this.f.model = payload; this.fR.model = payload;
          this.v.forEach(v => v.model = payload); this.m.setModel(payload);
        } else if (type === 'MASTER') {
          if (payload && typeof payload === 'object' && !Array.isArray(payload)) this.m.updateParams(payload);
        } else if (type === 'MASK') this.msk = sidMask(payload);
        else if (type === 'LIVE') {
          const reg = sidRegister(payload?.reg), val = sidByte(payload?.val);
          if (reg >= 25) throw new Error('SID readback registers are read-only');
          this.write(reg,val);
          if (!this.ply) this.publishSnapshot();
        } else if (type === 'MIXER') {
          const mixer = sidMixer(payload), solo = mixer.voices.some(v => v.solo);
          this.masterVol = mixer.masterVolume;
          mixer.voices.forEach((v,i) => {
            this.mixerGains[i] = v.muted || (solo && !v.solo) ? 0 : v.volume;
            this.mixerPans[i] = v.pan;
          });
        }
      } catch (error) {
        this.port.postMessage({ type: 'CONTROL_ERROR', message: String(error.message || error) });
      }
    };
  }

  resetState(cycle, replay = false) {
    const target = Number.isSafeInteger(cycle) && cycle >= 0 ? cycle : 0;
    const model = this.f.model;
    this.f = new Filter(); this.fR = new Filter();
    this.f.model = model; this.fR.model = model;
    this.v.forEach(v => v.reset());
    this.m.reset(); this.d = new Decim(); this.dR = new Decim();
    this.regs.fill(0); this.act.fill(0); this.vPeaks.fill(0); this.vRms.fill(0); this.mPeaks.fill(0); this.sc = 0; this.vRmsSamples = 0;
    this.ei = 0;
    const registerTarget = replay ? 0 : target;
    while (this.ei < this.ev.length && this.ev[this.ei].cycles <= registerTarget) {
      const e = this.ev[this.ei++]; this.write(e.reg,e.val);
    }
    this.cy = registerTarget; this.ncQ = BigInt(registerTarget) << 32n;
    this.seekTarget = replay && target > 0 ? target : null; this.seekReports = 0;
    this.publishSnapshot();
  }
  updateReadbacks() {
    const voice = this.v[2];
    this.regs[27] = voice.ctrl & 0xf0 ? (Math.floor(voice.getWave(this.v[1].acc) / 16) & 255) : 0;
    this.regs[28] = voice.env & 255;
  }
  publishSnapshot() {
    this.updateReadbacks();
    this.port.postMessage({ type: 'STATUS', cy: this.cy, regs: Array.from(this.regs), act: Array.from(this.act),
      seeking: this.seekTarget,
      vS: this.v.map(v => ({ level: v.env / 255, state: v.phase ?? v.envState, freq: v.f, pw: v.pw, ctrl: v.ctrl, phase: v.acc })),
      phys: { temp: this.currTemp ?? 30, power: 0.7, vSupply: this.f.model === '6581' ? 12 : 9 },
      vPeaks: [0,0,0], vRms: [0,0,0], mPeaks: [0,0] });
  }
  advanceSeek() {
    const target = this.seekTarget, end = Math.min(target,this.cy + SID_REPLAY_BUDGET);
    while (this.cy < end) {
      while (this.ei < this.ev.length && this.ev[this.ei].cycles <= this.cy) {
        const event = this.ev[this.ei++]; this.write(event.reg,event.val);
      }
      this.stepOneSidCycle(); this.cy++;
    }
    while (this.ei < this.ev.length && this.ev[this.ei].cycles <= this.cy) {
      const event = this.ev[this.ei++]; this.write(event.reg,event.val);
    }
    this.ncQ = BigInt(this.cy) << 32n;
    if (this.cy === target) {
      this.seekTarget = null;
      this.v.forEach(v => { if ('sAcc' in v) { v.sAcc = 0; v.sCnt = 0; } });
    }
    if (this.seekTarget === null || ++this.seekReports >= 16) {
      this.seekReports = 0; this.publishSnapshot();
    }
  }
  write(r, v) {
    if (r >= 25) return; // Readbacks are derived, not writable trace state.
    r &= 31; v &= 255; if (this.regs[r] !== v) this.act[r] = 255; this.regs[r] = v;
    if (r < 21) this.v[(r/7)|0].write(r % 7, v); else if (r < 25) { this.f.write(r,v); this.fR.write(r,v); }
  }
  stepOneSidCycle() {
            const p0 = this.v[0].acc; const p1 = this.v[1].acc; const p2 = this.v[2].acc;
            const inc0 = this.v[0].f; const inc1 = this.v[1].f; const inc2 = this.v[2].f;
            let n0 = (this.v[0].ctrl & 8) ? 0 : (p0 + inc0) & 0xFFFFFF; let n1 = (this.v[1].ctrl & 8) ? 0 : (p1 + inc1) & 0xFFFFFF; let n2 = (this.v[2].ctrl & 8) ? 0 : (p2 + inc2) & 0xFFFFFF;
            const f0 = (n0 & 0x800000) && !(p0 & 0x800000); const f1 = (n1 & 0x800000) && !(p1 & 0x800000); const f2 = (n2 & 0x800000) && !(p2 & 0x800000);
            if ((this.v[0].ctrl & 2) && f2 && !((this.v[2].ctrl & 2) && f1)) n0 = 0;
            if ((this.v[1].ctrl & 2) && f0 && !((this.v[0].ctrl & 2) && f2)) n1 = 0;
            if ((this.v[2].ctrl & 2) && f1 && !((this.v[1].ctrl & 2) && f0)) n2 = 0;
            if (this.v[0].ctrl & 0x08) n0 = 0; if (this.v[1].ctrl & 0x08) n1 = 0; if (this.v[2].ctrl & 0x08) n2 = 0;
            this.v[0].acc = n0; this.v[0].msbFlipped = f0; this.v[1].acc = n1; this.v[1].msbFlipped = f1; this.v[2].acc = n2; this.v[2].msbFlipped = f2;
            const b19_0 = (n0 & 0x080000) && !(p0 & 0x080000); const b19_1 = (n1 & 0x080000) && !(p1 & 0x080000); const b19_2 = (n2 & 0x080000) && !(p2 & 0x080000);
            if (this.v[0].ctrl & 0x08) this.v[0].lfsr = 0x7FFFF8; else if (b19_0) this.v[0].clockNoise();
            if (this.v[1].ctrl & 0x08) this.v[1].lfsr = 0x7FFFF8; else if (b19_1) this.v[1].clockNoise();
            if (this.v[2].ctrl & 0x08) this.v[2].lfsr = 0x7FFFF8; else if (b19_2) this.v[2].clockNoise();
            this.v.forEach(x => x.stepEnv());
  }
  process(inputs, outputs) {
    if (this.stopped) return false;
    const outL = outputs[0]?.[0], outR = outputs[0]?.[1]; if (!outL) return true;
    if (this.seekTarget !== null) { this.advanceSeek(); outL.fill(0); if (outR) outR.fill(0); return true; }
    if (!this.ply) { outL.fill(0); if (outR) outR.fill(0); return true; }
    const step = BigInt(Math.floor(((this.clk * this.spd) / sampleRate / 8) * 4294967296.0));

    for (let i=0; i<outL.length; i++) {
      let sum = 0, sumR = 0;
      for (let s=0; s<8; s++) {
        if (this.ply) {
          this.ncQ += step; const target = Number(this.ncQ >> 32n);
          while (this.cy < target) {
            while (this.ei < this.ev.length && this.ev[this.ei].cycles <= this.cy) { this.write(this.ev[this.ei].reg, this.ev[this.ei].val); this.ei++; }
            this.stepOneSidCycle();
            this.v[0].accumulate(this.v[2].acc); this.v[1].accumulate(this.v[0].acc); this.v[2].accumulate(this.v[1].acc);
            this.cy++;
          }
        } else {
            this.v[0].accumulate(this.v[2].acc); this.v[1].accumulate(this.v[0].acc); this.v[2].accumulate(this.v[1].acc);
        }
        const v0 = this.v[0].getSample(); const v1 = this.v[1].getSample(); const v2 = this.v[2].getSample();
        const ins = [(this.msk[0]?v0:0) * this.mixerGains[0], (this.msk[1]?v1:0) * this.mixerGains[1], (this.msk[2]?v2:0) * this.mixerGains[2]];
        sum += this.f.process(ins.map((v,j) => v * (1 - Math.max(0,this.mixerPans[j]))), 0);
        sumR += this.fR.process(ins.map((v,j) => v * (1 + Math.min(0,this.mixerPans[j]))), 0);
        for(let j=0; j<3; j++) { let val=Math.abs(ins[j]); this.vPeaks[j]=Math.max(this.vPeaks[j], val); this.vRms[j]+=val*val; }
      }
      let avg = sum / 8.0, avgR = sumR / 8.0;
      const [fL, fR] = this.m.process(this.d.proc(avg) * this.masterVol, this.dR.proc(avgR) * this.masterVol);
      outL[i] = fL; if (outR) outR[i] = fR;
      this.mPeaks[0]=Math.max(this.mPeaks[0], Math.abs(fL)); this.mPeaks[1]=Math.max(this.mPeaks[1], Math.abs(fR));
    }
    this.vRmsSamples += outL.length * 8;
    if (++this.sc >= 15) {
      this.updateReadbacks();
      this.port.postMessage({ type:'STATUS', cy:this.cy, regs:Array.from(this.regs), act:Array.from(this.act), vS:this.v.map(v=>({level:v.env/255, state:v.phase, freq:v.f, pw:v.pw, ctrl:v.ctrl, phase: v.acc})), phys:{temp:30+this.vRms.reduce((a,b)=>a+b,0)/Math.max(1,this.vRmsSamples)*15, power:0.7, vSupply:this.f.model === '6581' ? 12 : 9}, vPeaks:[...this.vPeaks], vRms:this.vRms.map(x=>Math.sqrt(x/Math.max(1,this.vRmsSamples))), mPeaks:[...this.mPeaks] });
      this.sc=0; this.vRmsSamples=0; this.vPeaks.fill(0); this.vRms.fill(0); this.mPeaks.fill(0);
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
  volatileSeekTarget: number | null = null;
  clk = CLOCK_PAL;
  readyPromise: Promise<void> | null = null;
  private processorName = 'sid-processor';
  private model: '6581' | '8580' = '6581';
  private mastering?: MasteringParams;
  private mixer?: MixerParams;
  private previewNode: AudioWorkletNode | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewGeneration = 0;
  private destroyed = false;

  constructor(ctx: AudioContext) { this.ctx = ctx; }

  async init(engineType: 'STD' | 'HIFI' = 'STD'): Promise<void> {
    if (this.destroyed) throw new Error('SID player has been destroyed');
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
        try {
          await this.ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        if (this.destroyed) throw new Error('SID player has been destroyed');
        this.node = new AudioWorkletNode(this.ctx, procName, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        this.processorName = procName;
        this.node.connect(this.ctx.destination);
        
        this.node.port.onmessage = (e) => {
          if (this.destroyed) return;
          if (e.data.type === 'CONTROL_ERROR') SystemLogger.log('Audio control', e.data.message, 'error');
          if (e.data.type === 'STATUS') {
            this.volatileSeekTarget = e.data.seeking ?? null;
            this.volatileCycles = e.data.cy; this.volatileRegs = e.data.regs;
            this.volatileVoiceStates = e.data.vS; this.volatilePhysics = e.data.phys;
            this.volatileVoicePeaks = e.data.vPeaks; this.volatileVoiceRms = e.data.vRms; this.volatileMasterPeaks = e.data.mPeaks;
          }
        };
    })().catch(error => { this.readyPromise = null; throw error; });
    return this.readyPromise;
  }

  async setData(ev: SidEvent[], clk?: number) {
      const sorted = sidEvents(ev), clock = sidClock(clk);
      await this.readyPromise;
      // Trace formats commonly omit $D418 when it is implicit in a frame dump.
      // A fresh worklet starts at volume zero, so establish a sensible SID
      // default only when the trace does not set volume at startup itself.
      const hasInitialVolume = sorted.some(event => event.reg === SID_REG.MODE_VOL && event.cycles === 0);
      if (!hasInitialVolume) sorted.unshift({ cycles: 0, reg: SID_REG.MODE_VOL, val: 0x0F });
      this.clk = clock;
      this.node?.port.postMessage({ type: 'DATA', payload: { events: sorted, clock: this.clk } }); 
  }

  async setPlaybackSpeed(speed: number) {
      await this.readyPromise;
      this.node?.port.postMessage({ type: 'SPEED', payload: sidSpeed(speed) });
  }
  
  setSpeed(speed: number) { return this.setPlaybackSpeed(speed); }
  async setVoiceMask(m: [boolean, boolean, boolean]) { await this.readyPromise; this.node?.port.postMessage({ type: 'MASK', payload: sidMask(m) }); }
  async play() { 
      await this.readyPromise;
      if (this.ctx.state === 'suspended') await this.ctx.resume(); 
      if (this.destroyed) throw new Error('SID player has been destroyed');
      this.isPlaying = true; 
      this.node?.port.postMessage({ type: 'PLAY', payload: true }); 
  }
  async pause() { await this.readyPromise; this.isPlaying = false; this.node?.port.postMessage({ type: 'PLAY', payload: false }); }
  async seek(cycles: number, options: SidSeekOptions = {}) {
      const request = sidSeek(cycles, options.mode);
      await this.readyPromise;
      if (request.mode === 'replay' && this.ctx.state === 'suspended') await this.ctx.resume();
      if (this.destroyed) throw new Error('SID player has been destroyed');
      this.volatileSeekTarget = request.mode === 'replay' ? cycles : null;
      if (request.mode === 'registers') this.volatileCycles = cycles;
      this.node?.port.postMessage({ type: 'SEEK', payload: request });
  }
  getRegister(addressOrOffset: number) { return this.volatileRegs[sidRegister(addressOrOffset)] ?? 0; }
  async setModel(model: '6581' | '8580') { if (model !== '6581' && model !== '8580') throw new Error('Invalid SID model'); this.model = model; await this.readyPromise; this.node?.port.postMessage({ type: 'MODEL', payload: model }); }
  async setMasteringParams(p: MasteringParams) { this.mastering = p; await this.readyPromise; this.node?.port.postMessage({ type: 'MASTER', payload: p }); }
  async setMixerParams(p: MixerParams) { const normalized = sidMixer(p) as MixerParams; this.mixer = normalized; await this.readyPromise; this.node?.port.postMessage({ type: 'MIXER', payload: normalized }); }

  /** Isolated, cycle-timed audition: never changes song registers or transport. */
  async audition(registers: number[], durationMs = 350, clock = this.clk) {
      if (registers.length !== 7 || registers.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('Audition requires seven voice-register bytes');
      if (!Number.isFinite(clock) || clock < 100_000 || clock > 2_000_000) throw new Error('Invalid SID clock');
      if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 10000) throw new Error('Invalid audition duration');
      this.stopAudition();
      const generation = this.previewGeneration;
      await this.readyPromise;
      if (!this.node || generation !== this.previewGeneration) return;
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      if (generation !== this.previewGeneration) return;
      const preview = new AudioWorkletNode(this.ctx, this.processorName, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      this.previewNode = preview;
      const events = registers.flatMap((val, reg) => reg === 4 ? [] : [{ cycles: 0, reg, val }]);
      events.push({ cycles: 0, reg: 24, val: 15 }, { cycles: 0, reg: 4, val: (registers[4] & 0xF0) | 1 });
      events.push({ cycles: Math.round(durationMs * clock / 1000), reg: 4, val: registers[4] & 0xF0 });
      preview.port.postMessage({ type: 'MODEL', payload: this.model });
      if (this.mastering) preview.port.postMessage({ type: 'MASTER', payload: this.mastering });
      preview.port.postMessage({ type: 'MIXER', payload: {
          masterVolume: this.mixer?.masterVolume ?? 0.5,
          voices: Array.from({ length: 3 }, () => ({ volume: 1, pan: 0, muted: false, solo: false }))
      } });
      preview.port.postMessage({ type: 'DATA', payload: { events, clock } });
      preview.port.postMessage({ type: 'PLAY', payload: true });
      preview.connect(this.ctx.destination);
      // Worst-case decay from full envelope at this release rate, plus FX tail.
      const rates = [9,32,63,95,149,220,267,313,392,977,1954,3126,3907,11720,19532,31251];
      const releaseMs = 756 * rates[registers[6] & 15] / clock * 1000;
      this.previewTimer = setTimeout(() => this.stopAudition(), durationMs + releaseMs + 1000);
  }

  stopAudition() {
      this.previewGeneration++;
      if (this.previewTimer !== null) clearTimeout(this.previewTimer);
      this.previewTimer = null;
      this.previewNode?.port.postMessage({ type: 'DISPOSE' });
      this.previewNode?.disconnect();
      this.previewNode = null;
  }
  
  liveWrite(reg: number, val: number) {
      const offset = sidRegister(reg), byte = sidByte(val);
      if (offset >= 25) throw new Error('SID readback registers are read-only');
      this.node?.port.postMessage({ type: 'LIVE', payload: { reg: offset, val: byte } });
  }

  getEstimatedCycles() { return this.volatileCycles; }
  destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.isPlaying = false; this.volatileSeekTarget = null;
      this.stopAudition();
      this.node?.port.postMessage({ type: 'DISPOSE' });
      this.node?.disconnect();
      if (this.node) this.node.port.onmessage = null;
      this.node = null;
      this.readyPromise = null;
      if (this.ctx.state !== 'closed') void this.ctx.close().catch(error => SystemLogger.log('Audio cleanup', String(error), 'error'));
  }
}
