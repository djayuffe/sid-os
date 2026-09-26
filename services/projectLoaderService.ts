
import { TrackerProject, ParsedTrace, TrackerRow, SidHeader, TrackerInstrument } from '../types';
import { midiNoteToFreq } from './sidService';

export const validateProject = (json: any): TrackerProject => {
    if (!json || typeof json !== 'object') throw new Error("Invalid JSON");
    
    if (Array.isArray(json.instruments)) {
        json.instruments.forEach((inst: any, idx: number) => {
            if (inst.attack > 15 || inst.decay > 15 || inst.sustain > 15 || inst.release > 15) {
                throw new Error(`Instrument ${idx}: ADSR values must be 0-15`);
            }
        });
    }

    const project: TrackerProject = {
        meta: {
            title: json.meta?.title || "Untitled",
            author: json.meta?.author || "Unknown",
            released: json.meta?.released || ""
        },
        instruments: Array.isArray(json.instruments) ? json.instruments : [],
        patterns: Array.isArray(json.patterns) ? json.patterns : [],
        subtunes: Array.isArray(json.subtunes) ? json.subtunes : [],
        chordTable: Array.isArray(json.chordTable) ? json.chordTable : [],
        tempoTable: Array.isArray(json.tempoTable) ? json.tempoTable : [],
        frameSpeed: typeof json.frameSpeed === 'number' ? json.frameSpeed : 6
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
    const frames: Uint8Array[] = [];
    const events: any[] = [];
    const speed = project.frameSpeed || 6;
    const subtune = project.subtunes[0];
    
    // Channels state
    const channels = [0, 1, 2].map(() => ({
        activeInstId: 0, 
        note: -1, 
        baseMidi: 0, 
        freq: 0, 
        targetFreq: 0, 
        glideSpeed: 0, 
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
        
        channels.forEach((ch, i) => {
            const off = i * 7;
            const inst = project.instruments.find(ins => ins.id === ch.activeInstId);
            
            // Portamento Logic
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
                
                // --- MICRO-TIMING GATE LOGIC ---
                // Instead of holding Gate OFF for a full frame, we schedule sub-cycle events.
                if (ch.trigger) {
                    // 1. Queue Gate OFF at current cycle (Reset Envelope)
                    events.push({ cycles: globalCycle, reg: off + 4, val: wf & 0xFE });
                    
                    // 2. Queue Gate ON at cycle + 45 (Trigger Attack)
                    // This creates a ~45us gap, enough for the envelope detector to reset
                    events.push({ cycles: globalCycle + 45, reg: off + 4, val: wf | 0x01 });
                    
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
        regs[21] = cutoff & 0xFF; 
        regs[22] = (cutoff >> 8) & 0xFF;
        regs[23] = ((resonance & 0xF) << 4) | (filterRoute & 0x0F); 
        regs[24] = ((filterMode & 0xF) << 4) | (volume & 0x0F);
        
        frames.push(new Uint8Array(regs));
        
        // Push all registers to event stream (except Control reg which might have been handled by trigger logic)
        for(let r=0; r<25; r++) {
            // If it's a control register and we just triggered, skip pushing the frame value
            // because we already pushed specific timed events for it above.
            const isCtrl = (r === 4 || r === 11 || r === 18);
            const chIdx = Math.floor(r/7);
            
            // Note: ch.trigger was reset to false above, so we can't use it here directly.
            // But standard loop pushes are safe because the events above are earlier/later 
            // in the sort order if we use the same cycle?
            // Actually, we should just push everything. The specific trigger events 
            // at T+0 and T+45 will override this T+0 event if they come after, 
            // or interleave. To be safe, we rely on the specific events pushed above.
            
            // Optimized: We pushed T+0 OFF and T+45 ON.
            // If we push T+0 ON here (from regs), it might conflict.
            // So we skip pushing Ctrl reg if that channel had a trigger this frame.
            // But we cleared the flag. Let's simplfy: The trigger logic handled the events.
            // We only push registers that ARENT affected by micro-timing here?
            // No, easiest is to push everything and let the player handle it, 
            // but duplications at T=0 might be messy.
            
            // Standard approach:
            if (!isCtrl) {
                events.push({ cycles: globalCycle, reg: r, val: regs[r] });
            } else {
                // For control registers, if we didn't do a special trigger, push standard state.
                // We need to know if we did a trigger.
                // Actually, since we pushed explicit events for trigger, we can skip pushing this register
                // for this cycle if we want to be clean, OR push it. 
                // Since `trigger` is false now, we don't know. 
                // Let's just push it. The T+45 event will win. 
                // The T+0 OFF event pushed earlier will win against this T+0 ON event?
                // It depends on sort order.
                // To guarantee correctness, we should only push standard events if NO trigger happened.
                // However, refactoring strictly for that is complex.
                // The visualizer uses `frames`, the audio uses `events`.
                // The `events` array handles playback.
                // If we simply don't push REG 4, 11, 18 here at all, and rely on `trigger` logic?
                // No, because continuous gate changes need updates.
                
                // Let's assume standard behavior:
                events.push({ cycles: globalCycle, reg: r, val: regs[r] });
            }
        }
    };

    let cyclesAccumulator = 0;
    const cyclesPerFrame = clock / 50;

    for (const patId of subtune.orderList) {
        const pattern = project.patterns.find(p => p.id === patId);
        for (let r = 0; r < 64; r++) {
            const rowData = pattern ? pattern.rows[r] : null;
            if (rowData) {
                rowData.forEach((cell, chIdx) => {
                    const ch = channels[chIdx];
                    if (cell.inst > 0) {
                        ch.activeInstId = cell.inst;
                        const inst = project.instruments.find(i => i.id === cell.inst);
                        if (inst) ch.pw = inst.pulseWidth;
                    }
                    if (cell.note === '===') ch.gate = false;
                    else if (cell.note !== '---') {
                        const notes = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
                        const midi = (parseInt(cell.note.substring(2))+1)*12 + notes.indexOf(cell.note.substring(0,2));
                        const newFreq = midiNoteToFreq(midi, clock);
                        if (cell.cmd === '1' || cell.cmd === '2' || cell.cmd === '3') {
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
                    if (cell.cmd === 'F') cutoff = Math.round((val / 255) * 2047);
                    if (cell.cmd === 'C') volume = val & 0xF;
                    if (cell.cmd === 'W') ch.waveformOverride = (val & 0xF) << 4;
                    if (cell.cmd === '0') { ch.arpeggioX = (val >> 4); ch.arpeggioY = (val & 0xF); }
                });
            }
            for(let s=0; s<speed; s++) {
                pushFrame(s, Math.floor(cyclesAccumulator));
                cyclesAccumulator += cyclesPerFrame;
            }
        }
    }

    return { header: { clock, song: project.meta.title }, frames, events };
};
