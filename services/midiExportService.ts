
import { ParsedTrace } from '../types';
import { CLOCK_PAL, CLOCK_NTSC } from './sidService';

const MIDI_NOTE_A4 = 69;
const FREQ_A4 = 440;

export type NoteDuration = 'smart' | 'raw' | '1/4' | '1/8' | '1/16' | '1/32';

export interface MidiExportOptions {
  bpm: number;
  ppq: number;
  duration: NoteDuration;
  channels: [boolean, boolean, boolean]; 
}

const getSidFreq = (freqReg: number, clockFreq: number) => (freqReg * clockFreq) / 16777216;

const freqToMidiNote = (freqHz: number): number => {
  if (freqHz <= 20) return -1;
  const note = MIDI_NOTE_A4 + 12 * Math.log2(freqHz / FREQ_A4);
  return Math.round(note);
};

const calculatePitchBend = (actualFreq: number, noteFreq: number): number => {
    if (actualFreq <= 0 || noteFreq <= 0) return 8192;
    const semi = 12 * Math.log2(actualFreq / noteFreq);
    let bend = Math.round(8192 + (semi * 4096));
    bend = Math.max(0, Math.min(16383, bend));
    if (Math.abs(bend - 8192) < 40) return 8192;
    return bend;
};

const writeVLQ = (value: number, bytes: number[]) => {
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

const writeUint32 = (val: number, bytes: number[]) => {
  bytes.push((val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF);
};

const writeUint16 = (val: number, bytes: number[]) => {
  bytes.push((val >> 8) & 0xFF, val & 0xFF);
};

const writeString = (str: string, bytes: number[]) => {
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
  }
};

export const generateMidiFile = (trace: ParsedTrace, options: MidiExportOptions): Uint8Array => {
  const { bpm, ppq, duration, channels } = options;
  
  const isNtsc = (trace.header.clock || CLOCK_PAL) >= 1000000;
  const clockFreq = isNtsc ? CLOCK_NTSC : CLOCK_PAL;
  const fps = isNtsc ? 60 : 50;
  const ticksPerSecond = (bpm * ppq) / 60;
  const ticksPerFrame = ticksPerSecond / fps;

  let quantizeTicks = 0;
  
  if (duration === 'smart') {
      // Basic heuristic: scan for common note onset intervals
      // For now, default to 1/16th but align to nearest grid if close
      quantizeTicks = ppq / 4; 
  } else if (duration !== 'raw') {
      switch(duration) {
          case '1/4': quantizeTicks = ppq; break;
          case '1/8': quantizeTicks = ppq / 2; break;
          case '1/16': quantizeTicks = ppq / 4; break;
          case '1/32': quantizeTicks = ppq / 8; break;
      }
  }

  const tracks: number[][] = [];

  for (let v = 0; v < 3; v++) {
    if (!channels[v]) continue;

    const trackBytes: number[] = [];
    let currentTick = 0;
    let lastEventTick = 0;
    
    let activeNote = -1;
    let activeNoteBaseFreq = 0;
    let lastGate = false;
    
    let lastPb = 8192;
    let lastCutoff = -1;
    let lastRes = -1;
    let lastPw = -1;
    let lastVol = -1;
    let lastMode = -1;
    
    writeVLQ(0, trackBytes); 
    trackBytes.push(0xFF, 0x03); 
    const name = `SID Voice ${v + 1}`;
    writeVLQ(name.length, trackBytes);
    writeString(name, trackBytes);
    
    if (tracks.length === 0) { 
        writeVLQ(0, trackBytes);
        trackBytes.push(0xFF, 0x51, 0x03);
        const usPerQuarter = Math.round(60000000 / bpm);
        trackBytes.push((usPerQuarter >> 16) & 0xFF, (usPerQuarter >> 8) & 0xFF, usPerQuarter & 0xFF);
    }

    const regOffset = v * 7;
    let frameTickAccumulator = 0;

    for (let f = 0; f < trace.frames.length; f++) {
      const frame = trace.frames[f];
      if (!frame || frame.length < 25) continue;

      frameTickAccumulator += ticksPerFrame;
      let eventTick = Math.round(frameTickAccumulator);

      // Enhanced "Smart" Logic: Snap to grid only if error is small (< 10%)
      if (quantizeTicks > 0) {
          const nearestGrid = Math.round(eventTick / quantizeTicks) * quantizeTicks;
          if (Math.abs(eventTick - nearestGrid) < (quantizeTicks * 0.2)) {
              eventTick = nearestGrid;
          }
      }
      
      if (eventTick < currentTick) eventTick = currentTick;

      const freqReg = frame[regOffset] | (frame[regOffset + 1] << 8);
      const pwReg = frame[regOffset + 2] | ((frame[regOffset + 3] & 0x0F) << 8);
      const gate = (frame[regOffset + 4] & 0x01) !== 0;
      const cutoffReg = (frame[21] | (frame[22] << 8)) & 0x7FF;

      const exactFreq = getSidFreq(freqReg, clockFreq);
      const note = freqToMidiNote(exactFreq);
      const deltaTime = eventTick - lastEventTick;

      if (gate && !lastGate) {
        if (note >= 21 && note <= 120) {
          writeVLQ(Math.max(0, deltaTime), trackBytes);
          trackBytes.push(0x90 | v, note, 100);
          lastEventTick = eventTick;
          activeNote = note;
          activeNoteBaseFreq = 440 * Math.pow(2, (note - 69) / 12);
          lastPb = 8192; 
          writeVLQ(0, trackBytes);
          trackBytes.push(0xE0 | v, 0x00, 0x40); 
        }
      } else if (!gate && lastGate) {
        if (activeNote !== -1) {
          writeVLQ(Math.max(0, deltaTime), trackBytes);
          trackBytes.push(0x80 | v, activeNote, 0);
          lastEventTick = eventTick;
          activeNote = -1;
        }
      } else if (gate && lastGate) {
        if (note >= 21 && note <= 120 && note !== activeNote && activeNote !== -1) {
            const ratio = exactFreq > activeNoteBaseFreq ? exactFreq / activeNoteBaseFreq : activeNoteBaseFreq / exactFreq;
            if (ratio > 1.03) {
                writeVLQ(Math.max(0, deltaTime), trackBytes);
                trackBytes.push(0x80 | v, activeNote, 0);
                writeVLQ(0, trackBytes);
                trackBytes.push(0x90 | v, note, 100);
                lastEventTick = eventTick;
                activeNote = note;
                activeNoteBaseFreq = 440 * Math.pow(2, (note - 69) / 12);
                writeVLQ(0, trackBytes);
                trackBytes.push(0xE0 | v, 0x00, 0x40);
                lastPb = 8192;
            }
        }
      }

      const checkDelta = () => {
          const dt = eventTick - lastEventTick;
          writeVLQ(Math.max(0, dt), trackBytes);
          lastEventTick = eventTick;
      };

      if (activeNote !== -1 && gate) {
          const pb = calculatePitchBend(exactFreq, activeNoteBaseFreq);
          if (Math.abs(pb - lastPb) >= 64) { 
              checkDelta();
              trackBytes.push(0xE0 | v, pb & 0x7F, (pb >> 7) & 0x7F);
              lastPb = pb;
          }
      }

      const ccCutoff = Math.floor((cutoffReg / 2047.0) * 127);
      if (Math.abs(ccCutoff - lastCutoff) > 2) {
          checkDelta();
          trackBytes.push(0xB0 | v, 74, ccCutoff);
          lastCutoff = ccCutoff;
      }

      const resVal = (frame[23] >> 4) & 0x0F;
      const ccRes = Math.floor((resVal / 15) * 127);
      if (ccRes !== lastRes) {
          checkDelta();
          trackBytes.push(0xB0 | v, 71, ccRes);
          lastRes = ccRes;
      }

      const ccPw = Math.floor((pwReg / 4095) * 127);
      if (Math.abs(ccPw - lastPw) > 2) {
          checkDelta();
          trackBytes.push(0xB0 | v, 70, ccPw);
          lastPw = ccPw;
      }

      lastGate = gate;
      currentTick = eventTick;
    }
    
    if (activeNote !== -1) {
        writeVLQ(0, trackBytes);
        trackBytes.push(0x80 | v, activeNote, 0);
    }

    writeVLQ(Math.max(0, currentTick - lastEventTick), trackBytes);
    trackBytes.push(0xFF, 0x2F, 0x00);
    tracks.push(trackBytes);
  }

  const fileBytes: number[] = [];
  writeString("MThd", fileBytes);
  writeUint32(6, fileBytes);
  writeUint16(1, fileBytes); 
  writeUint16(tracks.length, fileBytes);
  writeUint16(ppq, fileBytes);

  tracks.forEach(track => {
      writeString("MTrk", fileBytes);
      writeUint32(track.length, fileBytes);
      fileBytes.push(...track);
  });
  return new Uint8Array(fileBytes);
};
