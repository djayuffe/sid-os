
import { SidVoiceStatus, SidChipState, C64Config } from './SidTypes';

const RATE_PERIODS = [
    9, 32, 63, 95, 149, 220, 267, 313, 
    392, 977, 1954, 3126, 3907, 11720, 19532, 31251
];

// NMOS SID 6581 often has non-linear combined waveforms.
// Simplified model for bit-correct reproducibility of state.
const getCombinedWave = (model: '6581' | '8580', wf: number, tri: number, saw: number, pulse: number): number => {
  const enabled = (wf >> 4) & 0x07;
  if (enabled === 0) return 0;
  
  let out = 0xFFF;
  if (wf & 0x10) out &= tri;
  if (wf & 0x20) out &= saw;
  if (wf & 0x40) out &= pulse;
  
  // 6581 combined waveforms are "weak" and have DC offsets, 
  // but for bit-correct JSON we mostly care about the logic level.
  if (model === '6581' && (enabled > 1)) {
      return (out * 0.88) | 0; 
  }
  return out;
};

interface VoiceInternal {
  freq: number; pulse: number; control: number;
  attack: number; decay: number; sustain: number; release: number;
  gate: boolean; test: boolean; ringMod: boolean; sync: boolean;
  waveform: number;
  accumulator: number;   
  shiftRegister: number; 
  waveOutput: number; 
  envState: 'attack' | 'decay' | 'sustain' | 'release';
  envCounter: number;    
  rateCounter: number;   
  ratePeriod: number; 
  expDivider: number; 
  holdZero: boolean; 
  prevAccBit19: boolean;
  msbEdge: boolean;
  statePipeline: number; 
}

export class SidChip {
  private clockHz: number;
  private voices: VoiceInternal[] = [];
  private model: '6581' | '8580' = '6581';
  private registers: Uint8Array = new Uint8Array(32);
  private busValue = 0;
  private busBitsTTL: Int32Array = new Int32Array(8); 
  private defaultTTL = 0x4000;
  private filterCutoff = 0; private filterRes = 0; 
  private filterMode = 0; private filterVol = 0;
  private filterRouting = 0;
  // Track Filter state even if not used for audio generation
  private filterZ1 = 0;
  private filterZ2 = 0;
  
  // Analog inputs (Paddles)
  public potX = 0xFF;
  public potY = 0xFF;
  
  private config: C64Config;
  
  constructor(clockHz: number, config: C64Config) {
    this.clockHz = clockHz;
    this.config = config;
    this.defaultTTL = config.busPersistenceCycles || 0x1D00;
    for (let i = 0; i < 3; i++) this.voices.push(this.createVoice());
  }

  private createVoice(): VoiceInternal {
    return {
      freq: 0, pulse: 0, control: 0, attack: 0, decay: 0, sustain: 0, release: 0,
      gate: false, test: false, ringMod: false, sync: false, waveform: 0,
      accumulator: 0, shiftRegister: 0x7FFFFF, waveOutput: 0,
      envState: 'release', envCounter: 0xFF, 
      rateCounter: 0, 
      ratePeriod: RATE_PERIODS[0x0F], expDivider: 0,
      holdZero: true, prevAccBit19: false, msbEdge: false,
      statePipeline: 0
    };
  }

  public reset() {
    this.voices = this.voices.map(() => this.createVoice());
    this.registers.fill(0);
    this.busValue = 0; 
    this.busBitsTTL.fill(0);
    this.filterZ1 = 0;
    this.filterZ2 = 0;
    this.potX = 0xFF;
    this.potY = 0xFF;
  }

  public setModel(m: '6581' | '8580' | 'unknown') { 
    if (this.config.sidModelOverride && this.config.sidModelOverride !== 'AUTO') {
      this.model = this.config.sidModelOverride as '6581' | '8580';
    } else {
      this.model = m === '8580' ? '8580' : '6581'; 
    }
  }

  private refreshBus(val: number) {
      this.busValue = val;
      for (let i = 0; i < 8; i++) this.busBitsTTL[i] = this.defaultTTL;
  }

  public write(reg: number, val: number) {
      reg &= 0x1F;
      this.registers[reg] = val;
      this.refreshBus(val);
      const vIdx = Math.floor(reg / 7);
      if (vIdx < 3) {
          const v = this.voices[vIdx];
          const r = reg % 7;
          switch(r) {
              case 0: v.freq = (v.freq & 0xFF00) | val; break;
              case 1: v.freq = (v.freq & 0x00FF) | (val << 8); break;
              case 2: v.pulse = (v.pulse & 0x0F00) | val; break;
              case 3: v.pulse = (v.pulse & 0x00FF) | ((val & 0x0F) << 8); break;
              case 4: 
                  const oldGate = v.gate;
                  v.gate = (val & 0x01) !== 0;
                  v.sync = (val & 0x02) !== 0;
                  v.ringMod = (val & 0x04) !== 0;
                  v.test = (val & 0x08) !== 0;
                  v.waveform = (val >> 4) & 0x0F;
                  v.control = val;
                  if (v.test) { v.accumulator = 0; v.shiftRegister = 0x7FFFFF; }
                  if (v.gate && !oldGate) { 
                      v.envState = 'decay'; 
                      v.ratePeriod = RATE_PERIODS[v.decay];
                      v.statePipeline = this.config.enableAdsrPipeline ? 1 : 0; 
                      v.holdZero = false;
                  } else if (!v.gate && oldGate) {
                      v.envState = 'release';
                      v.ratePeriod = RATE_PERIODS[v.release];
                      v.statePipeline = this.config.enableAdsrPipeline ? 1 : 0;
                  }
                  break;
              case 5: v.attack = (val >> 4) & 0x0F; v.decay = val & 0x0F; break;
              case 6: v.sustain = (val >> 4) & 0x0F; v.release = val & 0x0F; break;
          }
      } else {
          if (reg === 0x15) this.filterCutoff = (this.filterCutoff & 0x7F8) | (val & 0x07);
          if (reg === 0x16) this.filterCutoff = (this.filterCutoff & 0x007) | (val << 3);
          if (reg === 0x17) { this.filterRes = val >> 4; this.filterRouting = val & 0x0F; }
          if (reg === 0x18) { this.filterMode = (val >> 4) & 0x07; this.filterVol = val & 0x0F; }
      }
  }

  public read(reg: number, defaultVal: number): number {
      reg &= 0x1F;
      if (reg === 0x19) {
          this.refreshBus(this.potX);
          return this.potX;
      }
      if (reg === 0x1A) {
          this.refreshBus(this.potY);
          return this.potY;
      }
      if (reg === 0x1B) { 
          const val = (this.voices[2].waveOutput >> 4) & 0xFF; 
          this.registers[reg] = val; 
          this.refreshBus(val); 
          return val; 
      }
      if (reg === 0x1C) { 
          const val = this.voices[2].envCounter; 
          this.registers[reg] = val; 
          this.refreshBus(val); 
          return val; 
      }
      let result = 0;
      for (let i = 0; i < 8; i++) if (this.busBitsTTL[i] > 0) result |= (this.busValue & (1 << i));
      return result;
  }

  private stepEnvelope(v: VoiceInternal) {
      if (v.statePipeline > 0) {
          v.statePipeline--;
          if (v.statePipeline === 0) {
              if (v.gate) { v.envState = 'attack'; v.ratePeriod = RATE_PERIODS[v.attack]; }
              else { v.envState = 'release'; v.ratePeriod = RATE_PERIODS[v.release]; }
          }
      }
      if (v.rateCounter <= 0) {
          const rateIdx = (v.envState === 'attack') ? v.attack : (v.envState === 'decay') ? v.decay : v.release;
          v.ratePeriod = RATE_PERIODS[rateIdx];
          v.rateCounter = v.ratePeriod;
          let doStep = true;
          if (v.envState !== 'attack') {
              const env = v.envCounter;
              let period = 1;
              if (env < 6) period = 30; else if (env < 14) period = 16; else if (env < 26) period = 8; else if (env < 54) period = 4; else if (env < 93) period = 2;
              v.expDivider = (v.expDivider + 1) % period;
              if (v.expDivider !== 0) doStep = false;
          }
          if (doStep) {
              if (v.envState === 'attack') {
                  v.envCounter = (v.envCounter + 1) & 0xFF;
                  if (v.envCounter === 0xFF) { v.envState = 'decay'; v.ratePeriod = RATE_PERIODS[v.decay]; }
              } else if (v.envState === 'decay') {
                  const target = (v.sustain << 4) | v.sustain;
                  if (v.envCounter > target) v.envCounter--;
                  else { v.envState = 'sustain'; v.envCounter = target; }
              } else if (v.envState === 'sustain') {
                  const target = (v.sustain << 4) | v.sustain;
                  if (v.envCounter > target) { v.envState = 'decay'; v.ratePeriod = RATE_PERIODS[v.decay]; }
              } else if (v.envState === 'release') { if (v.envCounter > 0) v.envCounter--; }
          }
      } else v.rateCounter--;
  }

  private calculateWave(vIdx: number): number {
      const v = this.voices[vIdx];
      const mod = this.voices[vIdx === 0 ? 2 : vIdx - 1];
      if (v.waveform === 0 || v.test) return 0;

      // RING MODULATION: Substitutes the MSB of the accumulator with the MSB of the modulator.
      // This is not an XOR of the two MSBs, but a direct replacement of the direction bit.
      const msb = v.ringMod ? (mod.accumulator & 0x800000) : (v.accumulator & 0x800000);
      
      // Triangle: bits 11-22 are used. If MSB is set, invert.
      const temp = (v.accumulator >>> 11) & 0x0FFF;
      const triPart = ((temp ^ (msb ? 0x0FFF : 0x0000)) << 1) & 0xFFF;

      const sawPart = (v.accumulator >> 12) & 0xFFF;
      const pulsePart = ((v.accumulator >> 12) >= (v.pulse & 0xFFF)) ? 0xFFF : 0x000;
      
      if (v.waveform & 8) { 
          // 23-bit LFSR output bits used for noise
          return (((v.shiftRegister >> 22) & 1) << 11 | ((v.shiftRegister >> 20) & 1) << 10 | 
                  ((v.shiftRegister >> 16) & 1) << 9 | ((v.shiftRegister >> 13) & 1) << 8 | 
                  ((v.shiftRegister >> 11) & 1) << 7 | ((v.shiftRegister >> 7) & 1) << 6 | 
                  ((v.shiftRegister >> 4) & 1) << 5 | ((v.shiftRegister >> 2) & 1) << 4);
      }
      return getCombinedWave(this.model, v.waveform, triPart, sawPart, pulsePart);
  }

  public update(cycles: number) {
    for (let i = 0; i < 8; i++) if (this.busBitsTTL[i] > 0) this.busBitsTTL[i] = Math.max(0, this.busBitsTTL[i] - cycles);
    for (let c = 0; c < cycles; c++) {
      for (let i = 0; i < 3; i++) {
        const v = this.voices[i];
        if (!v.test) {
          const prevAcc = v.accumulator;
          v.accumulator = (v.accumulator + v.freq) & 0xFFFFFF;
          v.msbEdge = (v.accumulator & 0x800000) !== 0 && (prevAcc & 0x800000) === 0;
          const bit19 = (v.accumulator & 0x080000) !== 0;
          if (bit19 !== v.prevAccBit19) {
            // Noise Shift Register Feedback (Bit 22 ^ Bit 17)
            const feedback = ((v.shiftRegister >> 22) ^ (v.shiftRegister >> 17)) & 1;
            v.shiftRegister = ((v.shiftRegister << 1) | feedback) & 0x7FFFFF;
          }
          v.prevAccBit19 = bit19;
        }
      }
      for (let i = 0; i < 3; i++) {
        const v = this.voices[i];
        const mod = this.voices[i === 0 ? 2 : i - 1];
        if (v.sync && mod.msbEdge) v.accumulator = 0;
      }
      for (let i = 0; i < 3; i++) { this.stepEnvelope(this.voices[i]); this.voices[i].waveOutput = this.calculateWave(i); }
      
      // Update Filter State (Simplistic) just for tracking stability
      if (this.filterMode !== 0) {
          this.filterZ1 *= 0.999;
          this.filterZ2 *= 0.999;
      }
    }
  }

  public getSnapshot(): SidChipState {
    const voices = this.voices.map(v => {
        const freqHz = (v.freq * this.clockHz) / 16777216;
        return {
            freqReg: v.freq, freqHz, midiNote: freqHz > 4 ? 69 + 12 * Math.log2(freqHz / 440) : 0,
            pitchBend: 0, envelope: v.envCounter / 255.0, gate: v.gate, waveform: v.waveform,
            rawWaveform: v.control, pulse: v.pulse, attack: v.attack, decay: v.decay,
            sustain: v.sustain, release: v.release, sync: v.sync, ringMod: v.ringMod,
            test: v.test, state: v.envState,
            noiseType: (v.waveform & 8) ? (v.freq > 0x8000 ? 'high' : v.freq > 0x4000 ? 'mid' : 'low') : 'none',
            triggered: false,
            oscillator: { accumulator: v.accumulator, shiftRegister: v.shiftRegister, pulseOutput: 0, waveOutput: v.waveOutput, prevAccBit19: v.prevAccBit19 },
            envelopeGen: { rateCounter: v.rateCounter, rateCounterPeriod: v.ratePeriod, exponentialCounter: v.expDivider, envelopeCounter: v.envCounter, state: v.envState, holdZero: v.holdZero }
        };
    }) as [SidVoiceStatus, SidVoiceStatus, SidVoiceStatus];
    
    this.registers[0x1B] = (this.voices[2].waveOutput >> 4) & 0xFF;
    this.registers[0x1C] = this.voices[2].envCounter;

    return { 
      voices, 
      filter: { cutoff: this.filterCutoff, resonance: this.filterRes, mode: this.filterMode, vol: this.filterVol, on: this.filterMode !== 0, routing: this.filterRouting },
      registers: Array.from(this.registers)
    };
  }
}
