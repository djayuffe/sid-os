
import { ParsedTrace } from '../types';

// --- Constants ---
const CLOCK_PAL = 985248;
const CLOCK_NTSC = 1022727;
const MIDI_NOTE_A4 = 69;
const FREQ_A4 = 440;

export type NoteDuration = 'smart' | 'raw' | '1/4' | '1/8' | '1/16' | '1/32';

export interface MidiExportOptions {
  bpm: number;
  ppq: number;
  duration: NoteDuration;
}

// --- Helpers ---

// Calculate exact float MIDI note from frequency for Pitch Bend calculation
const freqToMidiNoteFloat = (freqReg: number, clockFreq: number): number => {
  const freqHz = (freqReg * clockFreq) / 16777216;
  if (freqHz <= 0) return -1;
  return MIDI_NOTE_A4 + 12 * Math.log2(freqHz / FREQ_A4);
};

// Write a variable-length quantity (standard MIDI format)
const writeVLQ = (value: number, bytes: number[]) => {
  value = Math.max(0, Math.round(value));
  let buffer = value & 0x7f;
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
};

// Write a 32-bit integer (big-endian)
const writeUint32 = (val: number, bytes: number[]) => {
  bytes.push((val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF);
};

// Write a 16-bit integer (big-endian)
const writeUint16 = (val: number, bytes: number[]) => {
  bytes.push((val >> 8) & 0xFF, val & 0xFF);
};

// Write string as bytes
const writeString = (str: string, bytes: number[]) => {
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
  }
};

// --- Main Export Function ---

export const generateMidiFile = (trace: ParsedTrace, options: MidiExportOptions): Uint8Array => {
  const { bpm, ppq, duration } = options;
  
  const isNtsc = (trace.header.clock || CLOCK_PAL) >= 1000000;
  const clockFreq = isNtsc ? CLOCK_NTSC : CLOCK_PAL;
  const fps = isNtsc ? 60 : 50;
  
  // Calculate ticks per second for timing conversion
  const ticksPerSecond = (bpm * ppq) / 60;

  // Calculate Quantization Grid
  let quantizeTicks = 0;
  if (duration === 'smart') {
      quantizeTicks = ppq / 4; // Default to 16th notes for smart mode
  } else if (duration !== 'raw') {
      switch(duration) {
          case '1/4': quantizeTicks = ppq; break;
          case '1/8': quantizeTicks = ppq / 2; break;
          case '1/16': quantizeTicks = ppq / 4; break;
          case '1/32': quantizeTicks = ppq / 8; break;
      }
  }

  const tracks: number[][] = [];

  // Dynamically determine voice count (supports Multi-SID traces if frames are large enough)
  const numVoices = trace.frames.length > 0 ? Math.floor(trace.frames[0].length / 7) : 3;
  const safeVoices = Math.min(Math.max(3, numVoices), 16); // Limit to 16 MIDI channels

  for (let v = 0; v < safeVoices; v++) {
    const trackBytes: number[] = [];
    let currentTick = 0;
    let lastEventTick = 0;
    
    // Voice State Tracking
    let activeNote = -1;
    let lastGate = false;
    let lastPitchBend = 8192; // Center
    let lastCutoff = -1;
    let lastRes = -1;
    let lastPulse = -1;

    const midiCh = v % 16;
    
    // Identify if this voice should handle chip-global events (Filter)
    // Assuming 3 voices per SID: Voice 0, 3, 6... are leaders for their respective chips
    const isChipLeader = (v % 3) === 0; 
    const chipIdx = Math.floor(v / 3);
    
    // Calculate offsets based on standard linear packing:
    // [V1...V3, Filter...] (Single SID) or [V1..V3, Filter.., V4..V6, Filter..] (Multi)
    // However, most simple traces just stack voice registers.
    // If complex packing is used, adjust here. Standard assumption:
    // Regs 0-20 are voices. 21-24 are filter.
    // If multi-SID, usually trace contains [SID1_REGS, SID2_REGS...] concatenated.
    // Length of one SID block = 32 bytes (usually).
    const sidBlockSize = 32; 
    const regOffset = chipIdx * sidBlockSize + (v % 3) * 7;
    const filterRegOffset = chipIdx * sidBlockSize + 21;

    // Track Name Event
    writeVLQ(0, trackBytes); 
    trackBytes.push(0xFF, 0x03); 
    const name = `SID ${chipIdx + 1} Voice ${(v % 3) + 1}`;
    writeVLQ(name.length, trackBytes);
    writeString(name, trackBytes);
    
    // Tempo (Only on first track)
    if (v === 0) {
        writeVLQ(0, trackBytes);
        trackBytes.push(0xFF, 0x51, 0x03);
        const usPerQuarter = Math.round(60000000 / bpm);
        trackBytes.push((usPerQuarter >> 16) & 0xFF, (usPerQuarter >> 8) & 0xFF, usPerQuarter & 0xFF);
    }

    // Set Pitch Bend Range to +/- 12 semitones (RPN 00 00)
    // 1. CC 101 0, CC 100 0 (Select Pitch Bend Range RPN)
    // 2. CC 6 12 (Data Entry MSB = 12 semitones)
    // 3. CC 101 127, CC 100 127 (Reset RPN)
    writeVLQ(0, trackBytes); 
    trackBytes.push(0xB0 | midiCh, 101, 0, 0x00, 0xB0 | midiCh, 100, 0);
    writeVLQ(0, trackBytes); 
    trackBytes.push(0xB0 | midiCh, 6, 12);
    writeVLQ(0, trackBytes); 
    trackBytes.push(0xB0 | midiCh, 101, 127, 0x00, 0xB0 | midiCh, 100, 127);

    for (let f = 0; f < trace.frames.length; f++) {
      const frame = trace.frames[f];
      if (!frame || frame.length <= regOffset + 6) continue;

      // 1. Fix Floating Point Drift: Calculate tick from absolute frame index
      let eventTick = Math.round((f * ticksPerSecond) / fps);

      // 2. Smart Quantization
      if (quantizeTicks > 0) {
          eventTick = Math.round(eventTick / quantizeTicks) * quantizeTicks;
      }
      if (eventTick < currentTick) eventTick = currentTick;

      const deltaTime = eventTick - lastEventTick;

      // Read Registers
      const freqReg = frame[regOffset] | (frame[regOffset + 1] << 8);
      const pwReg = frame[regOffset + 2] | ((frame[regOffset + 3] & 0x0F) << 8);
      const ctrl = frame[regOffset + 4];
      const adsr = (frame[regOffset + 5] << 8) | frame[regOffset + 6];
      const gate = (ctrl & 0x01) !== 0;
      const sustain = (adsr >> 4) & 0x0F;
      
      const floatNote = freqToMidiNoteFloat(freqReg, clockFreq);
      const note = Math.round(floatNote);
      
      // 3. Dynamic Velocity
      // Use Sustain level as base for velocity (gives dynamics to held notes)
      // Scale 0-15 to 40-127 range roughly
      const velocity = Math.min(127, 40 + sustain * 6);

      // 4. CC Automation (Filter & Pulse Width)
      // Only process filter events if this voice is the "Leader" for the chip
      // and valid filter registers exist in the frame data.
      if (isChipLeader && frame.length > filterRegOffset + 2) {
          const fcLo = frame[filterRegOffset];
          const fcHi = frame[filterRegOffset + 1];
          // SID Cutoff 0-2047. Map to MIDI 0-127.
          const cutoff = Math.round(((fcLo | (fcHi << 8)) / 2047) * 127);
          
          if (cutoff !== lastCutoff) {
              writeVLQ(Math.max(0, eventTick - lastEventTick), trackBytes);
              trackBytes.push(0xB0 | midiCh, 74, cutoff); // CC 74 (Brightness/Cutoff)
              lastEventTick = eventTick;
              lastCutoff = cutoff;
          }

          const res = frame[filterRegOffset + 2] >> 4; // High nibble
          const resMidi = Math.round((res / 15) * 127);
          if (resMidi !== lastRes) {
              writeVLQ(Math.max(0, eventTick - lastEventTick), trackBytes);
              trackBytes.push(0xB0 | midiCh, 71, resMidi); // CC 71 (Resonance)
              lastEventTick = eventTick;
              lastRes = resMidi;
          }
      }

      // Voice Specific CC (Pulse Width) -> CC 70
      // Only if Pulse Wave is active (Bit 6)
      if (ctrl & 0x40) {
          const pwMidi = Math.round((pwReg / 4095) * 127);
          if (pwMidi !== lastPulse) {
              writeVLQ(Math.max(0, eventTick - lastEventTick), trackBytes);
              trackBytes.push(0xB0 | midiCh, 70, pwMidi);
              lastEventTick = eventTick;
              lastPulse = pwMidi;
          }
      }

      // 5. Pitch Bend Logic
      // If note is held, check for slides/vibrato
      if (gate && activeNote !== -1 && note === activeNote) {
          const diff = floatNote - note; // Deviation in semitones
          // Map +/- 12 semitones to 0-16383 (8192 center)
          // Scale: 1 semitone = 8192 / 12 = ~682.6 units
          const bendVal = Math.max(0, Math.min(16383, Math.round(8192 + (diff * 682.6))));
          
          // Hysteresis to reduce data density (only send if changed by > 64 units)
          if (Math.abs(bendVal - lastPitchBend) > 64) { 
              writeVLQ(Math.max(0, eventTick - lastEventTick), trackBytes);
              trackBytes.push(0xE0 | midiCh, bendVal & 0x7F, (bendVal >> 7) & 0x7F);
              lastEventTick = eventTick;
              lastPitchBend = bendVal;
          }
      }

      // Note Logic (State Machine)
      const noteChanged = note !== activeNote;
      const gateChanged = gate !== lastGate;

      if (!gateChanged && !noteChanged) {
          currentTick = eventTick;
          continue; 
      }

      if (gate && !lastGate) {
        // Attack
        if (note >= 0 && note <= 127) {
          writeVLQ(Math.max(0, eventTick - lastEventTick), trackBytes);
          trackBytes.push(0x90 | midiCh, note, velocity);
          
          // Reset Pitch Bend on new attack
          if (lastPitchBend !== 8192) {
              writeVLQ(0, trackBytes);
              trackBytes.push(0xE0 | midiCh, 0x00, 0x40);
              lastPitchBend = 8192;
          }
          
          lastEventTick = eventTick;
          activeNote = note;
        }
      } else if (!gate && lastGate) {
        // Release
        if (activeNote !== -1) {
          writeVLQ(Math.max(0, eventTick - lastEventTick), trackBytes);
          trackBytes.push(0x80 | midiCh, activeNote, 0);
          lastEventTick = eventTick;
          activeNote = -1;
        }
      } else if (gate && lastGate) {
        // Legato / Slide (New note without gate re-trigger)
        if (note >= 0 && note <= 127 && note !== activeNote && activeNote !== -1) {
           // Note Off Old
           writeVLQ(Math.max(0, eventTick - lastEventTick), trackBytes);
           trackBytes.push(0x80 | midiCh, activeNote, 0); 
           
           // Note On New (Delta 0)
           writeVLQ(0, trackBytes); 
           trackBytes.push(0x90 | midiCh, note, velocity); 
           
           // Reset Bend
           writeVLQ(0, trackBytes);
           trackBytes.push(0xE0 | midiCh, 0x00, 0x40);
           lastPitchBend = 8192;

           lastEventTick = eventTick;
           activeNote = note;
        }
      }

      lastGate = gate;
      currentTick = eventTick;
    }

    // Cleanup: Force release any hanging note at end of track
    if (activeNote !== -1) {
        const deltaTime = currentTick - lastEventTick;
        writeVLQ(Math.max(0, deltaTime), trackBytes);
        trackBytes.push(0x80 | midiCh, activeNote, 0);
        lastEventTick = currentTick;
    }

    // End of Track Meta Event
    writeVLQ(0, trackBytes);
    trackBytes.push(0xFF, 0x2F, 0x00);
    
    // Only include track if it has substantial data
    if (trackBytes.length > 40) {
        tracks.push(trackBytes);
    }
  }

  // --- Construct Final MIDI File ---
  const fileBytes: number[] = [];
  
  // Header Chunk
  writeString("MThd", fileBytes);
  writeUint32(6, fileBytes);
  writeUint16(1, fileBytes); // Type 1 (Multiple Tracks)
  writeUint16(tracks.length, fileBytes);
  writeUint16(ppq, fileBytes);

  // Track Chunks
  tracks.forEach(track => {
    writeString("MTrk", fileBytes);
    writeUint32(track.length, fileBytes);
    fileBytes.push(...track);
  });

  return new Uint8Array(fileBytes);
};
