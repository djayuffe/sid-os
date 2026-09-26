
import { SidDump, SidChipState } from './SidTypes';
import { SystemLogger } from '../../services/Logger';
import { SidAnalyzer } from '../analysis'; 

// MIDI Constants
const TPQ = 480; 
const DEFAULT_BPM = 120;
const PITCH_BEND_RANGE = 12; // Semitones

// Clamping Helper
const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
const clamp7 = (val: number) => clamp(Math.floor(val), 0, 127);
const clamp14 = (val: number) => clamp(Math.round(val), 0, 16383);

export interface MidiConversionOptions {
    quantize?: 'none' | 'auto' | '1/32' | '1/16' | '1/8' | '1/4';
    useExpression?: boolean; 
    fullAutomation?: boolean; 
    mergeGaps?: boolean;     
    minNoteFrames?: number;  
    octaveShift?: number; 
    detectDrums?: boolean;   
    noteDuration?: 'gate' | 'audible' | 'smart';
    convertArpsToChords?: boolean;
    humanize?: number; // 0 to 100
}

// Helpers for binary writing
class MidiWriter {
  private chunks: Uint8Array[] = [];
  writeStr(str: string) { const arr = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i); this.chunks.push(arr); }
  writeU32(val: number) { this.chunks.push(new Uint8Array([(val>>>24)&0xFF,(val>>>16)&0xFF,(val>>>8)&0xFF,val&0xFF])); }
  writeU16(val: number) { this.chunks.push(new Uint8Array([(val>>>8)&0xFF,val&0xFF])); }
  writeBytes(bytes: number[]) { this.chunks.push(new Uint8Array(bytes)); }
  writeVarInt(value: number) {
    let buffer: number[] = [], v = Math.round(value);
    if (v < 0) v = 0; buffer.push(v & 0x7F);
    while ((v >>>= 7) > 0) buffer.push((v & 0x7F) | 0x80);
    this.writeBytes(buffer.reverse());
  }
  toBytes(): Uint8Array {
    let size = 0; for (const c of this.chunks) size += c.length;
    const res = new Uint8Array(size); let offset = 0;
    for (const c of this.chunks) { res.set(c, offset); offset += c.length; }
    return res;
  }
}

interface NoteSegment {
  startFrame: number; endFrame: number; 
  startTime: number; endTime: number; // Seconds
  note: number; midiNoteFloat: number;
  velocity: number; maxEnvelope: number; 
  isNoise: boolean; waveform: number; 
  chordNotes?: number[]; 
  avgFreq: number; noiseType?: string;
  // Drum / Analysis Extras
  startMidi: number; endMidi: number; pitchSlide: number; 
  isPercussiveEnv: boolean;
  noiseFreqStart: number; noiseFreqEnd: number;
  pulseWidthStart: number; pulseWidthEnd: number;
}

class AutomationTrack {
    private events: MidiEvent[] = [];
    private lastValues = new Map<number, number>(); 
    constructor(private channel: number, eventsArray: MidiEvent[]) { this.events = eventsArray; }
    public setCC(tick: number, cc: number, value: number) {
        const clamped = clamp7(value);
        if (this.lastValues.get(cc) !== clamped) {
            this.events.push({ tick, type: 'cc', priority: 1, data: [0xB0 | this.channel, cc, clamped] });
            this.lastValues.set(cc, clamped);
        }
    }
}

interface MidiEvent { tick: number; type: string; data: number[], priority: number }

export class JsonToMidiConverter {
  
  private mapCutoff(sidVal: number): number {
      const norm = sidVal / 2047;
      const curved = Math.pow(norm, 3.5); 
      return clamp7(curved * 127);
  }

  public convert(dump: SidDump, options: MidiConversionOptions = {}): Uint8Array {
    const writer = new MidiWriter();
    
    const analysis = SidAnalyzer.analyze(dump);
    const useBPM = analysis.estimatedBpm || DEFAULT_BPM;
    const ticksPerSec = (useBPM * TPQ) / 60;

    SystemLogger.log('MidiConv', `Detected BPM: ${Math.round(useBPM)} | Ticks/Sec: ${Math.round(ticksPerSec)}`, 'info');

    const title = this.cleanString(dump.metadata?.title) || "SID Export";
    const author = this.cleanString(dump.metadata?.author) || "Unknown";
    const released = this.cleanString(dump.metadata?.released) || "Unknown";
    const credits = `${title} by ${author} (${released})`;

    writer.writeStr("MThd"); writer.writeU32(6); writer.writeU16(1); 
    const trackBuffers: Uint8Array[] = [];

    // Track 0
    const trk0 = new MidiWriter();
    trk0.writeVarInt(0); trk0.writeBytes([0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]); 
    const tempoMicro = Math.round(60000000 / useBPM);
    trk0.writeVarInt(0); trk0.writeBytes([0xFF, 0x51, 0x03, (tempoMicro >> 16) & 0xFF, (tempoMicro >> 8) & 0xFF, tempoMicro & 0xFF]); 
    trk0.writeVarInt(0); trk0.writeBytes([0xFF, 0x03, title.length, ...title.split('').map(c => c.charCodeAt(0))]);
    trk0.writeVarInt(0); trk0.writeBytes([0xFF, 0x01, credits.length, ...credits.split('').map(c => c.charCodeAt(0))]);
    if (analysis.keySignature && analysis.keySignature !== "Unknown") {
        const keyText = `Key: ${analysis.keySignature}`;
        trk0.writeVarInt(0); trk0.writeBytes([0xFF, 0x01, keyText.length, ...keyText.split('').map(c => c.charCodeAt(0))]);
    }
    trk0.writeVarInt(0); trk0.writeBytes([0xFF, 0x2F, 0x00]); 
    trackBuffers.push(trk0.toBytes());

    let effectiveQuantize = options.quantize || 'none';
    let gridTicks = 1;
    if (effectiveQuantize === 'auto') effectiveQuantize = 'none'; 
    if (effectiveQuantize === '1/4') gridTicks = TPQ; else if (effectiveQuantize === '1/8') gridTicks = TPQ/2; else if (effectiveQuantize === '1/16') gridTicks = TPQ/4; else if (effectiveQuantize === '1/32') gridTicks = TPQ/8;

    let effectiveShift = options.octaveShift !== undefined ? options.octaveShift : 0;
    if (options.octaveShift === 0) effectiveShift = this.detectOptimalOctaveShift(dump);

    const frameCount = dump.frames ? dump.frames.length : 0;
    const opts: Required<MidiConversionOptions> = { useExpression: true, fullAutomation: true, mergeGaps: true, minNoteFrames: 2, octaveShift: effectiveShift, detectDrums: true, noteDuration: 'smart', convertArpsToChords: false, humanize: 0, ...options, quantize: effectiveQuantize as any };

    const drumEvents: MidiEvent[] = [];
    const systemEvents: MidiEvent[] = [];

    const humanizeFactor = clamp(opts.humanize, 0, 100) / 100.0;
    const tickJitterMax = TPQ * 0.125; 

    // System Tracks (Global Filter per Chip)
    const chipCount = dump.frames[0]?.chips.length || 1;
    
    for (let c = 0; c < chipCount; c++) {
        const sysTrk = new MidiWriter();
        const sName = `SID ${c+1} Filter/System`;
        sysTrk.writeVarInt(0); sysTrk.writeBytes([0xFF, 0x03, sName.length, ...sName.split('').map(c => c.charCodeAt(0))]);
        const auto = new AutomationTrack(0, systemEvents); // Ch 1 for filters usually
        
        for (let i = 0; i < frameCount; i++) { 
            const frame = dump.frames[i]; 
            const chip = frame.chips[c];
            const tick = Math.max(0, Math.round(frame.time * ticksPerSec));
            
            const midiCutoff = this.mapCutoff(chip.filter.cutoff);
            
            // Map Chip 1 to Ch1, Chip 2 to Ch2, Chip 3 to Ch3 for filter controls (conceptual)
            // But usually we just dump to one track or separate.
            // Let's reuse AutomationTrack logic but separate array if needed. 
            // For now, dumping all filter data to one SysEx track or CC track is complex.
            // Simplified: Only Chip 1 Filter automation is fully supported in standard midi players unless we use many channels.
            if (c === 0) {
                auto.setCC(tick, 74, midiCutoff); 
                auto.setCC(tick, 71, chip.filter.resonance * 8);    
                auto.setCC(tick, 7, (chip.filter.vol * 127) / 15); 
                
                if (opts.fullAutomation) { 
                    auto.setCC(tick, 85, chip.filter.mode * 8); 
                    auto.setCC(tick, 86, chip.filter.routing * 8); 
                }
            }
        }
        if (c === 0) {
            this.sortAndWriteTrack(writer, sysTrk, systemEvents);
            trackBuffers.push(sysTrk.toBytes());
        }
    }

    // Voice Tracks (Loop over all chips and voices)
    // MIDI Channels: 0-15. Drums usually 9.
    // Voices: 1-3 -> Ch 0-2
    // Voices: 4-6 -> Ch 3-5 (Chip 2)
    // Voices: 7-9 -> Ch 6-8 (Chip 3)
    
    let totalVoicesProcessed = 0;

    for (let c = 0; c < chipCount; c++) {
        for (let v = 0; v < 3; v++) {
          const globalVoiceIdx = totalVoicesProcessed;
          const trk = new MidiWriter(); 
          // Map to MIDI channel, skipping 9 (Drums)
          let channel = globalVoiceIdx;
          if (channel >= 9) channel++; 
          
          const vName = `Chip ${c+1} Voice ${v + 1}`;
          trk.writeVarInt(0); trk.writeBytes([0xFF, 0x03, vName.length, ...vName.split('').map(c => c.charCodeAt(0))]);

          let segments = this.analyzeVoice(dump, c, v, opts);
          if (opts.mergeGaps) segments = this.mergeSegments(segments, 0.05); 
          if (opts.convertArpsToChords) segments = this.detectArpeggios(segments);

          // Get instrument suggestion for this specific global voice index
          const suggestedProg = clamp7(analysis.suggestedInstruments[globalVoiceIdx]?.program || 80);
          
          const events: MidiEvent[] = [
              { tick: 0, type: 'pc', priority: 0, data: [0xC0 | channel, suggestedProg] },
              { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 101, 0] },
              { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 100, 0] },
              { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 6, clamp7(PITCH_BEND_RANGE)] }, 
              { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 38, 0] },
              { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 101, 127] },
              { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 100, 127] },
              { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 10, 64] } 
          ];
          const automation = new AutomationTrack(channel, events);

          segments.forEach(seg => {
            let startTick = Math.max(0, Math.round(seg.startTime * ticksPerSec));
            let endTick = Math.max(0, Math.round(seg.endTime * ticksPerSec));
            
            let velOffset = 0;
            if (humanizeFactor > 0 && opts.quantize === 'none') {
                const startError = (Math.random() - 0.5) * tickJitterMax * humanizeFactor; 
                const endError = (Math.random() - 0.5) * tickJitterMax * humanizeFactor;

                startTick += Math.round(startError);
                endTick += Math.round(endError);
                
                const tangentFactor = Math.abs(seg.note - 60) / 40; 
                const randomVelVar = (Math.random() - 0.5) * 30 * humanizeFactor;
                
                velOffset = randomVelVar + (tangentFactor * 5 * humanizeFactor * (Math.random() > 0.5 ? 1 : -1));
            }

            // Strict Clamping on Time
            if (startTick < 0) startTick = 0;
            if (endTick <= startTick) endTick = startTick + (TPQ / 16); 
            
            if (opts.quantize !== 'none') { 
                startTick = Math.round(startTick/gridTicks)*gridTicks; 
                endTick = Math.round(endTick/gridTicks)*gridTicks; 
                if(endTick<=startTick) endTick+=gridTicks; 
            }
            
            const nonLinearVel = Math.pow(seg.maxEnvelope, 0.4);
            let baseVelocity = Math.floor(nonLinearVel * 127);
            let velocity = clamp(Math.round(baseVelocity + velOffset), 1, 127);

            const isTonalKick = !seg.isNoise && seg.pitchSlide > 10 && seg.startMidi < 60 && seg.isPercussiveEnv;
            const isPwmKick = !seg.isNoise && (seg.waveform & 4) !== 0 && Math.abs(seg.pulseWidthStart - seg.pulseWidthEnd) > 1000 && seg.startMidi < 45;

            if ((seg.isNoise || isTonalKick || isPwmKick) && opts.detectDrums) {
                const drumNote = clamp7(this.classifyDrum(seg)); 
                const drumCh = 9; 
                drumEvents.push({ tick: startTick, type: 'on', priority: 3, data: [0x90 | drumCh, drumNote, velocity] });
                drumEvents.push({ tick: endTick, type: 'off', priority: 0, data: [0x80 | drumCh, drumNote, 0] });
            } else if (seg.chordNotes) {
                const shift = opts.octaveShift * 12;
                seg.chordNotes.forEach((note, idx) => {
                    const midiNote = clamp7(note + shift);
                    let strumTick = startTick;
                    if (humanizeFactor > 0) {
                        strumTick = Math.max(0, startTick + Math.round(idx * 5 * humanizeFactor));
                    }
                    events.push({ tick: strumTick, type: 'on', priority: 3, data: [0x90 | channel, midiNote, velocity] });
                    events.push({ tick: endTick, type: 'off', priority: 0, data: [0x80 | channel, midiNote, 0] });
                });
            } else {
                const startBendVal = this.calculatePitchBend(seg.midiNoteFloat - seg.note);
                events.push({ tick: startTick, type: 'bend', priority: 2, data: [0xE0 | channel, startBendVal & 0x7F, (startBendVal >>> 7) & 0x7F] });

                for (let f = seg.startFrame; f < seg.endFrame; f++) {
                    if (f >= frameCount) break;
                    const vState = dump.frames[f].chips[c].voices[v];
                    const frameTime = dump.frames[f].time;
                    const t = Math.max(0, Math.round(frameTime * ticksPerSec));
                    
                    if (vState.midiNote > 0 && t > startTick && t < endTick) {
                        const diff = vState.midiNote - seg.note;
                        if (Math.abs(diff) < PITCH_BEND_RANGE) {
                             const bendVal = this.calculatePitchBend(diff);
                             events.push({ tick: t, type: 'bend', priority: 2, data: [0xE0 | channel, bendVal & 0x7F, (bendVal >>> 7) & 0x7F] });
                        }
                    }
                }
                events.push({ tick: endTick, type: 'bend', priority: 2, data: [0xE0 | channel, 0x00, 0x40] }); 

                let midiNote = clamp7(seg.note + (opts.octaveShift * 12));
                events.push({ tick: startTick, type: 'on', priority: 3, data: [0x90 | channel, midiNote, velocity] });
                events.push({ tick: endTick, type: 'off', priority: 0, data: [0x80 | channel, midiNote, 0] });
            }
          });
          
          for (let i = 0; i < frameCount; i++) {
              const frame = dump.frames[i]; 
              const tick = Math.max(0, Math.round(frame.time * ticksPerSec));
              const vs = frame.chips[c].voices[v];
              
              if (opts.useExpression) {
                  const nonLinearExp = Math.pow(vs.envelope, 0.4); 
                  const exprVal = clamp7(nonLinearExp * 127);
                  automation.setCC(tick, 11, exprVal);
              }

              const isPulseWave = (vs.waveform & 4) !== 0;
              if (isPulseWave || opts.fullAutomation) {
                  const pulseWidthMidi = clamp7((vs.pulse / 4095) * 127);
                  automation.setCC(tick, 70, pulseWidthMidi);
              }

              if (opts.fullAutomation) {
                  automation.setCC(tick, 73, vs.attack*8); automation.setCC(tick, 75, vs.decay*8);
                  automation.setCC(tick, 79, vs.sustain*8); automation.setCC(tick, 72, vs.release*8);
                  automation.setCC(tick, 87, vs.waveform*8); 
              }
          }
          this.sortAndWriteTrack(writer, trk, events);
          trackBuffers.push(trk.toBytes());
          
          totalVoicesProcessed++;
        }
    }

    if (drumEvents.length > 0) {
        const drumTrk = new MidiWriter();
        const dName = "Drums (Ch10)"; drumTrk.writeVarInt(0); drumTrk.writeBytes([0xFF, 0x03, dName.length, ...dName.split('').map(c => c.charCodeAt(0))]);
        this.sortAndWriteTrack(writer, drumTrk, drumEvents);
        trackBuffers.push(drumTrk.toBytes());
    }

    writer.writeU16(trackBuffers.length); writer.writeU16(TPQ);
    trackBuffers.forEach(buf => { writer.writeStr("MTrk"); writer.writeU32(buf.length); writer.writeBytes(Array.from(buf)); });
    return writer.toBytes();
  }

  private calculatePitchBend(semitones: number): number {
      const scale = 8192 / PITCH_BEND_RANGE;
      let val = Math.round(8192 + (semitones * scale));
      return clamp14(val);
  }

  private sortAndWriteTrack(main: MidiWriter, trk: MidiWriter, events: MidiEvent[]) {
      events.sort((a, b) => { if (a.tick !== b.tick) return a.tick - b.tick; return a.priority - b.priority; });
      let lastTick = 0;
      for (const ev of events) {
        if (ev.tick < lastTick) ev.tick = lastTick; 
        const delta = ev.tick - lastTick;
        trk.writeVarInt(delta); trk.writeBytes(ev.data); lastTick = ev.tick;
      }
      trk.writeVarInt(0); trk.writeBytes([0xFF, 0x2F, 0x00]);
  }

  private cleanString(str?: string): string { return str ? str.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim() : ""; }

  private detectBPM(dump: SidDump): number {
      const noteOnsets: number[] = [];
      const opts: Required<MidiConversionOptions> = { quantize: 'none', mergeGaps: true, minNoteFrames: 1, octaveShift:0, detectDrums:true, noteDuration:'audible', convertArpsToChords:false, useExpression:false, fullAutomation:false, humanize: 0 };
      
      const chipCount = dump.frames[0]?.chips.length || 1;
      for(let c=0; c<chipCount; c++) {
          for(let v=0; v<3; v++) {
              const segs = this.analyzeVoice(dump, c, v, opts);
              segs.forEach(s => noteOnsets.push(s.startTime));
          }
      }
      if (noteOnsets.length < 10) return DEFAULT_BPM;
      noteOnsets.sort((a, b) => a - b);
      const intervals: number[] = [];
      for(let i=0; i<noteOnsets.length-1; i++) { const diff = noteOnsets[i+1] - noteOnsets[i]; if (diff > 0.05) intervals.push(diff); }
      const intervalCounts = new Map<string, number>();
      intervals.forEach(int => { const key = (Math.round(int * 50) / 50).toFixed(2); intervalCounts.set(key, (intervalCounts.get(key) || 0) + 1); });
      let maxCount = 0, commonInterval = 0.125; 
      intervalCounts.forEach((count, key) => { if (count > maxCount) { maxCount = count; commonInterval = parseFloat(key); } });
      if (commonInterval <= 0) return DEFAULT_BPM;
      let bpm = 60 / (commonInterval * 4);
      if (bpm < 60) bpm *= 2; if (bpm > 200) bpm /= 2;
      return Math.round(bpm);
  }

  private classifyDrum(seg: NoteSegment): number {
    const durSeconds = seg.endTime - seg.startTime;
    const noiseSlope = seg.noiseFreqStart - seg.noiseFreqEnd; 

    // 1. Tonal Detection
    if (!seg.isNoise) {
        if (seg.startMidi < 60 && seg.pitchSlide > 10 && durSeconds < 0.3) {
             return 36; // Kick
        }
        if (seg.startMidi >= 50 && seg.startMidi < 80 && seg.pitchSlide > 8 && durSeconds < 0.4) {
            if (seg.startMidi > 70) return 50; 
            if (seg.startMidi > 60) return 47; 
            return 45; 
        }
    }

    // 2. Noise Detection
    if (seg.isNoise) {
        if (seg.noiseType === 'high' || seg.avgFreq > 0x3000) {
             if (durSeconds < 0.08) return 42; 
             if (durSeconds < 0.3) return 46; 
             return 49; 
        }
        if (seg.noiseType === 'mid' || seg.avgFreq > 0x1500) {
            if (noiseSlope > 500 && durSeconds > 0.1) return 38; 
            if (durSeconds < 0.1) return 39; 
            return 40; 
        }
        if (durSeconds > 0.15) return 43; 
        return 36; 
    }
    return 38; 
  }

  private analyzeVoice(dump: SidDump, cIdx: number, vIdx: number, opts: Required<MidiConversionOptions>): NoteSegment[] {
    const segments: NoteSegment[] = []; const frameCount = dump.frames.length;
    let activeSegment: NoteSegment | null = null;
    let noteAccum = 0, freqAccum = 0, noteCount = 0;
    let attackFrames = 0;
    
    // Vibrato Detection History
    const pitchHistory: number[] = [];

    for (let f = 0; f < frameCount; f++) {
        const frame = dump.frames[f]; 
        const v = frame.chips[cIdx].voices[vIdx];
        const prevV = f > 0 ? dump.frames[f-1].chips[cIdx].voices[vIdx] : v;

        const gateHigh = v.gate;
        const gateEdge = v.gate && !prevV.gate;
        const isNoise = (v.rawWaveform & 0x80) !== 0; 
        const isTonal = !isNoise && v.waveform !== 0;
        const hasLevel = v.envelope > 0.005;
        
        let isVibrato = false;
        if (activeSegment && isTonal && v.midiNote > 0 && !gateEdge) {
            pitchHistory.push(v.midiNote);
            if (pitchHistory.length > 5) pitchHistory.shift();
            
            if (pitchHistory.length >= 3) {
                 const diff = Math.abs(v.midiNote - activeSegment.midiNoteFloat);
                 if (diff < 1.0) isVibrato = true;
            }
        } else {
            pitchHistory.length = 0;
        }

        if (activeSegment) {
            let shouldClose = false;
            
            if (gateEdge) shouldClose = true; 
            if (activeSegment.waveform !== v.waveform && !isVibrato) shouldClose = true; 
            
            if (gateHigh && isTonal && v.midiNote > 0 && !isVibrato) {
                 const prevNote = prevV.midiNote;
                 const jump = Math.abs(v.midiNote - activeSegment.note);
                 if (jump > 1.0) {
                     const isInstantStep = Math.abs(v.midiNote - prevNote) > 1.0;
                     if (isInstantStep) shouldClose = true;
                 }
            }
            
            if (opts.noteDuration === 'gate') { if (!gateHigh && prevV.gate) shouldClose = true; } 
            else if (opts.noteDuration === 'smart') { if (v.sustain > 0) { if (!gateHigh && prevV.gate) shouldClose = true; } else { if (!hasLevel && !gateHigh) shouldClose = true; } } 
            else { if (!hasLevel && !gateHigh) shouldClose = true; }

            if (shouldClose) {
                activeSegment.endFrame = f;
                activeSegment.endTime = frame.time;
                activeSegment.midiNoteFloat = noteAccum / (noteCount || 1); 
                activeSegment.avgFreq = freqAccum / (noteCount || 1);
                
                const prevFrame = dump.frames[f-1].chips[cIdx].voices[vIdx];
                activeSegment.endMidi = prevFrame.midiNote;
                activeSegment.noiseFreqEnd = prevFrame.freqReg;
                activeSegment.pulseWidthEnd = prevFrame.pulse;
                
                activeSegment.pitchSlide = activeSegment.startMidi - activeSegment.endMidi;
                activeSegment.isPercussiveEnv = attackFrames < 5 && activeSegment.maxEnvelope > 0.5;

                // Time duration check instead of frame count
                if ((activeSegment.endTime - activeSegment.startTime) >= 0.02) {
                     segments.push(activeSegment);
                }
                activeSegment = null;
                attackFrames = 0;
                pitchHistory.length = 0;
            }
        }

        const validSignal = (v.midiNote > 0 || isNoise) && (gateHigh || (hasLevel && opts.noteDuration !== 'gate'));
        
        if (!activeSegment && validSignal) {
             activeSegment = { 
                 startFrame: f, endFrame: f, 
                 startTime: frame.time, endTime: frame.time,
                 note: Math.round(v.midiNote), midiNoteFloat: v.midiNote, 
                 velocity: 0, maxEnvelope: v.envelope, 
                 isNoise: isNoise, waveform: v.waveform, 
                 avgFreq: v.freqReg, noiseType: v.noiseType,
                 startMidi: v.midiNote, endMidi: v.midiNote, pitchSlide: 0, isPercussiveEnv: false,
                 noiseFreqStart: v.freqReg, noiseFreqEnd: v.freqReg,
                 pulseWidthStart: v.pulse, pulseWidthEnd: v.pulse
             };
             noteAccum = v.midiNote; freqAccum = v.freqReg; noteCount = 1;
             attackFrames = 0;
             pitchHistory.push(v.midiNote);
        } else if (activeSegment) {
            activeSegment.endFrame = f;
            activeSegment.endTime = frame.time;
            if (v.envelope > activeSegment.maxEnvelope) activeSegment.maxEnvelope = v.envelope;
            if (v.envelope > (dump.frames[f-1].chips[cIdx].voices[vIdx].envelope)) attackFrames++;
            
            activeSegment.noiseFreqEnd = v.freqReg;
            activeSegment.pulseWidthEnd = v.pulse;
            
            if (v.midiNote > 0) {
                 noteAccum += v.midiNote; freqAccum += v.freqReg; noteCount++;
            }
        }
    }
    
    if (activeSegment) {
        activeSegment.endFrame = frameCount; 
        activeSegment.endTime = dump.frames[frameCount-1].time;
        activeSegment.midiNoteFloat = noteAccum / (noteCount || 1); 
        activeSegment.avgFreq = freqAccum / (noteCount || 1);
        activeSegment.endMidi = dump.frames[frameCount-1].chips[cIdx].voices[vIdx].midiNote;
        activeSegment.pitchSlide = activeSegment.startMidi - activeSegment.endMidi;
        activeSegment.isPercussiveEnv = attackFrames < 5;
        segments.push(activeSegment);
    }
    return segments;
  }

  private mergeSegments(segments: NoteSegment[], gapThresholdSeconds: number): NoteSegment[] {
      if (segments.length === 0) return segments;
      const merged: NoteSegment[] = [segments[0]];
      for (let i = 1; i < segments.length; i++) {
          const prev = merged[merged.length - 1]; const curr = segments[i]; 
          const gap = curr.startTime - prev.endTime;
          
          const sameNote = Math.abs(prev.note - curr.note) < 1;
          const sameType = prev.isNoise === curr.isNoise && prev.waveform === curr.waveform;
          
          if (gap <= gapThresholdSeconds && sameNote && sameType) { 
              prev.endFrame = curr.endFrame; 
              prev.endTime = curr.endTime;
              prev.maxEnvelope = Math.max(prev.maxEnvelope, curr.maxEnvelope); 
              prev.midiNoteFloat = (prev.midiNoteFloat + curr.midiNoteFloat) / 2;
          } else { 
              merged.push(curr); 
          }
      }
      return merged;
  }

  private detectArpeggios(segments: NoteSegment[]): NoteSegment[] {
      const output: NoteSegment[] = []; 
      const MAX_CHORD_SPAN = 0.33; // Seconds
      const ARP_SPEED_LIMIT = 0.10; // Seconds

      let i = 0;
      while (i < segments.length) {
          const seg = segments[i]; 
          const duration = seg.endTime - seg.startTime;
          
          if (duration > ARP_SPEED_LIMIT || seg.isNoise) { 
              output.push(seg); i++; continue; 
          }
          
          const sequence: NoteSegment[] = [seg];
          let j = i + 1;
          let totalDuration = duration;
          
          while (j < segments.length) {
              const next = segments[j];
              const gap = next.startTime - sequence[sequence.length-1].endTime;
              const nextDur = next.endTime - next.startTime;
              
              if (gap < 0.05 && nextDur < ARP_SPEED_LIMIT && !next.isNoise && totalDuration < MAX_CHORD_SPAN) { 
                  sequence.push(next); 
                  totalDuration += (gap + nextDur);
                  j++; 
              } else {
                  break;
              }
          }
          
          if (sequence.length >= 3) {
              const uniqueNotes = Array.from(new Set(sequence.map(s => s.note))).sort((a,b) => a-b);
              const root = uniqueNotes[0];
              const intervals = uniqueNotes.map(n => n - root);
              const isHarmonic = intervals.every(int => [0,3,4,5,7,12,15,16,19,24].includes(int % 12) || int === 0);
              
              if (uniqueNotes.length >= 2 && isHarmonic) {
                   output.push({ 
                       startFrame: sequence[0].startFrame, 
                       endFrame: sequence[sequence.length-1].endFrame, 
                       startTime: sequence[0].startTime,
                       endTime: sequence[sequence.length-1].endTime,
                       note: root, 
                       midiNoteFloat: root, 
                       maxEnvelope: Math.max(...sequence.map(s => s.maxEnvelope)), 
                       velocity: 0, 
                       isNoise: false, 
                       waveform: sequence[0].waveform, 
                       avgFreq: sequence[0].avgFreq, 
                       chordNotes: uniqueNotes, 
                       startMidi: sequence[0].startMidi, 
                       endMidi: sequence[sequence.length-1].endMidi, 
                       pitchSlide: 0, isPercussiveEnv: false, 
                       noiseFreqStart: 0, noiseFreqEnd: 0, pulseWidthStart: 0, pulseWidthEnd: 0 
                   });
                   i = j; continue;
              }
          }
          output.push(seg); i++;
      }
      return output;
  }

  private detectOptimalOctaveShift(dump: SidDump): number {
      let weightedSum = 0; let totalDuration = 0;
      // Use first chip for detection to be fast
      dump.frames.forEach(frame => { frame.chips[0].voices.forEach(v => { if (v.gate && v.midiNote > 0 && !((v.rawWaveform & 0x80) !== 0)) { weightedSum += v.midiNote; totalDuration++; } }); });
      if (totalDuration === 0) return 0;
      return Math.round((60 - (weightedSum / totalDuration)) / 12); 
  }
}
