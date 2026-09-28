import type { ParsedTrace, SidEvent } from '../types';

export type NoteDuration = 'smart' | 'raw' | '1/4' | '1/8' | '1/16' | '1/32';

export interface MidiExportOptions {
  bpm: number;
  ppq: number;
  duration: NoteDuration;
  channels: [boolean, boolean, boolean];
  /** For multi-chip adapters; skips MIDI percussion channel 10. */
  voiceOffset?: number;
  /** Actual sample times for irregular frame captures (seconds). */
  frameTimes?: readonly number[];
  endTimeSeconds?: number;
}

const BEND_RANGE = 2;
const MAX_VLQ = 0x0FFFFFFF;

function writeVLQ(value: number, bytes: number[]) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_VLQ) {
    throw new Error('MIDI event time is outside the four-byte VLQ range');
  }
  const encoded = [value & 127];
  while (value >= 128) {
    value = Math.floor(value / 128);
    encoded.push((value & 127) | 128);
  }
  for (let i = encoded.length - 1; i >= 0; i--) bytes.push(encoded[i]);
}

function chunk(id: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(8 + data.length);
  result.set(new TextEncoder().encode(id));
  new DataView(result.buffer).setUint32(4, data.length);
  result.set(data, 8);
  return result;
}

/**
 * Exports SID gate lengths and oscillator pitch. Cycle writes are authoritative
 * when present; otherwise frame snapshots are sampled at header.fps.
 * Noise and combined-noise waveforms have no unique tonal MIDI pitch.
 */
export function generateMidiFile(trace: ParsedTrace, options: MidiExportOptions): Uint8Array {
  if (!trace || !Array.isArray(trace.frames) || trace.frames.length === 0) {
    throw new Error('MIDI export requires at least one trace frame');
  }
  if (!options || !Number.isFinite(options.bpm) || options.bpm < 20 || options.bpm > 400) {
    throw new Error('MIDI export BPM must be between 20 and 400');
  }
  if (!Number.isInteger(options.ppq) || options.ppq < 1 || options.ppq > 32767) {
    throw new Error('MIDI export PPQ must be an integer between 1 and 32767');
  }
  if (!Array.isArray(options.channels) || options.channels.length !== 3
      || options.channels.some(value => typeof value !== 'boolean') || !options.channels.some(Boolean)) {
    throw new Error('Select at least one of the three SID voices for MIDI export');
  }
  if (!['raw', 'smart', '1/4', '1/8', '1/16', '1/32'].includes(options.duration)) {
    throw new Error('Unsupported MIDI quantization grid');
  }
  const clock = trace.header?.clock ?? 985248;
  const fps = trace.header?.fps ?? (clock >= 1_000_000 ? 60 : 50);
  if (!Number.isFinite(clock) || clock <= 0 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error('MIDI export requires a positive clock and frame rate');
  }
  for (const [index, frame] of trace.frames.entries()) {
    if ((!Array.isArray(frame) && !(frame instanceof Uint8Array)) || frame.length < 25 || frame.length > 32
        || Array.from(frame).some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error(`Invalid SID register frame ${index + 1}`);
    }
  }
  const events: SidEvent[] = trace.events ?? [];
  if (!Array.isArray(events) || events.some(event => !event
      || !Number.isSafeInteger(event.cycles) || event.cycles < 0
      || !Number.isInteger(event.reg) || event.reg < 0 || event.reg > 31
      || !Number.isInteger(event.val) || event.val < 0 || event.val > 255)) {
    throw new Error('Invalid SID cycle event');
  }
  // Sort a copy: never mutate the playback source. Stable ordering preserves
  // same-cycle gate retriggers.
  const ordered = [...events].sort((a, b) => a.cycles - b.cycles);
  const voiceOffset = options.voiceOffset ?? 0;
  if (!Number.isInteger(voiceOffset) || voiceOffset < 0 || voiceOffset > 12) {
    throw new Error('MIDI export supports at most five SID chips (15 melodic channels)');
  }
  const times = options.frameTimes;
  if (times && (times.length !== trace.frames.length || times.some((time, index) =>
      !Number.isFinite(time) || time < 0 || (index > 0 && time < times[index - 1])))) {
    throw new Error('Invalid SID frame timestamps');
  }
  const tempo = Math.round(60_000_000 / options.bpm);
  // Use the tempo actually encoded in SMF, avoiding fractional-BPM drift.
  const ticksPerSecond = options.ppq * 1_000_000 / tempo;
  const grid = options.duration === 'raw' ? 0 : options.duration === 'smart'
    ? options.ppq / 4 : options.ppq * 4 / Number(options.duration.slice(2));
  const tickAt = (seconds: number) => {
    const raw = seconds * ticksPerSecond;
    let result = raw;
    if (grid > 0) {
      const nearest = Math.round(raw / grid) * grid;
      if (options.duration !== 'smart' || Math.abs(raw - nearest) <= grid * 0.2) result = nearest;
    }
    const tick = Math.round(result);
    if (!Number.isSafeInteger(tick) || tick < 0 || tick > MAX_VLQ) {
      throw new Error('MIDI export timeline exceeds the supported tick range');
    }
    return tick;
  };
  const lastSampleTime = times?.at(-1) ?? (trace.frames.length - 1) / fps;
  const naturalEnd = times ? lastSampleTime + 1 / fps : trace.frames.length / fps;
  const lastEventTime = (ordered.at(-1)?.cycles ?? 0) / clock;
  if (options.endTimeSeconds !== undefined && (!Number.isFinite(options.endTimeSeconds)
      || options.endTimeSeconds < Math.max(lastSampleTime, lastEventTime))) {
    throw new Error('SID duration precedes the final sample or register write');
  }
  const endSeconds = options.endTimeSeconds ?? Math.max(naturalEnd, lastEventTime);
  const endTick = tickAt(endSeconds);
  const tracks: Uint8Array[] = [];

  for (let voice = 0; voice < 3; voice++) {
    if (!options.channels[voice]) continue;
    const ordinal = voiceOffset + voice;
    const channel = ordinal < 9 ? ordinal : ordinal + 1;
    const bytes: number[] = [];
    let lastTick = 0;
    let activeNote = -1;
    let lastBend = -1;
    const controllers = new Map<number, number>();
    const emit = (tick: number, ...data: number[]) => {
      if (tick < lastTick) throw new Error('MIDI event ordering is invalid');
      writeVLQ(tick - lastTick, bytes);
      for (const byte of data) bytes.push(byte);
      lastTick = tick;
    };
    const cc = (tick: number, controller: number, value: number) => {
      if (controllers.get(controller) === value) return;
      emit(tick, 0xB0 | channel, controller, value);
      controllers.set(controller, value);
    };
    const name = new TextEncoder().encode(`SID ${Math.floor(voiceOffset / 3) + 1} Voice ${voice + 1}`);
    emit(0, 0xFF, 0x03);
    writeVLQ(name.length, bytes);
    for (const byte of name) bytes.push(byte);
    if (tracks.length === 0 && voiceOffset === 0) {
      for (const value of [trace.header?.song, trace.header?.author]) {
        if (typeof value !== 'string' || !value.length) continue;
        const text = new TextEncoder().encode(value);
        emit(0, 0xFF, 0x01);
        writeVLQ(text.length, bytes);
        for (const byte of text) bytes.push(byte);
      }
    }
    if (tracks.length === 0 && voiceOffset === 0) emit(0, 0xFF, 0x51, 3, (tempo >>> 16) & 255, (tempo >>> 8) & 255, tempo & 255);
    const stop = (tick: number) => {
      if (activeNote < 0) return;
      emit(tick, 0x80 | channel, activeNote, 0);
      activeNote = -1;
    };
    const offset = voice * 7;
    const pitchAt = (regs: ArrayLike<number>) => {
      const ctrl = regs[offset + 4];
      const frequency = (regs[offset] | (regs[offset + 1] << 8)) * clock / 16777216;
      const voice3Off = voice === 2 && (regs[24] & 0x80) && !(regs[23] & 4);
      if (!(ctrl & 1) || (ctrl & 8) || !(ctrl & 0x70) || (ctrl & 0x80) || voice3Off || frequency <= 0) return null;
      return 69 + 12 * Math.log2(frequency / 440);
    };
    // Both passes use identical boundaries. Batch simultaneous split-byte
    // pitch writes, but flush a pending gate-on before every falling edge.
    // This preserves multiple off/on pulses even within a single cycle.
    const visit = (sample: (regs: ArrayLike<number>, seconds: number) => void,
                   gateOff: (seconds: number) => void) => {
      if (ordered.length > 0) {
        const regs = new Uint8Array(32);
        for (let i = 0; i < ordered.length;) {
          const cycle = ordered[i].cycles;
          const seconds = cycle / clock;
          while (i < ordered.length && ordered[i].cycles === cycle) {
            const event = ordered[i++];
            if (event.reg === offset + 4 && (regs[event.reg] & 1) && !(event.val & 1)) {
              sample(regs, seconds);
              gateOff(seconds);
            }
            regs[event.reg] = event.val;
          }
          sample(regs, seconds);
        }
      } else {
        for (let f = 0; f < trace.frames.length; f++) sample(trace.frames[f], times?.[f] ?? f / fps);
      }
    };
    // Plan each complete gate before encoding: wide slides/arpeggios stay one
    // held note instead of adding false attacks whenever a ±2 bend clips.
    const plans: { first: number; min: number; max: number; note: number; range: number }[] = [];
    let plan: typeof plans[number] | undefined;
    visit(regs => {
      const pitch = pitchAt(regs);
      if (pitch === null) { plan = undefined; return; }
      if (!plan) {
        plan = { first: pitch, min: pitch, max: pitch, note: 0, range: BEND_RANGE };
        plans.push(plan);
      }
      plan.min = Math.min(plan.min, pitch);
      plan.max = Math.max(plan.max, pitch);
    }, () => { plan = undefined; });
    const requiredRange = (p: typeof plans[number]) => Math.max(BEND_RANGE,
      Math.ceil(p.note - p.min), Math.ceil((p.max - p.note) * 8192 / 8191));
    for (const p of plans) {
      p.note = Math.max(0, Math.min(127, Math.round(p.first)));
      if (requiredRange(p) > 127) p.note = Math.max(0, Math.min(127, Math.round((p.min + p.max) / 2)));
      p.range = requiredRange(p);
      if (p.range > 127) throw new Error('SID pitch exceeds MIDI note and bend range');
    }
    let planIndex = 0;
    let bendRange = -1;
    const setRange = (tick: number, range: number) => {
      if (bendRange === range) return;
      for (const [controller, value] of [[101, 0], [100, 0], [6, range], [38, 0], [101, 127], [100, 127]]) {
        emit(tick, 0xB0 | channel, controller, value);
      }
      bendRange = range;
    };
    setRange(0, plans[0]?.range ?? BEND_RANGE);
    // Export must not inherit a previous song's held pedal/expression state.
    cc(0, 64, 0);
    cc(0, 11, 127);
    const sample = (regs: ArrayLike<number>, tick: number) => {
      const midiPitch = pitchAt(regs);
      const cutoff = (regs[21] & 7) | (regs[22] << 3);
      cc(tick, 74, Math.round(cutoff * 127 / 2047));
      cc(tick, 71, Math.round(((regs[23] >>> 4) & 15) * 127 / 15));
      cc(tick, 70, Math.round((regs[offset + 2] | ((regs[offset + 3] & 15) << 8)) * 127 / 4095));
      cc(tick, 7, Math.round((regs[24] & 15) * 127 / 15));
      if (midiPitch === null) { stop(tick); return; }
      const starting = activeNote < 0;
      const nextPlan = starting ? plans[planIndex++] : undefined;
      if (nextPlan) setRange(tick, nextPlan.range);
      const note = nextPlan?.note ?? activeNote;
      const bend = Math.max(0, Math.min(16383, Math.round(8192 + (midiPitch - note) * 8192 / bendRange)));
      if (starting || bend !== lastBend) {
        emit(tick, 0xE0 | channel, bend & 127, bend >>> 7);
        lastBend = bend;
      }
      if (starting) {
        emit(tick, 0x90 | channel, note, 100);
        activeNote = note;
      }
    };

    visit((regs, seconds) => sample(regs, tickAt(seconds)), seconds => stop(tickAt(seconds)));
    stop(endTick);
    emit(endTick, 0xFF, 0x2F, 0);
    tracks.push(chunk('MTrk', Uint8Array.from(bytes)));
  }
  const header = new Uint8Array([0, 1, 0, tracks.length, options.ppq >>> 8, options.ppq & 255]);
  const chunks = [chunk('MThd', header), ...tracks];
  const result = new Uint8Array(chunks.reduce((length, item) => length + item.length, 0));
  let offset = 0;
  for (const item of chunks) { result.set(item, offset); offset += item.length; }
  return result;
}

/** Combine independently clocked SID sources without sharing melodic channels. */
export function generateMultiSidMidiFile(sources: { trace: ParsedTrace; frameTimes?: readonly number[]; endTimeSeconds?: number }[], options: MidiExportOptions): Uint8Array {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 5) throw new Error('Expected one to five SID chips');
  const files = sources.map((source, index) => generateMidiFile(source.trace, {
    ...options, frameTimes: source.frameTimes, endTimeSeconds: source.endTimeSeconds, voiceOffset: index * 3
  }));
  const result = new Uint8Array(14 + files.reduce((size, file) => size + file.length - 14, 0));
  result.set(files[0].subarray(0, 14));
  new DataView(result.buffer).setUint16(10, sources.length * options.channels.filter(Boolean).length);
  let offset = 14;
  for (const file of files) { result.set(file.subarray(14), offset); offset += file.length - 14; }
  return result;
}
