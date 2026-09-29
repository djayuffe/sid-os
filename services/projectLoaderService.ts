
import { TrackerProject, ParsedTrace, SidEvent } from '../types';
import { midiNoteToFreq } from './sidService';

export const validateProject = (json: any): TrackerProject => {
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error("Invalid JSON");
    if (json.frameRate !== undefined && (!Number.isFinite(json.frameRate) || json.frameRate <= 0)) {
        throw new Error('Project frame rate must be a positive number');
    }
    
    for (const key of ['instruments', 'patterns', 'subtunes', 'chordTable', 'tempoTable']) {
        if (json[key] !== undefined && !Array.isArray(json[key])) throw new Error(`Project ${key} must be an array`);
    }
    const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER) =>
        Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
    const uniqueIds = (items: any[], name: string) => {
        const ids = new Set<number>();
        for (const item of items) {
            if (!item || !integer(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate ${name} ID`);
            ids.add(item.id);
        }
    };
    uniqueIds(json.instruments ?? [], 'instrument');
    uniqueIds(json.patterns ?? [], 'pattern');
    uniqueIds(json.subtunes ?? [], 'subtune');
    if (Array.isArray(json.instruments)) {
        json.instruments.forEach((inst: any, idx: number) => {
            if (![inst.attack, inst.decay, inst.sustain, inst.release].every(v => integer(v, 15))) {
                throw new Error(`Instrument ${idx}: ADSR values must be 0-15`);
            }
            if (!integer(inst.waveform, 255) || !integer(inst.pulseWidth, 4095) || typeof inst.name !== 'string') {
                throw new Error(`Instrument ${idx}: invalid waveform, pulse width or name`);
            }
        });
    }
    for (const pattern of json.patterns ?? []) {
        if (!Array.isArray(pattern.rows) || pattern.rows.length > 64) throw new Error('Pattern must contain at most 64 rows');
        for (const row of pattern.rows) {
            if (!Array.isArray(row) || row.length > 3) throw new Error('Pattern row must contain at most three voices');
            for (const cell of row) {
                if (!cell || typeof cell.note !== 'string' ||
                    !/^(---|===|(?:C-|C#|D-|D#|E-|F-|F#|G-|G#|A-|A#|B-)(?:[0-9]|10))$/.test(cell.note) ||
                    !integer(cell.inst) || typeof cell.cmd !== 'string' || !/^(\.{1,3}|[0-9A-Z])$/.test(cell.cmd) ||
                    typeof cell.val !== 'string' || !/^(\.\.|[0-9A-Fa-f]{2})$/.test(cell.val) ||
                    typeof cell.vol !== 'string' || !/^(\.\.|[0-7][0-9A-Fa-f])$/.test(cell.vol)) {
                    throw new Error('Invalid tracker cell');
                }
            }
        }
    }
    for (const subtune of json.subtunes ?? []) {
        if (!Array.isArray(subtune.orderList) || !subtune.orderList.every(id => integer(id))) throw new Error('Invalid order list');
        if (subtune.loopPosition !== undefined && (!integer(subtune.loopPosition) || subtune.loopPosition >= subtune.orderList.length)) {
            throw new Error('Invalid sequence loop position');
        }
    }
    for (const field of ['title', 'author', 'released']) {
        if (json.meta?.[field] !== undefined && typeof json.meta[field] !== 'string') throw new Error(`Invalid project ${field}`);
    }

    const project: TrackerProject = {
        meta: {
            title: json.meta?.title || "Untitled",
            author: json.meta?.author || "Unknown",
            released: json.meta?.released || ""
        },
        instruments: (json.instruments ?? []).map(inst => ({ ...inst })),
        patterns: (json.patterns ?? []).map(pattern => ({ ...pattern, rows: Array.from({ length: 64 }, (_, r) =>
            Array.from({ length: 3 }, (_, c) => ({ ...(pattern.rows[r]?.[c] ?? { note: '---', inst: 0, vol: '..', cmd: '...', val: '..' }) }))) })),
        subtunes: (json.subtunes ?? []).map(subtune => ({ ...subtune, orderList: [...subtune.orderList] })),
        chordTable: Array.isArray(json.chordTable) ? json.chordTable : [],
        tempoTable: Array.isArray(json.tempoTable) ? json.tempoTable : [],
        frameRate: json.frameRate ?? 50,
        frameSpeed: typeof json.frameSpeed === 'number' && Number.isFinite(json.frameSpeed)
            ? Math.max(1, Math.min(31, Math.round(json.frameSpeed)))
            : 6
    };
    if (project.instruments.length === 0) {
        project.instruments.push({
            id: 1, name: "DEFAULT", attack: 0, decay: 0, sustain: 15, release: 0,
            waveform: 0x10, pulseWidth: 2048, hardRestart: false
        });
    }
    if (project.subtunes.length === 0) {
        project.subtunes.push({ id: 0, tempo: 6, orderList: [0] });
    }
    return project;
};

export const renderProjectToTrace = (project: TrackerProject, clock: number): ParsedTrace => {
    const fps = project.frameRate ?? 50;
    if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(clock) || clock <= 0) {
        throw new Error('Project rendering requires a positive frame rate and SID clock');
    }
    project = validateProject(project);
    const frames: Uint8Array[] = [];
    const events: SidEvent[] = [];
    // Frame speed is an integer row length. Clamp here as well as during JSON
    // validation because callers can construct TrackerProject objects directly.
    const rawSpeed = project.frameSpeed;
    const speed = Number.isFinite(rawSpeed)
        ? Math.max(1, Math.min(31, Math.round(rawSpeed as number)))
        : 6;
    const subtune = project.subtunes[0];
    const frameCount = subtune.orderList.length * 64 * speed;
    if (frameCount > 100_000 || clock / fps < 1 || !Number.isSafeInteger(Math.floor(frameCount * clock / fps))) {
        throw new Error('Project exceeds rendering limits (100,000 frames, at least one SID cycle per frame)');
    }
    
    // Channels state
    const channels = [0, 1, 2].map(() => ({
        activeInstId: 0, 
        note: -1, 
        baseMidi: 0, 
        freq: 0, 
        targetFreq: 0, 
        glideSpeed: 0, 
        slide: 0,
        gate: false, 
        trigger: false, // Triggers Hard Restart sequence
        pw: 0, 
        waveformOverride: -1, 
        arpeggioX: 0, 
        arpeggioY: 0
    }));

    let cutoff = 0, resonance = 0, filterMode = 0, volume = 15, filterRoute = 0; 

    const pushFrame = (frameInRow: number, globalCycle: number) => {
        const regs = new Array(25).fill(0);
        const gateOns: SidEvent[] = [];
        
        const triggeredChannels = new Set<number>();
        channels.forEach((ch, i) => {
            const off = i * 7;
            const inst = project.instruments.find(ins => ins.id === ch.activeInstId);
            
            // Portamento Logic
            ch.freq = Math.max(0, Math.min(65535, ch.freq + ch.slide));
            if (ch.glideSpeed > 0) {
                if (Math.abs(ch.freq - ch.targetFreq) > ch.glideSpeed) {
                    if (ch.freq < ch.targetFreq) ch.freq += ch.glideSpeed;
                    else ch.freq -= ch.glideSpeed;
                } else {
                    ch.freq = ch.targetFreq;
                }
            }

            // Arpeggio / Frequency Calculation
            let effectiveFreq = ch.freq;
            if ((ch.arpeggioX || ch.arpeggioY)) {
                let note = ch.baseMidi;
                if (frameInRow > 0) {
                    const step = frameInRow % 3;
                    if (step === 1 && ch.arpeggioX) note += ch.arpeggioX;
                    else if (step === 2 && ch.arpeggioY) note += ch.arpeggioY;
                }
                effectiveFreq = midiNoteToFreq(note, clock);
            }

            // Clamp Frequency to 16-bit to prevent wrapping aliasing
            effectiveFreq = Math.max(0, Math.min(65535, Math.round(effectiveFreq)));

            // Register Calculation
            if (inst) {
                regs[off + 5] = (inst.attack << 4) | inst.decay;
                regs[off + 6] = (inst.sustain << 4) | inst.release;
                regs[off + 2] = ch.pw & 0xFF;
                regs[off + 3] = (ch.pw >> 8) & 0x0F;
                
                let wf = ch.waveformOverride !== -1 ? ch.waveformOverride : inst.waveform;
                
                // Retrigger within this frame; this is not a cycle-exact SID hard restart.
                if (ch.trigger) {
                    triggeredChannels.add(i);
                    // Configure frequency/ADSR between the gate edges.
                    events.push({ cycles: globalCycle, reg: off + 4, val: wf & 0xFE });
                    
                    const gateDelay = Math.min(45, Math.max(0, Math.floor(clock / fps) - 1));
                    gateOns.push({ cycles: globalCycle + gateDelay, reg: off + 4, val: wf | 0x01 });
                    
                    // 3. For the visual frame dump, show the final state (ON)
                    regs[off + 4] = wf | 0x01;
                    
                    ch.trigger = false;
                } else {
                    if (ch.gate) wf |= 0x01; else wf &= 0xFE;
                    regs[off + 4] = wf;
                }
            }
            
            regs[off] = effectiveFreq & 0xFF;
            regs[off + 1] = (effectiveFreq >> 8) & 0xFF;
        });

        // Global Filter Registers
        regs[21] = cutoff & 0x07;
        regs[22] = (cutoff >> 3) & 0xFF;
        regs[23] = ((resonance & 0xF) << 4) | (filterRoute & 0x0F); 
        regs[24] = ((filterMode & 0xF) << 4) | (volume & 0x0F);
        
        frames.push(new Uint8Array(regs));
        
        // Push all registers to event stream (except Control reg which might have been handled by trigger logic)
        for(let r=0; r<25; r++) {
            // If it's a control register and we just triggered, skip pushing the frame value
            // because we already pushed specific timed events for it above.
            const isCtrl = (r === 4 || r === 11 || r === 18);
            const chIdx = Math.floor(r/7);
            
            if (!isCtrl || !triggeredChannels.has(chIdx)) {
                events.push({ cycles: globalCycle, reg: r, val: regs[r] });
            }
        }
        events.push(...gateOns);
    };

    let frameIndex = 0;
    const cyclesPerFrame = clock / fps;

    for (const patId of subtune.orderList) {
        const pattern = project.patterns.find(p => p.id === patId);
        for (let r = 0; r < 64; r++) {
            channels.forEach(ch => { ch.slide = 0; });
            const rowData = pattern ? pattern.rows[r] : null;
            if (rowData) {
                rowData.forEach((cell, chIdx) => {
                    const ch = channels[chIdx];
                    if (cell.inst > 0) {
                        ch.activeInstId = cell.inst;
                        const inst = project.instruments.find(i => i.id === cell.inst);
                        if (inst) { ch.pw = inst.pulseWidth; ch.waveformOverride = -1; }
                    }
                    if (cell.note === '===') ch.gate = false;
                    else if (cell.note !== '---') {
                        const notes = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
                        const midi = parseInt(cell.note.substring(2), 10)*12 + notes.indexOf(cell.note.substring(0,2));
                        const newFreq = midiNoteToFreq(midi, clock);
                        if (cell.cmd === '3' && ch.gate) {
                            ch.targetFreq = newFreq;
                            ch.glideSpeed = parseInt(cell.val, 16) || 10;
                        } else {
                            ch.freq = newFreq;
                            ch.baseMidi = midi; 
                            ch.glideSpeed = 0;
                            ch.gate = true;
                            // Set Trigger for Micro-Timing Gate Sequence
                            ch.trigger = true;
                        }
                    }
                    const val = parseInt(cell.val, 16) || 0;
                    if (cell.cmd === '1' || cell.cmd === '2') {
                        ch.slide = (cell.cmd === '1' ? 1 : -1) * val * 2;
                        ch.glideSpeed = 0;
                    }
                    if (cell.cmd === 'F') cutoff = val << 3;
                    if (cell.cmd === 'R') { resonance = val >> 4; filterRoute = val & 0xF; }
                    if (cell.cmd === 'T') { filterMode = val >> 4; volume = val & 0xF; }
                    if (cell.cmd === 'E') ch.pw = val << 4;
                    if (cell.cmd === 'C') volume = val & 0xF;
                    if (cell.cmd === 'W') {
                        const inst = project.instruments.find(i => i.id === ch.activeInstId);
                        ch.waveformOverride = (val & 0xF0) | ((ch.waveformOverride >= 0 ? ch.waveformOverride : inst?.waveform ?? 0) & 0x0E);
                    }
                    if (cell.cmd === '0') { ch.arpeggioX = (val >> 4); ch.arpeggioY = (val & 0xF); }
                });
            }
            for(let s=0; s<speed; s++) {
                pushFrame(s, Math.floor(frameIndex * cyclesPerFrame));
                frameIndex++;
            }
        }
    }

    // Stable sorting preserves same-cycle gate-off/configuration ordering.
    events.sort((a, b) => a.cycles - b.cycles);
    return { header: { clock, fps, song: project.meta.title }, frames, events };
};
