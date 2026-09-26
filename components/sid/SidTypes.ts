
import { InstrumentAnalysis } from '../analysis';

export interface CpuTraceEntry {
  cycles: number;
  pc: number;
  a: number;
  x: number;
  y: number;
  sp: number;
  flags: number;
  instruction: string;
}

export interface C64Config {
  enableHle: boolean;
  roms: {
    kernal?: Uint8Array;
    basic?: Uint8Array;
    chargen?: Uint8Array;
  };
  forceStandard?: 'AUTO' | 'PAL' | 'NTSC';
  sidModelOverride?: 'AUTO' | '6581' | '8580';
  busPersistenceCycles: number; 
  enableAdsrPipeline: boolean;
  noiseSeed: number;
  exportDepth: 'COMPACT' | 'FULL'; 
}

export interface SidHeader {
  magic: string;
  version: number;
  dataOffset: number;
  loadAddress: number;
  initAddress: number;
  playAddress: number;
  songs: number;
  startSong: number;
  speed: number;
  title: string;
  author: string;
  released: string;
  flags: number;
  isNtsc: boolean;
  clockFreq: number;
  model: '6581' | '8580' | 'unknown';
  sidCount: number;
  sidModels: ('6581' | '8580' | 'unknown')[];
  sidAddresses: number[];
  c64BasicFlag: boolean;
}

export interface SidInternalOscillatorState {
  accumulator: number; // 24-bit phase
  shiftRegister: number; // 23-bit noise LFSR
  pulseOutput: number; 
  waveOutput: number; 
  prevAccBit19: boolean;
}

export interface SidInternalEnvelopeState {
  rateCounter: number; 
  rateCounterPeriod: number; 
  exponentialCounter: number; 
  envelopeCounter: number; 
  state: 'attack' | 'decay' | 'sustain' | 'release';
  holdZero: boolean; 
}

export interface SidVoiceStatus {
  freqReg: number;
  freqHz: number;
  midiNote: number; 
  pitchBend: number; 
  envelope: number; 
  gate: boolean;
  waveform: number; 
  rawWaveform: number; 
  pulse: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  sync: boolean;
  ringMod: boolean;
  test: boolean;
  state: 'attack' | 'decay' | 'sustain' | 'release';
  noiseType?: 'low' | 'mid' | 'high' | 'none'; 
  triggered: boolean;
  oscillator: SidInternalOscillatorState;
  envelopeGen: SidInternalEnvelopeState;
}

export interface SidFilterStatus {
  cutoff: number;
  resonance: number;
  mode: number; 
  vol: number;
  on: boolean; 
  routing: number; 
}

export interface SidChipState {
    voices: [SidVoiceStatus, SidVoiceStatus, SidVoiceStatus];
    filter: SidFilterStatus;
    registers: number[];
}

export interface SidDumpFrame {
  frame: number;
  time: number; 
  cycles: number; 
  chips: SidChipState[];
}

export interface SidRegisterWrite {
    cycles: number; 
    chipIdx: number;
    reg: number; 
    val: number;
}

export interface SidDump {
  metadata: SidHeader;
  originalSource: string;
  frames: SidDumpFrame[];
  writeLog: SidRegisterWrite[]; 
  totalDuration: number;
  frameCount: number;
  detectedRefreshRate: number; 
  analysis?: InstrumentAnalysis;
  cpuTrace?: CpuTraceEntry[];
  config: C64Config;
}
