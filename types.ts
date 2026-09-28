
export interface SidHeader {
  clock?: number;
  song?: string;
  author?: string;
  copyright?: string;
  fps?: number;
  originalFilename?: string;
}

export interface VoiceParams {
    volume: number; // 0.0 to 1.0
    pan: number;    // -1.0 to 1.0
    muted: boolean;
    solo: boolean;
}

export interface MixerParams {
    voices: [VoiceParams, VoiceParams, VoiceParams];
    masterVolume: number;
    extVolume?: number; // Pin 26 analog input
}

export interface SidProChip {
  registers: number[];
  voiceStates: { level: number; state: number; phase: number }[];
  pla: { loram: boolean; hiram: boolean; charen: boolean; io: boolean; };
}

export interface SidEvent {
  cycles: number;
  reg: number;
  val: number;
}

export interface ParsedTrace {
  header: SidHeader;
  frames: (Uint8Array | number[])[];
  events: SidEvent[];
}

export type LfoWaveform = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type LfoTarget = 'none' | 'pitch' | 'pitch1' | 'pitch2' | 'pitch3' | 'cutoff' | 'resonance' | 'pulse' | 'pulse1' | 'pulse2' | 'pulse3' | 'volume';

export interface LfoConfig {
  enabled: boolean;
  sync: boolean;   
  rate: number;     
  depth: number;    
  waveform: LfoWaveform;
  target: LfoTarget;
}

export interface MasteringParams {
    eq: { lowGain: number; highGain: number; enabled: boolean; tilt?: number; };
    tape: { drive: number; bias: number; enabled: boolean; };
    comp: { threshold: number; ratio: number; release: number; enabled: boolean; };
    exciter: { amount: number; freq: number; enabled: boolean; };
    reverb: { mix: number; time: number; feedback: number; active: boolean; };
    imager: { width: number; enabled: boolean; };
    limiter: { ceiling: number; enabled: boolean; };
    output: { gain: number; enabled: boolean; };
    final: { dcBlock: true, dcPole: 0.995, multiband: false, multibandMix: 0 };
    chorus: { enabled: false, depth: 0.3, rate: 0.5, mix: 0.3 };
}

export interface TrackerInstrument {
  id: number;
  name: string;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  waveform: number; 
  pulseWidth: number; 
  hardRestart: boolean; 
  flags?: number;
  hrAd?: number;
  hrSr?: number;
  gatTimer?: number;
  vibratoType?: number;
  vibParam?: number;
  vibDelay?: number;
  arpSpeed?: number;
}

export interface TrackerRow {
  note: string; 
  inst: number; 
  vol: string; 
  cmd: string; 
  val: string; 
}

export interface TrackerPattern {
  id: number;
  rows: TrackerRow[][]; 
}

export interface TrackerSubtune {
  id: number;
  tempo: number;
  orderList: number[]; 
  loopPosition?: number; 
  funkTempo?: number;
}

export interface SwmChord {
  id: number;
  steps: number[];
}

export interface SwmTempo {
  id: number;
  values: number[];
}

export interface TrackerProject {
  instruments: TrackerInstrument[];
  patterns: TrackerPattern[];
  subtunes: TrackerSubtune[];
  meta: { title: string; author: string; released: string; }
  frameSpeed?: number;
  /** Register update rate in Hz; independent of the SID oscillator clock. */
  frameRate?: number;
  chordTable?: SwmChord[];
  tempoTable?: SwmTempo[];
}

export interface EditorCursor {
  patternIdx: number;
  row: number;
  channel: number;
  column: number; 
}

export interface VWindow {
    id: string;
    title: string;
    icon: string;
    x: number;
    y: number;
    w: number;
    h: number;
    isOpen: boolean;
    isMinimized: boolean;
    isMaximized: boolean;
    zIndex: number;
}

export interface VirtualFile {
    id: string;
    name: string;
    size: number;
    type: 'SID' | 'PRG' | 'SWM' | 'D64';
    data: string | ArrayBuffer;
    timestamp: number;
}
