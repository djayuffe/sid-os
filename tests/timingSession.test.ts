import assert from 'node:assert/strict';
import test from 'node:test';
import { traceToTrackerProject } from '../services/trackerService';
import { renderProjectToTrace, validateProject } from '../services/projectLoaderService';
import { selectPlaybackTrace, selectMidiExportTrace } from '../services/traceSessionService';
import { generateMidiFile } from '../services/midiExportService';
import { exportProjectToJson } from '../services/jsonExportService';
import { frame, trace, read, options, ons, offs } from './midiExport.test';

test('opening the generated tracker preserves original sub-frame playback and MIDI timing', async () => {
    const clock = 1022727;
    const source = trace([frame(69, true, clock), frame(69, false, clock)], { clock, fps: 60 });
    source.events = Array.from(source.frames[0], (val, reg) => ({ cycles: 123, reg, val }));
    source.events.push({ cycles: 12345, reg: 4, val: 0x40 });
    const project = await traceToTrackerProject(source);
    const session = { trace: source, project };
    assert.equal(project.frameRate, 60);
    assert.strictEqual(selectPlaybackTrace(project, session, clock), source);
    const selected = selectMidiExportTrace(source, project, session, clock, false);
    assert.strictEqual(selected, source);
    const messages = read(generateMidiFile(selected, { ...options, ppq: 9600 }))[0];
    assert.equal(ons(messages)[0].tick, Math.round(123 * 19200 / clock));
    assert.equal(offs(messages)[0].tick, Math.round(12345 * 19200 / clock));
});

for (const fps of [50, 60, 100, 59.826]) {
    test(`edited tracker preserves ${fps} Hz without cumulative rounding drift`, async () => {
        const clock = 1022727;
        const source = trace(Array.from({ length: 128 }, (_, i) => frame(69, i < 63, clock)), { clock, fps });
        const project = await traceToTrackerProject(source);
        const session = { trace: source, project };
        const edited = { ...project, meta: { ...project.meta, title: 'Edited' } };
        const rendered = selectPlaybackTrace(edited, session, clock);
        assert.equal(rendered.header.fps, fps);
        assert.equal(rendered.frames.length, 128);
        assert.ok(rendered.events.some(e => e.reg === 4 && !(e.val & 1) && e.cycles === Math.floor(63 * clock / fps)));
        assert.equal(rendered.events.at(-1)?.cycles, Math.floor(127 * clock / fps));
        assert.strictEqual(selectMidiExportTrace(rendered, edited, session, clock, false), source);
        assert.equal(selectMidiExportTrace(rendered, edited, session, clock, true).header.fps, fps);
    });
}

test('legacy projects default to 50 Hz and invalid rates are rejected', () => {
    assert.equal(validateProject({}).frameRate, 50);
    assert.equal(validateProject({ frameRate: 60 }).frameRate, 60);
    for (const frameRate of [0, -1, NaN, Infinity, '60']) {
        assert.throws(() => validateProject({ frameRate }), /frame rate/);
    }
    assert.throws(() => renderProjectToTrace({ ...validateProject({}), frameRate: 0 }, 985248), /positive/);
});

test('explicit clock changes preserve source cycles and matching snapshot positions', async () => {
    const source = trace([frame()], { fps: 50 });
    const project = await traceToTrackerProject(source);
    const result = selectPlaybackTrace(project, { trace: source, project }, 1022727);
    assert.strictEqual(result.events, source.events);
    assert.ok(Math.abs(result.header.clock! / result.header.fps! - 985248 / 50) < 1e-9);
    assert.equal(source.header.clock, 985248);
    assert.equal(source.header.fps, 50);
});

test('project JSON export and reload retain the frame rate', async () => {
    const originalDocument = globalThis.document;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let saved: Blob | undefined;
    try {
        globalThis.document = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } } as unknown as Document;
        URL.createObjectURL = blob => { saved = blob as Blob; return 'blob:test'; };
        URL.revokeObjectURL = () => {};
        exportProjectToJson(validateProject({ frameRate: 60 }));
        assert.ok(saved);
        assert.equal(validateProject(JSON.parse(await saved.text())).frameRate, 60);
    } finally {
        globalThis.document = originalDocument;
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
    }
});
