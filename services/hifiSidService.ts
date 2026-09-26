
import { MASTERING_DSP_CODE } from './masteringDsp';

// Helper to strip imports for worklet injection
function stripModuleSyntax(js: string): string {
  return (js || '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('import ') && !line.trim().startsWith('export {'))
    .join('\n')
    .replace(/^\s*export\s+/gm, '');
}

export function generateHifiWorkletCode(): string {
  const mastering = stripModuleSyntax(MASTERING_DSP_CODE || '');
  
  return `
(function(){
${mastering}

const F6581 = __F6581__;
const F8580 = __F8580__;

const ADSR_RATE = [9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251];

const expPeriodForEnv = (env) => {
  if (env === 0xFF) return 1;
  if (env === 0x5D) return 2;
  if (env === 0x36) return 4;
  if (env === 0x1A) return 8;
  if (env === 0x0E) return 16;
  if (env === 0x06) return 30;
  if (env === 0x00) return 1;
  return null;
};

const ENV_IDLE = 0;
const ENV_ATTACK = 1;
const ENV_DECAY = 2;
const ENV_SUSTAIN = 3;
const ENV_RELEASE = 4;

class Slew {
  constructor(v = 0, f = 1.0) { this.v = v; this.t = v; this.f = f; }
  set(t) { this.t = t; }
  step() { this.v = this.v * (1.0 - this.f) + this.t * this.f; return this.v; }
}

const noise12FromLfsr = (l) => (
  (((l >> 22) & 1) << 11) | (((l >> 20) & 1) << 10) | (((l >> 16) & 1) << 9)  | (((l >> 13) & 1) << 8)  |
  (((l >> 11) & 1) << 7)  | (((l >> 7)  & 1) << 6)  | (((l >> 4)  & 1) << 5)  | (((l >> 2)  & 1) << 4)  |
  (((l >> 1)  & 1) << 3)  | (((l >> 0)  & 1) << 2)  | (((l >> 17) & 1) << 1)  | (((l >> 19) & 1) << 0)
) & 0xFFF;

class Voice {
  constructor(i) {
    this.i = i;
    this.model = '6581';
    this.reset();
    this.raw12 = 0;
  }

  reset() {
    this.f = 0; this.pw = 0; this.ctrl = 0; this.ad = 0; this.sr = 0;
    this.acc = 0; this.lfsr = 0x7FFFF8; this.msbFlipped = false;
    this.env = 0; this.envState = ENV_IDLE;
    this.gate = false; this.rateCount = 0; this.expCount = 0; this.expPeriod = 1;
    this.output = 0;
    this.raw12 = 0;
    
    // Tuned Slew Rates for accurate register capacitance
    this.sf = new Slew(0, 0.05); 
    this.spw = new Slew(0, 0.005);
    this.se = new Slew(0, 0.05);
  }

  write(r, v) {
    v &= 255;
    switch (r) {
      case 0: this.f = (this.f & 0xFF00) | v; this.sf.set(this.f); break;
      case 1: this.f = (this.f & 0x00FF) | (v << 8); this.sf.set(this.f); break;
      case 2: this.pw = (this.pw & 0x0F00) | v; this.spw.set(this.pw); break;
      case 3: this.pw = (this.pw & 0x00FF) | ((v & 0x0F) << 8); this.spw.set(this.pw); break;
      case 4: {
        const oldCtrl = this.ctrl | 0;
        const newCtrl = v | 0;
        const newGate = (newCtrl & 0x01) !== 0;
        const oldGate = (oldCtrl & 0x01) !== 0;
        
        if ((newCtrl & 0x08) && !(oldCtrl & 0x08)) { 
            this.acc = 0; 
            this.lfsr = 0x7FFFF8; 
        }
        
        if (newGate && !oldGate) { 
            this.envState = ENV_ATTACK; 
            this.gate = true; 
            this.expCount = 0; 
            this.expPeriod = 1; 
        } else if (!newGate && oldGate) { 
            this.envState = ENV_RELEASE; 
            this.gate = false; 
        }
        this.ctrl = newCtrl;
        break;
      }
      case 5: this.ad = v; break;
      case 6: this.sr = v; break;
    }
  }

  clockNoise() {
    const b22 = (this.lfsr >> 22) & 1;
    const b17 = (this.lfsr >> 17) & 1;
    this.lfsr = ((this.lfsr << 1) | (b22 ^ b17)) & 0x7FFFFF;
  }

  stepEnv() {
    if (this.envState === ENV_IDLE) return;
    const a = (this.ad >> 4) & 0xF, d = (this.ad) & 0xF, r = (this.sr) & 0xF;
    const rateIdx = (this.envState === ENV_ATTACK) ? a : (this.envState === ENV_DECAY || this.envState === ENV_SUSTAIN) ? d : r;
    const period = ADSR_RATE[rateIdx] | 0;
    this.rateCount = (this.rateCount + 1) & 0x7FFF;
    if (this.rateCount !== period) return;
    this.rateCount = 0;

    if (this.envState === ENV_ATTACK) {
      if (this.env < 0xFF) this.env = (this.env + 1) & 0xFF;
      else this.envState = ENV_DECAY;
      return;
    }
    const p = expPeriodForEnv(this.env);
    if (p !== null) this.expPeriod = p;
    this.expCount++;
    if (this.expCount < this.expPeriod) return;
    this.expCount = 0;
    const sus = ((this.sr >> 4) & 0xF) * 17;
    if (this.envState === ENV_DECAY) {
      if (this.env > sus) this.env = (this.env - 1) & 0xFF; else this.envState = ENV_SUSTAIN;
    } else if (this.envState === ENV_RELEASE) {
      if (this.env > 0) this.env = (this.env - 1) & 0xFF; else this.envState = ENV_IDLE;
    }
  }

  getWave(modAcc) {
    const ctrl = this.ctrl | 0;
    const tri = (ctrl & 0x10) !== 0;
    const saw = (ctrl & 0x20) !== 0;
    const pul = (ctrl & 0x40) !== 0;
    const noi = (ctrl & 0x80) !== 0;
    const noWave = !tri && !saw && !pul && !noi;

    if (noWave) {
      this.raw12 = 0;
      return 2048;
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
    
    if (noi || this.model === '8580') nV = noise12FromLfsr(this.lfsr);

    const active = (tri?1:0) + (saw?1:0) + (pul?1:0) + (noi?1:0);
    let result = 0;

    if (active === 1) result = tri ? tV : saw ? sV : pul ? pV : nV;
    else if (this.model === '8580') {
      result = 0x0FFF;
      if (tri) result &= tV;
      if (saw) result &= sV;
      if (pul) result &= pV;
      if (noi) result &= nV;
    } else {
      result = 0x0FFF;
      if (tri) result &= (tV | 0x080);
      if (saw) result &= (sV | 0x040);
      if (pul) result &= pV;
      if (noi) result &= nV;
    }
    
    this.raw12 = result & 0xFFF;
    return this.raw12;
  }

  compute(modAcc) {
    const raw = this.getWave(modAcc);
    this.se.set(this.env / 255.0);
    const waveMask = (this.ctrl & 0xF0);
    const isCombined = waveMask && ((waveMask & (waveMask - 0x10)) !== 0); 
    const gain = (isCombined && this.model === '6581') ? 0.85 : 1.0;
    const val = ((raw / 4095.0) - 0.5) * 2.0 * this.se.step() * gain;
    this.output = val;
  }
}

class Filter {
  constructor() {
    this.z1 = 0; this.z2 = 0; this.model = '6581'; this.cut = 0; this.res = 0; this.mode = 0; this.vol = 0; this.routes = 0;
    // Updated Slew Rates for proper capacitor simulation
    this.scut = new Slew(0, 0.0005); // 0.0005 is roughly 2200Hz pole at 44.1k, much smoother
    this.svol = new Slew(0, 0.001); 
    this.sres = new Slew(0, 0.005);  
  }
  
  reset() {
      this.z1 = 0;
      this.z2 = 0;
  }

  write(r, v) {
    if (r === 21) { this.cut = (this.cut & 0x7F8) | (v & 0x07); }
    else if (r === 22) { this.cut = (this.cut & 0x007) | ((v & 0xFF) << 3); }
    else if (r === 23) { this.res = (v >> 4) & 0xF; this.routes = v & 0xF; this.sres.set(this.res); }
    else if (r === 24) { this.mode = (v >> 4) & 0xF; this.vol = v & 0xF; }
    
    this.scut.set(this.cut);
    this.svol.set(this.vol / 15.0);
  }
  
  process(ins, ext, sr) {
    const rawCut = this.scut.step();
    const cutInt = Math.floor(rawCut);
    const cutFrac = rawCut - cutInt;
    const table = (this.model === '8580' ? F8580 : F6581);
    
    const tableVal0 = table[cutInt & 2047] || 0;
    const tableVal1 = table[Math.min(cutInt + 1, 2047)] || 0;
    const f0 = tableVal0 + (tableVal1 - tableVal0) * cutFrac;
    
    const rawRes = this.sres.step();
    
    const w0 = 2 * Math.PI * f0 / (sr * 8);
    
    const g = Math.sin(w0) / (1 + Math.cos(w0));
    const clippedG = Math.max(0.001, Math.min(0.9, g));
    const dampingBase = [2.0, 1.8, 1.6, 1.4, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1][Math.floor(rawRes) & 15] || 1.0;
    const k = this.model === '6581' ? (dampingBase * 0.8) : dampingBase;
    
    let vi = 0, vnf = 0;
    const CHIP_LEAKAGE = 0.005; 
    
    const muteV3 = (this.mode & 0x08) !== 0;

    for (let i = 0; i < 3; i++) {
        if (i === 2 && muteV3) continue;
        if ((this.routes >> i) & 1) vi += ins[i]; else vnf += ins[i]; 
    }
    
    if ((this.routes >> 3) & 1) vi += ext; else vnf += ext;
    vi += CHIP_LEAKAGE; vnf += CHIP_LEAKAGE;
    if (this.model === '6581') vi = Math.tanh(vi * 0.8) * 1.25;
    
    const feedback = (k + clippedG) * this.z1;
    const distortedFeedback = (this.model === '6581') ? Math.tanh(feedback) : feedback;
    
    const h = 1.0 / (1.0 + clippedG * (clippedG + k));
    const hp = (vi - distortedFeedback - this.z2) * h;
    
    const v1_svf = clippedG * hp; const bp = v1_svf + this.z1; this.z1 = bp + v1_svf;
    const v2_svf = clippedG * bp; const lp = v2_svf + this.z2; this.z2 = lp + v2_svf;
    
    this.z1 = Math.max(-4.0, Math.min(4.0, this.z1));
    this.z2 = Math.max(-4.0, Math.min(4.0, this.z2));
    
    if (!Number.isFinite(this.z1)) this.z1 = 0;
    if (!Number.isFinite(this.z2)) this.z2 = 0;

    let vf = 0;
    if (this.mode & 1) vf += lp; 
    if (this.mode & 2) vf += bp; 
    if (this.mode & 4) vf += hp;
    if (this.model === '6581') vf += vi * 0.05;
    
    return (vnf + vf) * this.svol.step();
  }
}

class DualDCNeutralizer {
  constructor() { this.x1 = 0; this.y1 = 0; this.x2 = 0; this.y2 = 0; }
  process(x) {
    const y1 = x - this.x1 + 0.996 * this.y1;
    this.x1 = x; this.y1 = y1;
    const y2 = y1 - this.x2 + 0.999 * this.y2;
    this.x2 = y1; this.y2 = y2;
    return y2; 
  }
}

class HifiSidProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.v = [new Voice(0), new Voice(1), new Voice(2)];
    this.filter = new Filter();
    
    this.m = new MasteringChain(sampleRate);
    this.dcL = new DualDCNeutralizer(); this.dcR = new DualDCNeutralizer();
    this.ev = []; this.ei = 0; this.cy = 0; this.ncQ = 0n;
    this.clk = 985248; this.spd = 1.0; this.ply = false;
    this.regs = new Uint8Array(32); this.act = new Uint8Array(32);
    this.mixerGains = [1.0, 1.0, 1.0]; this.mixerPans = [0.0, 0.0, 0.0]; this.masterVol = 0.5;
    this.voiceMask = [true, true, true];
    this.sc = 0; this.vPeaks = [0, 0, 0]; this.vRms = [0, 0, 0]; this.mPeaks = [0, 0];
    this.currTemp = 28.0; this.ambientTemp = 28.0;

    this.port.onmessage = (e) => {
      const { type, payload } = e.data || {};
      if (type === 'DATA') { 
          this.ev = payload.events || []; 
          this.clk = (payload.clock | 0) || 985248; 
          this.ei = 0; 
          this.cy = 0; 
          this.ncQ = 0n; 
          this.m.reset(); 
          this.filter.reset(); 
      } 
      else if (type === 'PLAY') { 
          this.ply = !!payload; 
          if (!this.ply) this.m.reset();
          else this.filter.reset(); 
      } 
      else if (type === 'MODEL') { 
          this.filter.model = payload; 
          this.v.forEach((v) => (v.model = payload));
          this.m.setModel(payload); 
      } 
      else if (type === 'MASTER') { this.m.updateParams(payload); } 
      else if (type === 'MASK') { this.voiceMask = payload; } 
      else if (type === 'MIXER') { this.masterVol = payload.masterVolume; payload.voices.forEach((vv, i) => { this.mixerGains[i] = vv.muted ? 0 : vv.volume; this.mixerPans[i] = vv.pan; }); } 
      else if (type === 'LIVE') { this.write(payload.reg, payload.val); } 
      else if (type === 'SPEED') { this.spd = Math.max(0.01, +payload || 1.0); } 
      else if (type === 'SEEK') {
        const tgt = Math.max(0, payload | 0);
        this.ei = 0; this.cy = 0; this.ncQ = 0n;
        this.v.forEach((vv) => vv.reset());
        this.filter.reset();
        this.regs.fill(0); this.act.fill(0);
        while (this.ei < this.ev.length && (this.ev[this.ei].cycles | 0) <= tgt) { this.write(this.ev[this.ei].reg, this.ev[this.ei].val); this.ei++; }
        this.cy = tgt; this.ncQ = BigInt(tgt) << 32n;
      }
    };
  }

  write(r, v) {
    r &= 31; v &= 255;
    if (this.regs[r] !== v) this.act[r] = 255;
    this.regs[r] = v;
    if (r < 21) this.v[(r / 7) | 0].write(r % 7, v);
    else if (r < 25) this.filter.write(r, v);
  }

  stepOneSidCycle() {
    const v = this.v;
    const p0 = v[0].acc & 0xFFFFFF; const p1 = v[1].acc & 0xFFFFFF; const p2 = v[2].acc & 0xFFFFFF;
    const t0 = (v[0].ctrl & 0x08) !== 0; const t1 = (v[1].ctrl & 0x08) !== 0; const t2 = (v[2].ctrl & 0x08) !== 0;
    
    const f0 = (v[0].sf.step() | 0) & 0xFFFF;
    const f1 = (v[1].sf.step() | 0) & 0xFFFF;
    const f2 = (v[2].sf.step() | 0) & 0xFFFF;
    
    let n0 = t0 ? 0 : ((p0 + f0) & 0xFFFFFF);
    let n1 = t1 ? 0 : ((p1 + f1) & 0xFFFFFF);
    let n2 = t2 ? 0 : ((p2 + f2) & 0xFFFFFF);
    
    const rise0 = ((n0 & 0x800000) !== 0) && ((p0 & 0x800000) === 0);
    const rise1 = ((n1 & 0x800000) !== 0) && ((p1 & 0x800000) === 0);
    const rise2 = ((n2 & 0x800000) !== 0) && ((p2 & 0x800000) === 0);
    
    if ((v[0].ctrl & 0x02) && rise2) n0 = 0;
    if ((v[1].ctrl & 0x02) && rise0) n1 = 0;
    if ((v[2].ctrl & 0x02) && rise1) n2 = 0;
    
    v[0].msbFlipped = ((n0 & 0x800000) !== 0) && ((p0 & 0x800000) === 0);
    v[1].msbFlipped = ((n1 & 0x800000) !== 0) && ((p1 & 0x800000) === 0);
    v[2].msbFlipped = ((n2 & 0x800000) !== 0) && ((p2 & 0x800000) === 0);
    
    v[0].acc = n0; v[1].acc = n1; v[2].acc = n2;
    
    const b19p0 = (p0 >>> 19) & 1, b19n0 = (n0 >>> 19) & 1;
    const b19p1 = (p1 >>> 19) & 1, b19n1 = (n1 >>> 19) & 1;
    const b19p2 = (p2 >>> 19) & 1, b19n2 = (n2 >>> 19) & 1;
    
    if (t0) v[0].lfsr = 0x7FFFF8; else if (b19p0 === 0 && b19n0 === 1) v[0].clockNoise();
    if (t1) v[1].lfsr = 0x7FFFF8; else if (b19p1 === 0 && b19n1 === 1) v[1].clockNoise();
    if (t2) v[2].lfsr = 0x7FFFF8; else if (b19p2 === 0 && b19n2 === 1) v[2].clockNoise();
    
    v[0].stepEnv(); v[1].stepEnv(); v[2].stepEnv();
  }

  process(inputs, outputs) {
    const outL = outputs[0][0]; if (!outL) return true;
    const outR = outputs[0][1];
    
    const safeClk = this.clk || 985248;
    const safeRate = typeof sampleRate !== 'undefined' ? sampleRate : 48000;
    const rateDiv = safeRate > 0 ? safeRate : 48000;
    
    const rawStep = (safeClk * this.spd) / rateDiv / 8;
    const step = BigInt(Math.floor(rawStep * 4294967296.0));

    for (let i = 0; i < outL.length; i++) {
      let sumL = 0;
      for (let s = 0; s < 8; s++) {
        if (this.ply) {
          this.ncQ += step;
          const target = Number(this.ncQ >> 32n);
          let loopGuard = 5000; 
          while (this.cy < target) {
            if (--loopGuard < 0) {
                while (this.ei < this.ev.length && (this.ev[this.ei].cycles | 0) <= target) {
                    this.write(this.ev[this.ei].reg, this.ev[this.ei].val);
                    this.ei++;
                }
                this.cy = target;
                break;
            }
            while (this.ei < this.ev.length && (this.ev[this.ei].cycles | 0) <= this.cy) {
              this.write(this.ev[this.ei].reg, this.ev[this.ei].val);
              this.ei++;
            }
            this.stepOneSidCycle();
            this.cy++;
          }
        }
        
        this.v[0].compute(this.v[2].acc); 
        this.v[1].compute(this.v[0].acc); 
        this.v[2].compute(this.v[1].acc);
        
        const v0 = (this.voiceMask[0] ? this.v[0].output : 0) * this.mixerGains[0];
        const v1 = (this.voiceMask[1] ? this.v[1].output : 0) * this.mixerGains[1];
        const v2 = (this.voiceMask[2] ? this.v[2].output : 0) * this.mixerGains[2];
        
        const monoOutput = this.filter.process([v0, v1, v2], 0, safeRate);
        sumL += monoOutput;

        this.vPeaks[0] = Math.max(this.vPeaks[0], Math.abs(v0));
        this.vPeaks[1] = Math.max(this.vPeaks[1], Math.abs(v1));
        this.vPeaks[2] = Math.max(this.vPeaks[2], Math.abs(v2));
        this.vRms[0] += v0*v0; this.vRms[1] += v1*v1; this.vRms[2] += v2*v2;
      }
      
      const avg = sumL * 0.125; 
      const mixL = avg * this.masterVol;
      const mixR = avg * this.masterVol;
      
      const dcFreeL = this.dcL.process(mixL);
      const dcFreeR = outR ? this.dcR.process(mixR) : 0;
      
      const [fL, fR] = this.m.process(dcFreeL, dcFreeR);
      
      outL[i] = fL;
      if (outR) outR[i] = fR;
      
      this.mPeaks[0] = Math.max(this.mPeaks[0], Math.abs(outL[i]));
      this.mPeaks[1] = Math.max(this.mPeaks[1], Math.abs(outR ? outR[i] : 0));
    }

    if (++this.sc >= 20) {
      const dt = 20 / safeRate;
      const totalRms = this.vRms.reduce((a, b) => a + b, 0) / 2560;
      const quiescentP = this.clk === 985248 ? 0.85 : 0.72;
      const totalP = quiescentP + totalRms * 0.5;
      this.currTemp += (12.8 * totalP - 0.16 * (this.currTemp - this.ambientTemp)) * dt;
      this.regs[0x1B] = (this.v[2].raw12 >> 4) & 0xFF;
      this.regs[0x1C] = this.v[2].env & 0xFF;
      this.port.postMessage({
        type: 'STATUS', cy: this.cy, regs: Array.from(this.regs), act: Array.from(this.act),
        vS: this.v.map((vv) => ({ level: vv.env / 255, state: vv.envState, freq: vv.f, pw: vv.pw, ctrl: vv.ctrl, phase: vv.acc })),
        phys: { temp: this.currTemp, power: totalP, vSupply: this.clk === 985248 ? 12.0 : 9.0 },
        vPeaks: [...this.vPeaks], vRms: this.vRms.map((x) => Math.sqrt(x / 2560)), mPeaks: [...this.mPeaks]
      });
      this.sc = 0; this.vPeaks.fill(0); this.vRms.fill(0); this.mPeaks.fill(0);
      for (let i = 0; i < 32; i++) this.act[i] = (this.act[i] * 0.85) | 0;
    }
    return true;
  }
}

registerProcessor('hifi-sid-processor', HifiSidProcessor);
})();
`;
}
