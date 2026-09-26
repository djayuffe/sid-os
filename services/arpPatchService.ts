
// services/arpPatchService.ts

export interface Connection {
    id: string; 
    from: string; 
    to: string; 
    color: string;
}

export interface ArpVcoState {
    freq: number; fine: number; pw: number; 
    // Waveform is a bitmask: 1=Gate, 2=Sync, 4=Ring, 8=Test, 16=Tri, 32=Saw, 64=Pulse, 128=Noise
    wave: number; 
    kbdTrack: number; fmDepth: number; pwmDepth: number;
    enabled: boolean; // Audio Output Enable
    lowFreq?: boolean; // Specific to VCO3
}

export interface ArpVcfState {
    cutoff: number; res: number; fmDepth: number; resDepth: number; mode: number; 
    route1: boolean; route2: boolean; route3: boolean; routeExt: boolean;
}

export interface ArpAdsrState {
    a: number; d: number; s: number; r: number;
}

export interface ArpLfoState {
    speed: number; depth: number; shape: 'sine' | 'square' | 'saw' | 'tri' | 'noise';
}

export interface ArpStep {
    pitch: number;
    gate: boolean;
    accent?: boolean;
    slide?: boolean;
}

export interface ArpeggiatorState {
    mode: 'OFF' | 'UP' | 'DOWN' | 'UPDOWN' | 'RANDOM';
    range: number; // 1, 2, 3 octaves
    speed: number;
    gate: number; // 0.1 to 1.0
}

export interface ModuleState {
    name?: string;
    category?: string;
    vco1: ArpVcoState;
    vco2: ArpVcoState;
    vco3: ArpVcoState;
    vcf: ArpVcfState;
    adsr: ArpAdsrState;
    lfo: ArpLfoState;
    sh: { rate: number; level: number };
    master: { vol: number; reverb: number };
    global: { portamento: number };
    macros: { m1: number; m2: number; m3: number; m4: number };
    sequencer: { steps: ArpStep[], active: boolean, speed: number, arpMode: boolean, gated?: boolean };
    arpeggiator: ArpeggiatorState;
    cables: Connection[];
}

// Default Init State Constant (Internal)
const DEFAULT_STATE: ModuleState = {
    name: "INIT_SAW",
    category: "00_Init",
    vco1: { freq: 0.5, fine: 0.5, pw: 0.5, wave: 0x21, kbdTrack: 1.0, fmDepth: 0.0, pwmDepth: 0.0, enabled: true },
    vco2: { freq: 0.5, fine: 0.51, pw: 0.5, wave: 0x21, kbdTrack: 1.0, fmDepth: 0.0, pwmDepth: 0.0, enabled: true },
    vco3: { freq: 0.25, fine: 0.5, pw: 0.5, wave: 0x40, lowFreq: false, kbdTrack: 1.0, fmDepth: 0.0, pwmDepth: 0.0, enabled: true },
    vcf: { cutoff: 1.0, res: 0.0, fmDepth: 0.0, resDepth: 0.0, mode: 1, route1: true, route2: true, route3: true, routeExt: false },
    adsr: { a: 0.0, d: 0.5, s: 1.0, r: 0.2 },
    lfo: { speed: 0.2, depth: 0.0, shape: 'sine' },
    sh: { rate: 0.5, level: 0 },
    master: { vol: 0.8, reverb: 0.1 },
    global: { portamento: 0.0 },
    macros: { m1: 0, m2: 0, m3: 0, m4: 0 },
    sequencer: { steps: Array(16).fill(0).map(() => ({ pitch: 0.0, gate: false })), active: false, speed: 0.2, arpMode: false, gated: false },
    arpeggiator: { mode: 'OFF', range: 1, speed: 0.15, gate: 0.8 },
    cables: []
};

// Helper to generate a unique cable ID
const cid = () => `c_${Math.random().toString(36).substr(2, 9)}`;

// Deep copy helper to avoid reference pollution
const copyState = (s: ModuleState): ModuleState => JSON.parse(JSON.stringify(s));

export const PRESETS: Record<string, ModuleState> = {
    "INIT": copyState(DEFAULT_STATE),

    // --- 01 BASS ---
    "BASS_FAT_PULSE": {
        ...copyState(DEFAULT_STATE), name: "Fat Pulse Bass", category: "01_Bass",
        vco1: { ...DEFAULT_STATE.vco1, wave: 64, pw: 0.5, pwmDepth: 0.2 },
        vco2: { ...DEFAULT_STATE.vco2, wave: 64, pw: 0.52, fine: 0.505, pwmDepth: 0.2 },
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 0.3, res: 0.2, fmDepth: 0.5 },
        adsr: { a: 0.01, d: 0.3, s: 0.4, r: 0.1 },
        lfo: { ...DEFAULT_STATE.lfo, speed: 0.1, depth: 0.3 },
        cables: [
            { id: cid(), from: 'env_out', to: 'vcf_cut', color: '#22d3ee' },
            { id: cid(), from: 'lfo_tri', to: 'vco1_pwm', color: '#f472b6' },
            { id: cid(), from: 'lfo_tri', to: 'vco2_pwm', color: '#f472b6' }
        ]
    },
    "BASS_SYNC_GRIT": {
        ...copyState(DEFAULT_STATE), name: "Sync Grit Bass", category: "01_Bass",
        vco1: { ...DEFAULT_STATE.vco1, wave: 64, pw: 0.5 }, // Master
        vco2: { ...DEFAULT_STATE.vco2, wave: 66, pw: 0.5, fine: 0.5, fmDepth: 0.4 }, // Slave (Pulse+Sync)
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 1.0, res: 0.0 },
        adsr: { a: 0.01, d: 0.2, s: 0.0, r: 0.1 },
        cables: [
            { id: cid(), from: 'env_out', to: 'vco2_fm', color: '#fbbf24' } // Envelope bending Slave Pitch
        ]
    },
    "BASS_FM_SLAP": {
        ...copyState(DEFAULT_STATE), name: "FM Slap Bass", category: "01_Bass",
        vco1: { ...DEFAULT_STATE.vco1, wave: 33, enabled: true, fmDepth: 0.4 },
        vco2: { ...DEFAULT_STATE.vco2, wave: 17, fine: 0.5, enabled: false }, // Modulator (Tri)
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 0.4, res: 0.3, fmDepth: 0.6 },
        adsr: { a: 0.0, d: 0.3, s: 0.2, r: 0.1 },
        cables: [
            { id: cid(), from: 'vco2_fm', to: 'vco1_fm', color: '#fbbf24' }, // Cross modulation
            { id: cid(), from: 'env_out', to: 'vcf_cut', color: '#22d3ee' }
        ]
    },

    // --- 02 LEADS ---
    "LEAD_HUBBARD": {
        ...copyState(DEFAULT_STATE), name: "Hubbard Ring", category: "02_Lead",
        vco1: { ...DEFAULT_STATE.vco1, wave: 17, enabled: false }, // Tri (Carrier)
        vco2: { ...DEFAULT_STATE.vco2, wave: 21, fine: 0.5, fmDepth: 0.3, enabled: true }, // Tri+Ring (Modulator)
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 1.0, res: 0.0 },
        adsr: { a: 0.02, d: 0.3, s: 0.6, r: 0.2 },
        lfo: { ...DEFAULT_STATE.lfo, speed: 0.3, depth: 0.2 },
        cables: [
            { id: cid(), from: 'lfo_sin', to: 'vco2_fm', color: '#fbbf24' } // LFO modulating Ring Mod freq
        ]
    },
    "LEAD_SID_WIZARD": {
        ...copyState(DEFAULT_STATE), name: "SID Wizard Arp", category: "02_Lead",
        vco1: { ...DEFAULT_STATE.vco1, wave: 64, pw: 0.2 },
        vco2: { ...DEFAULT_STATE.vco2, wave: 64, pw: 0.8, fine: 0.502 },
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 0.5, res: 0.4, fmDepth: 0.3 },
        adsr: { a: 0.0, d: 0.1, s: 0.5, r: 0.1 },
        arpeggiator: { mode: 'UP', range: 2, speed: 0.06, gate: 0.9 }, // Fast hardware arp
        cables: [ { id: cid(), from: 'env_out', to: 'vcf_cut', color: '#22d3ee' } ]
    },

    // --- 07 SHOWCASE ---
    "SID_MAXIMUS": {
        ...copyState(DEFAULT_STATE), name: "SID Maximus", category: "07_Showcase",
        vco1: { ...DEFAULT_STATE.vco1, wave: 65, pw: 0.5, fine: 0.5, fmDepth: 0.1 }, // Pulse + Gate
        vco2: { ...DEFAULT_STATE.vco2, wave: 33, fine: 0.505, fmDepth: 0.05 }, // Saw + Gate
        vco3: { ...DEFAULT_STATE.vco3, wave: 17, fine: 0.495, lowFreq: false }, // Tri + Gate
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 0.4, res: 0.6, mode: 1, fmDepth: 0.5, resDepth: 0.3 },
        adsr: { a: 0.0, d: 0.4, s: 0.6, r: 0.3 },
        lfo: { speed: 0.15, depth: 0.4, shape: 'sine' },
        cables: [
            { id: cid(), from: 'env_out', to: 'vcf_cut', color: '#22d3ee' },
            { id: cid(), from: 'lfo_sin', to: 'vco1_pwm', color: '#f472b6' },
            { id: cid(), from: 'lfo_tri', to: 'vcf_res', color: '#fbbf24' }
        ]
    },
    "GALACTIC_RING": {
        ...copyState(DEFAULT_STATE), name: "Galactic Ring", category: "07_Showcase",
        vco1: { ...DEFAULT_STATE.vco1, wave: 17, enabled: false }, // Tri (Carrier)
        vco2: { ...DEFAULT_STATE.vco2, wave: 23, fine: 0.5, fmDepth: 0.8, enabled: true }, // Tri+Ring+Sync
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 1.0, res: 0.0 },
        adsr: { a: 0.1, d: 0.8, s: 0.5, r: 0.5 },
        lfo: { speed: 0.08, depth: 0.5, shape: 'tri' },
        cables: [
            { id: cid(), from: 'env_out', to: 'vco2_fm', color: '#ef4444' }, // Env Sync Sweep
            { id: cid(), from: 'lfo_tri', to: 'vco1_fm', color: '#22d3ee' }  // Modulate Carrier
        ]
    },
    "LOGIC_STORM": {
        ...copyState(DEFAULT_STATE), name: "Logic Storm (S&H)", category: "07_Showcase",
        vco1: { ...DEFAULT_STATE.vco1, wave: 64, pw: 0.5, fmDepth: 0.5 },
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 0.5, res: 0.8, fmDepth: 0.7, mode: 2 }, // Bandpass
        sh: { rate: 0.15, level: 1.0 }, // Fast Sample & Hold
        adsr: { a: 0.0, d: 0.2, s: 1.0, r: 0.2 },
        cables: [
            { id: cid(), from: 'sh_out', to: 'vcf_cut', color: '#fbbf24' },
            { id: cid(), from: 'sh_out', to: 'vco1_fm', color: '#f472b6' },
            { id: cid(), from: 'lfo_sin', to: 'vco1_pwm', color: '#22d3ee' }
        ]
    },
    "WAVETABLE_SEQ": {
        ...copyState(DEFAULT_STATE), name: "Wavetable Seq", category: "07_Showcase",
        vco1: { ...DEFAULT_STATE.vco1, wave: 32, pw: 0.5, fmDepth: 0.0 }, // Base Saw
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 0.4, res: 0.5, fmDepth: 0.6 },
        adsr: { a: 0.0, d: 0.2, s: 0.4, r: 0.1 },
        sequencer: {
            active: true, speed: 0.14, arpMode: false, gated: true,
            steps: [
                { pitch: 0.1, gate: true }, { pitch: 0.5, gate: true }, { pitch: 0.2, gate: true }, { pitch: 0.8, gate: true },
                { pitch: 0.3, gate: true }, { pitch: 0.6, gate: true }, { pitch: 0.4, gate: true }, { pitch: 0.9, gate: true },
                { pitch: 0.2, gate: true }, { pitch: 0.7, gate: true }, { pitch: 0.5, gate: true }, { pitch: 0.1, gate: true },
                { pitch: 0.8, gate: true }, { pitch: 0.3, gate: true }, { pitch: 0.6, gate: true }, { pitch: 0.4, gate: true }
            ]
        },
        cables: [
            { id: cid(), from: 'seq_pitch', to: 'vco1_pwm', color: '#ef4444' }, // Seq controls Pulse Width (Timbre)
            { id: cid(), from: 'seq_pitch', to: 'vcf_cut', color: '#22d3ee' },  // Seq controls Filter
            { id: cid(), from: 'seq_gate', to: 'env_gate', color: '#fbbf24' }
        ]
    },

    // --- 05 SEQUENCES (UPDATED: active=true, gated=true) ---
    "SEQ_ACID_303": {
        ...copyState(DEFAULT_STATE), name: "Acid 303 (Seq)", category: "05_Sequence",
        vco1: { ...DEFAULT_STATE.vco1, wave: 32, pw: 0.5 }, // Saw
        vco2: { ...DEFAULT_STATE.vco2, enabled: false },
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 0.15, res: 0.85, fmDepth: 0.8, mode: 1 }, // High Res LP
        adsr: { a: 0, d: 0.2, s: 0, r: 0.1 },
        sequencer: { 
            active: true, speed: 0.13, arpMode: false, gated: true,
            steps: [
                { pitch: 0.25, gate: true }, { pitch: 0.25, gate: true }, { pitch: 0.375, gate: true }, { pitch: 0.25, gate: false },
                { pitch: 0.5, gate: true }, { pitch: 0.25, gate: true }, { pitch: 0.375, gate: true }, { pitch: 0.125, gate: true },
                { pitch: 0.25, gate: true }, { pitch: 0.25, gate: true }, { pitch: 0.375, gate: true }, { pitch: 0.25, gate: false },
                { pitch: 0.625, gate: true }, { pitch: 0.25, gate: true }, { pitch: 0.375, gate: true }, { pitch: 0.5, gate: true }
            ]
        },
        cables: [
            { id: cid(), from: 'seq_pitch', to: 'vco1_fm', color: '#fbbf24' },
            { id: cid(), from: 'seq_gate', to: 'env_gate', color: '#ef4444' },
            { id: cid(), from: 'env_out', to: 'vcf_cut', color: '#22d3ee' }
        ]
    },
    "SEQ_STRANGER": {
        ...copyState(DEFAULT_STATE), name: "Stranger Arps (Seq)", category: "05_Sequence",
        vco1: { ...DEFAULT_STATE.vco1, wave: 64, pw: 0.5 },
        vco2: { ...DEFAULT_STATE.vco2, wave: 64, pw: 0.51, fine: 0.505 },
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 0.25, res: 0.3, fmDepth: 0.5 },
        adsr: { a: 0.05, d: 0.4, s: 0.2, r: 0.3 },
        sequencer: {
            active: true, speed: 0.18, arpMode: true, gated: true,
            steps: [
                { pitch: 0.0, gate: true }, { pitch: 0.0, gate: false }, { pitch: 0.0, gate: true }, { pitch: 0.0, gate: false },
                { pitch: 0.166, gate: true }, { pitch: 0.0, gate: false }, { pitch: 0.25, gate: true }, { pitch: 0.0, gate: false },
                { pitch: 0.33, gate: true }, { pitch: 0.0, gate: false }, { pitch: 0.25, gate: true }, { pitch: 0.0, gate: false },
                { pitch: 0.166, gate: true }, { pitch: 0.0, gate: false }, { pitch: 0.0, gate: true }, { pitch: 0.0, gate: false }
            ]
        },
        cables: [
            { id: cid(), from: 'seq_pitch', to: 'vco1_fm', color: '#fbbf24' },
            { id: cid(), from: 'seq_pitch', to: 'vco2_fm', color: '#fbbf24' },
            { id: cid(), from: 'seq_gate', to: 'env_gate', color: '#ef4444' },
            { id: cid(), from: 'env_out', to: 'vcf_cut', color: '#22d3ee' }
        ]
    },

    // --- CONTROLLER ---
    "PADDLE_MORPH": {
        ...copyState(DEFAULT_STATE), name: "Paddle Morph", category: "06_Control",
        vco1: { ...DEFAULT_STATE.vco1, wave: 64, pw: 0.5 },
        vcf: { ...DEFAULT_STATE.vcf, cutoff: 0.2, res: 0.8, mode: 1 },
        cables: [
            { id: cid(), from: 'pot_x', to: 'vcf_cut', color: '#fbbf24' }, // X controls Cutoff
            { id: cid(), from: 'pot_y', to: 'vco1_pwm', color: '#22d3ee' }  // Y controls PWM
        ]
    }
};

export const CC_MAP: Record<number, { section: keyof ModuleState, key: string, min: number, max: number, stepped?: boolean }> = {
    74: { section: 'vcf', key: 'cutoff', min: 0, max: 1 },
    71: { section: 'vcf', key: 'res', min: 0, max: 1 },
    80: { section: 'vcf', key: 'mode', min: 0, max: 7, stepped: true }, 
    73: { section: 'adsr', key: 'a', min: 0, max: 1 },
    75: { section: 'adsr', key: 'd', min: 0, max: 1 },
    79: { section: 'adsr', key: 's', min: 0, max: 1 },
    72: { section: 'adsr', key: 'r', min: 0, max: 1 },
    14: { section: 'vco1', key: 'freq', min: 0, max: 1 },
    15: { section: 'vco1', key: 'pw', min: 0, max: 1 },
    70: { section: 'vco1', key: 'pw', min: 0, max: 1 },
    76: { section: 'lfo', key: 'speed', min: 0, max: 1 },
    77: { section: 'lfo', key: 'depth', min: 0, max: 1 },
    1: { section: 'lfo', key: 'depth', min: 0, max: 1 },
    16: { section: 'macros', key: 'm1', min: 0, max: 1 },
    17: { section: 'macros', key: 'm2', min: 0, max: 1 },
    18: { section: 'macros', key: 'm3', min: 0, max: 1 },
    19: { section: 'macros', key: 'm4', min: 0, max: 1 },
    7: { section: 'master', key: 'vol', min: 0, max: 1 },
};

export const ArpPatchService = {
    getInitialState: (): ModuleState => copyState(DEFAULT_STATE),
    
    validateAndMigrate: (input: any): ModuleState => {
        if (!input || typeof input !== 'object') return ArpPatchService.getInitialState();
        const base = ArpPatchService.getInitialState();
        const data = { ...input };
        
        ['vco1','vco2','vco3','vcf','adsr','lfo','sh','master','global','macros', 'sequencer', 'arpeggiator'].forEach(key => {
            if (data[key]) (base as any)[key] = { ...(base as any)[key], ...data[key] };
        });
        
        if (data.name) base.name = data.name;
        if (data.category) base.category = data.category;
        
        if (base.sequencer && base.sequencer.steps.length < 16) {
            const oldSteps = base.sequencer.steps;
            base.sequencer.steps = Array(16).fill(0).map((_, i) => oldSteps[i] || { pitch: 0.0, gate: false });
        }
        if (base.sequencer && typeof base.sequencer.arpMode === 'undefined') {
            base.sequencer.arpMode = false;
        }
        if (base.sequencer && typeof base.sequencer.gated === 'undefined') {
            base.sequencer.gated = false;
        }
        if (Array.isArray(data.cables)) {
            base.cables = data.cables;
        }
        return base;
    },

    exportPatch: (state: ModuleState): Blob => {
        const json = JSON.stringify(state, null, 2);
        return new Blob([json], { type: 'application/json' });
    },

    exportBank: (presets: Record<string, ModuleState>): Blob => {
        const json = JSON.stringify(presets, null, 2);
        return new Blob([json], { type: 'application/json' });
    },

    getGroupedPresets: (presets: Record<string, ModuleState>) => {
        return Object.entries(presets).reduce((acc, [key, val]) => {
            const cat = val.category || 'Other';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push({ key, val });
            return acc;
        }, {} as Record<string, {key: string, val: ModuleState}[]>);
    }
};
