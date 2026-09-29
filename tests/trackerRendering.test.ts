import assert from 'node:assert/strict';
import test from 'node:test';
import { validateProject, renderProjectToTrace } from '../services/projectLoaderService';
import { traceToTrackerProject } from '../services/trackerService';
import { generateSwmFile } from '../services/swmExportService';
import { midiNoteToFreq, getNoteName, CLOCK_PAL } from '../services/sidService';
import { deleteSequenceStep, insertSequenceStep, setSequenceLoopPoint, updatePatternCell, updatePatternCellHex, transposePattern } from '../services/editorService';
import type { TrackerRow } from '../types';

const cell = (changes: Partial<TrackerRow> = {}): TrackerRow => ({ note: '---', inst: 0, cmd: '...', val: '..', vol: '..', ...changes });
const project = (rows: TrackerRow[][]) => validateProject({ frameSpeed: 1, patterns: [{ id: 0, rows }] });
const pitch = (frame: ArrayLike<number>, voice = 0) => frame[voice * 7] | frame[voice * 7 + 1] << 8;

test('tracker note names render at the same pitch used by preview and transcription', () => {
    for (const midi of [12, 48, 60, 69, 84, 95]) {
        const freq = midiNoteToFreq(midi, CLOCK_PAL);
        const rendered = renderProjectToTrace(project([[cell({ note: getNoteName(freq, CLOCK_PAL), inst: 1 })]]), CLOCK_PAL);
        assert.equal(pitch(rendered.frames[0]), freq);
    }
});

test('waveform bytes, pulse width, routing and filter mode survive tracker rendering', () => {
    const p = project([
        [cell({ note: 'A-5', inst: 1, cmd: 'W', val: '40' }), cell({ cmd: 'R', val: 'B5' }), cell({ cmd: 'T', val: '9C' })],
        [cell({ cmd: 'E', val: 'AB' }), cell({ cmd: 'F', val: '81' })],
        [cell({ note: 'C-5', inst: 1 })],
        [cell({ note: '===' })],
    ]);
    const { frames, events } = renderProjectToTrace(p, CLOCK_PAL);
    assert.equal(frames[0][4], 0x41);
    assert.equal(frames[0][23], 0xB5);
    assert.equal(frames[0][24], 0x9C);
    assert.equal(frames[1][2] | frames[1][3] << 8, 0xAB0);
    assert.equal(frames[1][21] | frames[1][22] << 3, 0x408);
    assert.equal(frames[2][4], 0x11, 'new instrument clears waveform override');
    assert.equal(frames[3][4] & 1, 0);
    assert.ok(events.every((event, index) => index === 0 || event.cycles >= events[index - 1].cycles));
    const retrigger = events.filter(e => e.reg === 4 && e.cycles < Math.floor(CLOCK_PAL / 50));
    assert.deepEqual(retrigger.map(e => [e.cycles, e.val]), [[0, 0x40], [45, 0x41]]);
});

test('slides work without a new note, stop on blank rows, and initial portamento still opens a gate', () => {
    const p = project([[cell({ note: 'A-5', inst: 1, cmd: '3', val: '04' })],
        [cell({ cmd: '1', val: '10' })], [cell()], [cell({ cmd: '2', val: '08' })]]);
    const { frames } = renderProjectToTrace(p, CLOCK_PAL);
    assert.equal(frames[0][4] & 1, 1);
    assert.equal(pitch(frames[1]), pitch(frames[0]) + 32);
    assert.equal(pitch(frames[2]), pitch(frames[1]));
    assert.equal(pitch(frames[3]), pitch(frames[2]) - 16);
});

test('transcription includes initial shared filters and volume-only changes', async () => {
    const source = renderProjectToTrace(project([[cell({ note: 'A-5', inst: 1 })]]), CLOCK_PAL);
    source.frames.forEach((f, index) => { f[21] = 0; f[22] = 0x42; f[23] = 0xA7; f[24] = index ? 0x18 : 0x1F; });
    const result = renderProjectToTrace(await traceToTrackerProject(source), CLOCK_PAL);
    assert.deepEqual(Array.from(result.frames[0].slice(21)), [0, 0x42, 0xA7, 0x1F]);
    assert.equal(result.frames[1][24], 0x18);
});

test('project validation rejects malformed cells and instruments instead of crashing playback', () => {
    for (const instruments of [[null], [{ id: 1, attack: -1 }], [{ id: 1, attack: NaN }]]) {
        assert.throws(() => validateProject({ instruments }));
    }
    for (const rows of [[null], [[null]], [[cell(), cell(), cell(), cell()]], [[cell({ note: 'oops' })]]]) {
        assert.throws(() => validateProject({ patterns: [{ id: 0, rows }] }));
    }
    assert.throws(() => validateProject({ patterns: [{ id: 0, rows: [] }, { id: 0, rows: [] }] }), /duplicate/);
    assert.throws(() => validateProject({ subtunes: [{ id: 0, orderList: [0], loopPosition: -1 }] }), /loop/);
    assert.throws(() => validateProject({ patterns: {} }), /array/);
});

test('validation pads short patterns without mutating the input or sharing mutable cells', () => {
    const input = { instruments: [], subtunes: [], patterns: [{ id: 0, rows: [[cell()]] }] };
    const result = validateProject(input);
    assert.equal(input.instruments.length, 0);
    assert.equal(input.subtunes.length, 0);
    assert.equal(input.patterns[0].rows.length, 1);
    assert.equal(result.patterns[0].rows.length, 64);
    assert.equal(result.patterns[0].rows[0].length, 3);
    result.patterns[0].rows[0][0].note = 'A-5';
    assert.equal(input.patterns[0].rows[0][0].note, '---');
});

test('rendering rejects excessive allocation and impossible cycle timing', () => {
    const p = project([]);
    p.subtunes[0].orderList = Array(1563).fill(0);
    assert.throws(() => renderProjectToTrace(p, CLOCK_PAL), /limits/);
    p.subtunes[0].orderList = [0];
    p.frameRate = CLOCK_PAL * 2;
    assert.throws(() => renderProjectToTrace(p, CLOCK_PAL), /limits/);
    p.frameRate = CLOCK_PAL;
    p.patterns[0].rows[0][0] = cell({ note: 'A-5', inst: 1 });
    const result = renderProjectToTrace(p, CLOCK_PAL);
    assert.ok(result.events.every(event => event.cycles < result.frames.length));
});

test('sequence insert/delete preserves the loop target and rejects invalid indices', () => {
    const p = project([]);
    p.subtunes[0] = { id: 0, tempo: 6, orderList: [0, 1, 2], loopPosition: 2 };
    const inserted = insertSequenceStep(p, 0);
    assert.equal(inserted.subtunes[0].loopPosition, 3);
    const deleted = deleteSequenceStep(p, 0);
    assert.equal(deleted.subtunes[0].loopPosition, 1);
    assert.deepEqual(p.subtunes[0].orderList, [0, 1, 2]);
    for (const index of [-1, NaN, 1.5, 99]) {
        assert.strictEqual(insertSequenceStep(p, index), p);
        assert.strictEqual(deleteSequenceStep(p, index), p);
    }
    assert.strictEqual(setSequenceLoopPoint(p, NaN), p);
    assert.strictEqual(updatePatternCell(p, 0, 0, 3, { note: 'A-5' }), p);
    assert.strictEqual(updatePatternCellHex(p, 0, 0, 0, 1, 'X'), p);
    assert.strictEqual(transposePattern(p, 0, 0, 0.5, true), p);
});

test('SWM exports the separate tracker effect parameter instead of zero', () => {
    const bytes = generateSwmFile(project([[cell({ note: 'A-5', inst: 1, cmd: 'W', val: '40' })]]));
    let offset = 104; // header and author, followed by three length-prefixed sequences
    for (let voice = 0; voice < 3; voice++) offset += 1 + bytes[offset];
    assert.deepEqual(Array.from(bytes.slice(offset + 2, offset + 6)), [0xC6, 0x81, 0x04, 0x40]);
});
