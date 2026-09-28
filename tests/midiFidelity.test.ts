import assert from 'node:assert/strict';
import test from 'node:test';
import { generateMidiFile, generateMultiSidMidiFile } from '../services/midiExportService';
import { generateMidiFile as compatibilityExport } from '../services/midiService';
import { JsonToMidiConverter } from '../components/sid/JsonToMidi';
import { parseTraceFile } from '../services/sidService';
import { frame, trace, read, messages, options, ons, offs } from './midiExport.test';
import type { SidDump } from '../components/sid/SidTypes';

test('multiple complete gate pulses within the same SID cycle are retained in source order', () => {
  const r = frame();
  const source = trace([r]);
  source.events = r.map((val, reg) => ({ cycles: 0, reg, val }));
  source.events.push(...[0x40, 0x41, 0x40, 0x41, 0x40].map(val => ({ cycles: 0, reg: 4, val })));
  const m = messages(source);
  assert.equal(ons(m).length, 3);
  assert.equal(offs(m).length, 3);
  assert.deepEqual(m.filter(e => [0x90, 0x80].includes(e.status)).map(e => e.status), [0x90, 0x80, 0x90, 0x80, 0x90, 0x80]);
});

test('long UTF-8 credits have valid meta lengths and pedal state is initialized before notes', () => {
  const song = 'Å SID 🎵 '.repeat(40);
  const m = messages(trace([frame()], { song, author: 'Ulf Bertilsson' }));
  const texts = m.filter(e => e.meta === 1).map(e => new TextDecoder().decode(Uint8Array.from(e.data)));
  assert.deepEqual(texts, [song, 'Ulf Bertilsson']);
  const firstNote = m.findIndex(e => e.status === 0x90);
  assert.ok(m.slice(0, firstNote).some(e => e.status === 0xB0 && e.data[0] === 64 && e.data[1] === 0));
  assert.ok(m.slice(0, firstNote).some(e => e.status === 0xB0 && e.data[0] === 11 && e.data[1] === 127));
});

test('pitch reconstruction covers the entire 16-bit SID frequency range without false attacks', () => {
  for (const clock of [985248, 1022727]) {
    const values = [1, 2, 7, 31, 255, 1024, 8192, 16384, 65535, 1];
    const frames = values.map(reg => { const r = frame(); r[0] = reg & 255; r[1] = reg >>> 8; return r; });
    const m = messages(trace(frames, { clock }), { ppq: 9600 });
    assert.equal(ons(m).length, 1);
    const range = m.find(e => e.status === 0xB0 && e.data[0] === 6)!.data[1];
    const bends = m.filter(e => e.status === 0xE0);
    assert.equal(bends.length, values.length);
    for (let i = 0; i < values.length; i++) {
      const pitch = ons(m)[0].data[0] + ((bends[i].data[0] + bends[i].data[1] * 128) - 8192) * range / 8192;
      const expected = 69 + 12 * Math.log2(values[i] * clock / 16777216 / 440);
      assert.ok(Math.abs(pitch - expected) <= range / 16384 + 1e-10);
    }
  }
});

test('irregular frame timestamps and explicit capture endpoints preserve note lengths', () => {
  const m = messages(trace([frame(), frame(69, false), frame(72)]), {
    frameTimes: [0.125, 0.234, 0.789], endTimeSeconds: 1.123, ppq: 9600
  });
  assert.deepEqual(ons(m).map(e => e.tick), [2400, 15149]);
  assert.deepEqual(offs(m).map(e => e.tick), [4493, 21562]);
  assert.throws(() => messages(trace([frame(), frame()]), { frameTimes: [0.1, 0.05] }));
  assert.throws(() => messages(trace([frame()]), { frameTimes: [2], endTimeSeconds: 1 }));
});

test('five SID chips receive independent channels, skipping GM drums, with only one tempo', () => {
  const r = frame();
  for (let v = 1; v < 3; v++) for (let reg = 0; reg < 7; reg++) r[v * 7 + reg] = r[reg];
  const tracks = read(generateMultiSidMidiFile(Array.from({ length: 5 }, () => ({ trace: trace([r]) })), {
    ...options, channels: [true, true, true]
  }));
  assert.equal(tracks.length, 15);
  assert.deepEqual(tracks.map(track => ons(track)[0].status & 15), [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);
  assert.equal(tracks.flat().filter(e => e.meta === 0x51).length, 1);
});

test('legacy packed exporter counts three voices per SID block and delegates to the same core', () => {
  const r = [...frame(), ...Array(7).fill(0)];
  assert.equal(read(compatibilityExport(trace([r]), options)).length, 1);
  const all = { bpm: 120, ppq: 480, duration: 'raw' as const };
  assert.equal(read(compatibilityExport(trace([r]), all)).length, 3);
  assert.equal(read(compatibilityExport(trace([[...r, ...r]]), all)).length, 6);
  assert.deepEqual(compatibilityExport(trace([r]), options), generateMidiFile(trace([r]), options));
  assert.throws(() => compatibilityExport(trace([[...r, 1]]), all));
});

function dump(regs: number[][]): SidDump {
  return {
    metadata: { clockFreq: 985248, title: 'test', author: 'test', sidCount: 1 },
    frames: regs.map((registers, i) => ({ frame: i, time: i / 50, cycles: Math.floor((i + 1) * 985248 / 50),
      chips: [{ registers }] })),
    writeLog: [], totalDuration: regs.length / 50, detectedRefreshRate: 50
  } as unknown as SidDump;
}

test('SidDump default conversion preserves single-frame notes and does not merge repeated gates', () => {
  const m = read(new JsonToMidiConverter().convert(dump([frame(), frame(69, false), frame(), frame(69, false)])))[0];
  assert.deepEqual(ons(m).map(e => e.tick), [0, 768]);
  assert.deepEqual(offs(m).map(e => e.tick), [384, 1152]);
  assert.throws(() => new JsonToMidiConverter().convert(dump([frame()]), { mergeGaps: true }), /interpretive/);
});

test('SidDump writeLog takes precedence over snapshots and keeps its absolute cycle timing', () => {
  const d = dump([frame(50)]);
  d.writeLog = frame(69).map((val, reg) => ({ cycles: 100, chipIdx: 0, reg, val }));
  d.writeLog.push({ cycles: 5000, chipIdx: 0, reg: 4, val: 0x40 });
  const m = read(new JsonToMidiConverter().convert(d))[0];
  assert.equal(ons(m)[0].data[0], 69);
  assert.equal(ons(m)[0].tick, Math.round(100 / 985248 * 19200));
  assert.equal(offs(m)[0].tick, Math.round(5000 / 985248 * 19200));
});

test('frame-only NTSC import uses rational timestamps without cumulative rounding drift', async () => {
  const data = JSON.stringify({ header: { clock: 1022727 }, frames: Array.from({ length: 601 }, (_, i) => frame(60, i < 600, 1022727)) });
  const t = parseTraceFile(data)!;
  assert.ok(t.events.some(e => e.reg === 4 && e.val === 0x40 && e.cycles === 10227270));
});
