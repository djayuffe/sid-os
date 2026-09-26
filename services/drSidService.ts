
export type DrSidDrumType = 'KICK' | 'SNARE' | 'HAT' | 'CLAP' | 'NOISE_HIT' | 'TOM' | 'HAT_OPEN';

export interface DrumPatch {
    type: DrSidDrumType;
    fStart: number;
    fEnd: number;
    sweep: number;
    wave: number;     
    dur: number;
    ad: number;
    sr: number;
    pw?: number;
    pwSweep?: number;
    ring?: boolean;
    sync?: boolean;
    hardReset?: boolean;
    filter?: {
        enabled: boolean;
        cutStart: number;
        res: number;
        sweep: number;
        mode: number;
    };
    chokeGroup?: number;
}

export interface DrumModifiers {
    tune: number;
    decay: number;
    tone: number;
}

interface DrVoiceState {
    active: boolean;
    type: DrSidDrumType;
    frame: number;
    patch: DrumPatch | null;
    freq: number;
    pw: number;
    ctrl: number;
    ad: number;
    sr: number;
    retrigger: boolean;
}

// Factory Bank Data
export const FACTORY_BANKS = [
    {
        name: 'DUBSTEP_PRO',
        patches: [
            { type: 'KICK', fStart: 300, fEnd: 50, sweep: 40, wave: 0x10, dur: 0.4, ad: 0x09, sr: 0x00, pw: 2048 },
            { type: 'SNARE', fStart: 1200, fEnd: 600, sweep: 20, wave: 0x80, dur: 0.25, ad: 0x05, sr: 0x00, pw: 2048 },
            { type: 'HAT', fStart: 4000, fEnd: 4000, sweep: 0, wave: 0x81, dur: 0.08, ad: 0x00, sr: 0xF5, pw: 2048 },
            { type: 'TOM', fStart: 600, fEnd: 150, sweep: 30, wave: 0x10, dur: 0.3, ad: 0x08, sr: 0x00, pw: 2048 }
        ]
    },
    {
        name: 'CHIPTUNE_V1',
        patches: [
            { type: 'KICK', fStart: 400, fEnd: 100, sweep: 50, wave: 0x40, dur: 0.2, ad: 0x05, sr: 0x00, pw: 2048 },
            { type: 'SNARE', fStart: 2000, fEnd: 800, sweep: 40, wave: 0x80, dur: 0.15, ad: 0x04, sr: 0x00, pw: 2048 },
            { type: 'HAT', fStart: 6000, fEnd: 6000, sweep: 0, wave: 0x81, dur: 0.05, ad: 0x00, sr: 0xF3, pw: 1024 },
            { type: 'CLAP', fStart: 1800, fEnd: 1800, sweep: 0, wave: 0x80, dur: 0.2, ad: 0x0A, sr: 0x50, pw: 2048 }
        ]
    },
    {
        name: 'TECHNO_RUMBLE',
        patches: [
            { type: 'KICK', fStart: 150, fEnd: 40, sweep: 30, wave: 0x10, dur: 0.6, ad: 0x0A, sr: 0x55, pw: 2048, filter: { enabled: true, cutStart: 0.3, res: 8, sweep: 0, mode: 1 } },
            { type: 'SNARE', fStart: 2500, fEnd: 1000, sweep: 20, wave: 0x80, dur: 0.2, ad: 0x05, sr: 0x05, pw: 2048 },
            { type: 'HAT', fStart: 8000, fEnd: 8000, sweep: 0, wave: 0x80, dur: 0.05, ad: 0x00, sr: 0xF4, pw: 2048 },
            { type: 'HAT_OPEN', fStart: 7000, fEnd: 7000, sweep: 0, wave: 0x80, dur: 0.3, ad: 0x01, sr: 0xF7, pw: 2048 }
        ]
    },
    {
        name: 'RETRO_POP',
        patches: [
            { type: 'KICK', fStart: 200, fEnd: 50, sweep: 35, wave: 0x10, dur: 0.3, ad: 0x09, sr: 0x04, pw: 2048 },
            { type: 'SNARE', fStart: 1500, fEnd: 800, sweep: 20, wave: 0x80, dur: 0.25, ad: 0x07, sr: 0x04, pw: 2048 },
            { type: 'HAT', fStart: 6000, fEnd: 6000, sweep: 0, wave: 0x80, dur: 0.06, ad: 0x00, sr: 0xF3, pw: 2048 },
            { type: 'PERC', fStart: 1200, fEnd: 400, sweep: 40, wave: 0x10, dur: 0.15, ad: 0x05, sr: 0x00, pw: 2048 }
        ]
    }
];

export const DEMO_PATTERNS = [
    [
        [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
        [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
        [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false]
    ],
    [
        [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false],
        [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, true],
        [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
        [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true]
    ],
    [
        [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
        [false, false, false, false, true, false, false, true, false, false, false, false, true, false, true, false],
        [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]
    ],
    [
        [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
        [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
        [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true],
        [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false]
    ]
];

export class DrSidService {
    static validateBank(bank: any) {
        // Ensure bank has a name and valid patches
        return {
            name: bank.name || 'USER_BANK',
            patches: (bank.patches || []).map((p: any) => ({
                type: p.type || 'KICK',
                fStart: p.fStart || 200,
                fEnd: p.fEnd || 50,
                sweep: p.sweep || 20,
                wave: p.wave || 0x10,
                dur: p.dur || 0.2,
                ad: p.ad || 0x09,
                sr: p.sr || 0x00,
                pw: p.pw || 2048,
                pwSweep: p.pwSweep || 0,
                ring: !!p.ring,
                sync: !!p.sync,
                hardReset: !!p.hardReset,
                filter: p.filter ? { ...p.filter } : undefined,
                chokeGroup: p.chokeGroup
            }))
        };
    }
}

export class DrSid {
    voices: DrVoiceState[] = [
        { active: false, type: 'KICK', frame: 0, patch: null, freq:0, pw:0, ctrl:0, ad:0, sr:0, retrigger: false },
        { active: false, type: 'SNARE', frame: 0, patch: null, freq:0, pw:0, ctrl:0, ad:0, sr:0, retrigger: false },
        { active: false, type: 'HAT', frame: 0, patch: null, freq:0, pw:0, ctrl:0, ad:0, sr:0, retrigger: false }
    ];
    
    banks: any[] = [];
    activeBankIdx = 0;
    currentKit: Record<string, DrumPatch> = {};
    modifiers: DrumModifiers = { tune: 1.0, decay: 1.0, tone: 1.0 };
    filterState = { cut: 0, res: 0, mode: 0, route: 0 };

    constructor() {
        this.loadUserBanks(JSON.parse(JSON.stringify(FACTORY_BANKS)));
        this.setBank(0);
    }

    loadUserBanks(banks: any[]) {
        this.banks = banks;
        this.setBank(this.activeBankIdx);
    }

    setBank(idx: number) {
        if (idx < 0 || idx >= this.banks.length) idx = 0;
        this.activeBankIdx = idx;
        const bank = this.banks[idx];
        this.currentKit = {};
        bank.patches.forEach((p: DrumPatch) => {
            this.currentKit[p.type] = p;
        });
    }
    
    replaceActiveBank(bank: any) {
        this.banks[this.activeBankIdx] = bank;
        this.setBank(this.activeBankIdx);
    }

    getBankName() {
        return this.banks[this.activeBankIdx]?.name || "INIT_BANK";
    }

    getCurrentPatch(type: string): DrumPatch | null {
        return this.currentKit[type] || null;
    }
    
    updatePatch(type: string, changes: Partial<DrumPatch>) {
        if (this.currentKit[type]) {
            this.currentKit[type] = { ...this.currentKit[type], ...changes };
            // Update in banks array too
            const bank = this.banks[this.activeBankIdx];
            const pIdx = bank.patches.findIndex((p:any) => p.type === type);
            if (pIdx !== -1) {
                bank.patches[pIdx] = this.currentKit[type];
            }
        }
    }

    setModifiers(mods: DrumModifiers) {
        this.modifiers = mods;
    }

    trigger(voiceIdx: number, type: DrSidDrumType) {
        if (this.voices[voiceIdx]) {
            // Find patch in current kit, fallback to first in list if type not found (simplified)
            let patch = this.currentKit[type];
            if (!patch) {
                // Heuristic fallback
                if (type === 'HAT_OPEN') patch = this.currentKit['HAT'];
                else if (type === 'CLAP') patch = this.currentKit['SNARE'];
                else patch = this.currentKit['KICK']; // Default
            }

            if (patch) {
                this.voices[voiceIdx] = { 
                    active: true, 
                    type, 
                    frame: 0, 
                    patch: patch,
                    freq: patch.fStart,
                    pw: patch.pw || 2048,
                    ctrl: patch.wave,
                    ad: patch.ad,
                    sr: patch.sr,
                    retrigger: true
                };
            }
        }
    }

    process(voiceIdx: number): DrVoiceState | null {
        const v = this.voices[voiceIdx];
        if (!v.active || !v.patch) return null;

        const p = v.patch;
        
        // --- Synthesis Logic ---
        v.frame++;
        const t = v.frame / 60.0; // Time in seconds approx
        
        // Pitch Sweep
        const sweepSpd = (p.sweep * 0.5) * this.modifiers.tone;
        const freqRatio = Math.max(0, 1.0 - (t * sweepSpd));
        // Exponential-ish curve
        let curFreq = p.fEnd + (p.fStart - p.fEnd) * (freqRatio * freqRatio);
        curFreq *= this.modifiers.tune;
        
        // Pulse Width LFO
        let pw = p.pw || 2048;
        if (p.pwSweep) {
            pw += Math.sin(t * 10) * (p.pwSweep * 20);
        }
        
        // Gate Logic (Duration)
        const dur = p.dur * this.modifiers.decay;
        let ctrl = p.wave;
        
        if (t < dur) {
            ctrl |= 0x01; // Gate On
        } else {
            ctrl &= 0xFE; // Gate Off
        }
        
        // Ring/Sync
        if (p.ring) ctrl |= 0x04;
        if (p.sync) ctrl |= 0x02;
        if (p.hardReset && v.frame === 1) ctrl |= 0x08; // Test bit on frame 1

        v.freq = curFreq;
        v.pw = pw;
        v.ctrl = ctrl;
        v.ad = p.ad;
        v.sr = p.sr;
        
        // Update Filter State if this voice uses filter
        // Note: SID filter is global. DrSid acts as if the last triggered filtered voice controls the filter.
        if (p.filter && p.filter.enabled) {
            this.filterState.cut = Math.floor(p.filter.cutStart * 2047); // Static cut for now
            if (p.filter.sweep > 0) {
                 const fEnv = Math.max(0, 1.0 - (t * p.filter.sweep * 0.1));
                 this.filterState.cut = Math.floor(p.filter.cutStart * 2047 * fEnv);
            }
            this.filterState.res = p.filter.res;
            this.filterState.mode = p.filter.mode;
            this.filterState.route = (this.filterState.route | (1 << voiceIdx));
        } else {
            // Remove from routing if filter disabled for this voice
             this.filterState.route = (this.filterState.route & ~(1 << voiceIdx));
        }

        const ret = { ...v, retrigger: v.frame === 1 };
        if (t > dur + 0.5) v.active = false; // Auto-kill after release tail

        return ret;
    }
    
    getFilterState() {
        return this.filterState;
    }
}
