import assert from 'node:assert/strict';
import test from 'node:test';
import { generateMidiFile } from '../services/midiExportService.ts';
import type { ParsedTrace } from '../types.ts';

export type Message = { tick: number; status: number; data: number[]; meta?: number };

// Independent SMF reader: verifies chunk boundaries, four-byte delta encoding,
// seven-bit channel data and end-of-track placement as well as musical output.
export function read(bytes: Uint8Array): Message[][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const str = (n: number) => String.fromCharCode(...bytes.slice(p, p += n));
  const u32 = () => { const n = view.getUint32(p); p += 4; return n; };
  assert.equal(str(4), 'MThd');
  assert.equal(u32(), 6);
  assert.equal(view.getUint16(p), 1);
  const count = view.getUint16(p + 2);
  p += 6;
  const tracks: Message[][] = [];
  for (let track = 0; track < count; track++) {
    assert.equal(str(4), 'MTrk');
    const length = u32();
    const end = p + length;
    assert.ok(end <= bytes.length);
    const vlq = () => {
      let value = 0;
      for (let i = 0; i < 4; i++) {
        assert.ok(p < end);
        const byte = bytes[p++];
        value = value * 128 + (byte & 127);
        if (byte < 128) return value;
      }
      throw new Error('VLQ longer than four bytes');
    };
    let tick = 0;
    const messages: Message[] = [];
    while (p < end) {
      tick += vlq();
      const status = bytes[p++];
      assert.ok(status >= 128);
      if (status === 255) {
        const meta = bytes[p++];
        const size = vlq();
        assert.ok(p + size <= end);
        messages.push({ tick, status, meta, data: Array.from(bytes.slice(p, p + size)) });
        p += size;
      } else {
        const size = (status & 0xF0) === 0xC0 || (status & 0xF0) === 0xD0 ? 1 : 2;
        const data = Array.from(bytes.slice(p, p + size));
        assert.equal(data.length, size);
        assert.ok(data.every(byte => byte < 128));
        p += size;
        messages.push({ tick, status, data });
      }
    }
    assert.equal(p, end);
    assert.equal(messages.at(-1)?.meta, 0x2F);
    tracks.push(messages);
  }
  assert.equal(p, bytes.length);
  return tracks;
}

export function frame(note = 69, gate = true, clock = 985248) {
  const r = Array(25).fill(0);
  const frequency = Math.round(440 * 2 ** ((note - 69) / 12) * 16777216 / clock);
  r[0] = frequency & 255; r[1] = frequency >>> 8;
  r[4] = gate ? 0x41 : 0x40; r[6] = 0xA4; r[24] = 15;
  return r;
}
export function trace(frames: number[][], header = {}): ParsedTrace {
  return { header: { clock: 985248, ...header }, frames, events: [] };
}
export const options = { bpm: 120, ppq: 480, duration: 'raw' as const, channels: [true, false, false] as [boolean, boolean, boolean] };
export const messages = (source: ParsedTrace, overrides = {}) => read(generateMidiFile(source, { ...options, ...overrides }))[0];
export const ons = (m: Message[]) => m.filter(e => (e.status & 0xF0) === 0x90);
export const offs = (m: Message[]) => m.filter(e => (e.status & 0xF0) === 0x80);

test('a static held note ends after the final frame, not the last controller event', () => {
  const m = messages(trace(Array.from({ length: 100 }, () => frame())));
  assert.equal(ons(m).length, 1);
  assert.equal(ons(m)[0].tick, 0);
  assert.equal(offs(m)[0].tick, 1920);
  assert.equal(m.at(-1)?.tick, 1920);
});

test('honors declared frame rate, NTSC clock and fractional tempo', () => {
  const m = messages(trace(Array.from({ length: 100 }, () => frame(69, true, 1022727)), { clock: 1022727, fps: 100 }), { bpm: 123.456 });
  const tempo = m.find(e => e.meta === 0x51)!.data.reduce((n, byte) => n * 256 + byte, 0);
  assert.equal(offs(m)[0].tick, Math.round(480_000_000 / tempo));
  assert.equal(ons(m)[0].data[0], 69);
});

test('bend sensitivity and initial tuning precede the first note', () => {
  const m = messages(trace([frame(69.25), frame(69.25, false)]));
  assert.deepEqual(m.filter(e => (e.status & 0xF0) === 0xB0).slice(0, 6).map(e => e.data),
    [[101, 0], [100, 0], [6, 2], [38, 0], [101, 127], [100, 127]]);
  const bendIndex = m.findIndex(e => (e.status & 0xF0) === 0xE0);
  assert.ok(bendIndex < m.findIndex(e => (e.status & 0xF0) === 0x90));
  const bend = m[bendIndex].data[0] + m[bendIndex].data[1] * 128;
  assert.ok(Math.abs(bend - 9216) < 8);
});

test('vibrato and octave slides remain one gated note with a declared sufficient bend range', () => {
  const m = messages(trace([69, 69.7, 68.3, 69, 69.6].map(n => frame(n))));
  assert.equal(ons(m).length, 1);
  assert.ok(m.filter(e => (e.status & 0xF0) === 0xE0).length >= 4);
  const slide = messages(trace([frame(60), frame(72)]));
  assert.equal(ons(slide).length, 1);
  const range = slide.find(e => e.status === 0xB0 && e.data[0] === 6)!.data[1];
  const bend = slide.filter(e => e.status === 0xE0).at(-1)!.data;
  const actualPitch = ons(slide)[0].data[0] + ((bend[0] + 128 * bend[1]) - 8192) * range / 8192;
  const r = frame(72);
  const expectedPitch = 69 + 12 * Math.log2((r[0] | r[1] << 8) * 985248 / 16777216 / 440);
  assert.ok(Math.abs(actualPitch - expectedPitch) <= range / 16384);
});

test('low bass, invalid-to-valid pitch, TEST, silence and noise', () => {
  assert.equal(ons(messages(trace([frame(12)])))[0].data[0], 12);
  const zero = frame(); zero[0] = zero[1] = 0;
  assert.equal(ons(messages(trace([zero, frame()])))[0].tick, 19);
  for (const ctrl of [0x09, 0x49, 0x81, 0xC1, 0x01, 0x40]) {
    const r = frame(); r[4] = ctrl;
    assert.equal(ons(messages(trace([r]))).length, 0);
  }
});

test('cutoff decodes the three low bits; initial controller zeroes are emitted', () => {
  const r = frame(); r[21] = 0xFF; r[22] = 0x80;
  const m = messages(trace([r]));
  assert.ok(m.some(e => e.status === 0xB0 && e.data[0] === 74 && e.data[1] === 64));
  assert.ok(m.some(e => e.status === 0xB0 && e.data[0] === 70 && e.data[1] === 0));
  assert.ok(m.some(e => e.status === 0xB0 && e.data[0] === 7 && e.data[1] === 127));
});

test('all quantization grids encode integer ticks even at odd/minimum PPQ', () => {
  for (const ppq of [1, 7, 97, 32767]) {
    for (const duration of ['raw', 'smart', '1/4', '1/8', '1/16', '1/32']) {
      const m = messages(trace(Array.from({ length: 30 }, (_, i) => frame(60, i % 2 === 0))), { ppq, duration });
      assert.ok(m.every(e => Number.isInteger(e.tick)));
      assert.equal(ons(m).length, offs(m).length);
    }
  }
});

test('cycle events preserve short notes and same-cycle retriggers without mutating input', () => {
  const source = trace([frame()]);
  const r = frame();
  source.events = r.map((val, reg) => ({ cycles: 0, reg, val }));
  source.events.push({ cycles: 10000, reg: 4, val: 0x40 }, { cycles: 10000, reg: 4, val: 0x41 },
    { cycles: 15000, reg: 4, val: 0x40 });
  const before = JSON.stringify(source);
  const m = messages(source);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(ons(m).map(e => e.tick), [0, 10]);
  assert.deepEqual(offs(m).map(e => e.tick), [10, 15]);
});

test('selected voices retain their MIDI channels and the first selected track carries tempo', () => {
  const r = frame(); for (let i = 0; i < 7; i++) r[i + 14] = r[i];
  const m = messages(trace([r]), { channels: [false, false, true] });
  assert.equal(ons(m)[0].status, 0x92);
  assert.ok(m.some(e => e.meta === 0x51));
});

test('large exports do not exceed JavaScript function argument limits', () => {
  const output = generateMidiFile(trace(Array.from({ length: 30000 }, (_, i) => frame(60, i % 2 === 0))), options);
  assert.ok(output.length > 128000);
  const m = read(output)[0];
  assert.equal(ons(m).length, 15000);
  assert.equal(offs(m).length, 15000);
});

test('invalid frames, timing, events, selection and options are rejected', () => {
  for (const header of [{ clock: NaN }, { clock: -1 }, { fps: 0 }, { fps: Infinity }]) {
    assert.throws(() => messages(trace([frame()], header)));
  }
  assert.throws(() => messages(trace([[1, 2]])));
  const bad = frame(); bad[0] = 256;
  assert.throws(() => messages(trace([bad])));
  assert.throws(() => messages(trace([frame()]), { channels: [false, false, false, true] }));
  assert.throws(() => messages(trace([frame()]), { duration: 'bogus' }));
  const source = trace([frame()]);
  source.events = [{ cycles: -1, reg: 4, val: 65 }];
  assert.throws(() => messages(source));
  assert.throws(() => messages(trace([frame()], { fps: 0.0000001 })));
});

test('PAL and NTSC tuning sweep stays within half a pitch-bend step', () => {
  for (const clock of [985248, 1022727]) {
    for (let register = 257; register <= 65535; register += 257) {
      const r = frame(); r[0] = register & 255; r[1] = register >>> 8;
      const m = messages(trace([r], { clock }));
      const bend = m.find(e => (e.status & 0xF0) === 0xE0)!.data;
      const exportedPitch = ons(m)[0].data[0] + ((bend[0] + bend[1] * 128) - 8192) / 4096;
      const sidPitch = 69 + 12 * Math.log2(register * clock / 16777216 / 440);
      assert.ok(Math.abs(exportedPitch - sidPitch) <= 1 / 8192 + 1e-10);
    }
  }
});

test('voice 3 OFF suppresses only its unfiltered output', () => {
  const r = frame();
  for (let i = 0; i < 7; i++) r[i + 14] = r[i];
  r[24] = 0x8F;
  assert.equal(ons(messages(trace([r]), { channels: [false, false, true] })).length, 0);
  r[23] = 4; r[24] = 0x9F;
  assert.equal(ons(messages(trace([r]), { channels: [false, false, true] })).length, 1);
});
