import type { ParsedTrace } from '../types';
import { generateMultiSidMidiFile, type MidiExportOptions as CoreOptions } from './midiExportService';

export type { NoteDuration } from './midiExportService';
export type MidiExportOptions = Omit<CoreOptions, 'channels'> & { channels?: [boolean, boolean, boolean] };

/** Compatibility entry point. Packed multi-SID input uses explicit 32-byte
 * register blocks; filter/readback bytes must never be counted as voices. */
export function generateMidiFile(trace: ParsedTrace, options: MidiExportOptions): Uint8Array {
  const width = trace?.frames?.[0]?.length ?? 0;
  const chips = width <= 32 ? 1 : width / 32;
  if (!Number.isInteger(chips) || chips < 1 || chips > 5
      || !trace?.frames?.length || trace.frames.some(frame => frame.length !== width)) {
    throw new Error('Expected uniform SID frames (25–32 bytes, or complete 32-byte chip blocks)');
  }
  if (!Array.isArray(trace.events) || trace.events.some(event => !event || !Number.isInteger(event.reg)
      || event.reg < 0 || event.reg >= chips * 32)) throw new Error('Invalid packed SID register event');
  return generateMultiSidMidiFile(Array.from({ length: chips }, (_, chip) => ({
    trace: {
      header: trace.header,
      frames: trace.frames.map(frame => frame.slice(chip * 32, chip * 32 + 32)),
      events: trace.events.filter(event => Math.floor(event.reg / 32) === chip)
        .map(event => ({ ...event, reg: event.reg % 32 }))
    }
  })), { ...options, channels: options.channels ?? [true, true, true] });
}
