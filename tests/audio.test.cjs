// Copyright (c) 2026 Ulf Bertilsson. SPDX-License-Identifier: GPL-3.0-only
// Run: node --test tests/audio.test.cjs (Node 20+).
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Compile the actual application sources; support Vite's raw-source import.
// VM evaluation is confined to this test harness, never used by the application.
const cache = new Map();
function load(relative) {
    const filename = path.resolve(__dirname, '..', relative);
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    cache.set(filename, module.exports);
    const source = fs.readFileSync(filename, 'utf8');
    let output = ts.transpileModule(source, { fileName: filename, compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    }}).outputText;
    if (relative.endsWith('OfflineSidRenderer.ts')) output += '\nexports.internals = { Voice, Filter, HighQualityDownsampler };';
    const localRequire = specifier => {
        if (specifier.endsWith('?raw')) return fs.readFileSync(path.resolve(path.dirname(filename), specifier.slice(0, -4)), 'utf8');
        if (!specifier.startsWith('.')) return require(specifier);
        let target = path.resolve(path.dirname(filename), specifier);
        if (!path.extname(target)) target += '.ts';
        return load(path.relative(path.resolve(__dirname, '..'), target));
    };
    vm.runInThisContext('(function(require,module,exports){' + output + '\n})', { filename })(localRequire, module, module.exports);
    cache.set(filename, module.exports);
    return module.exports;
}
const { generateWorkletCode, SidPlayer } = load('services/sidService.ts');
const { generateHifiWorkletCode } = load('services/hifiSidService.ts');
const { MasteringChain, MASTERING_DSP_CODE } = load('services/masteringDsp.ts');
const { OfflineSidRenderer, internals } = load('services/OfflineSidRenderer.ts');
const { createWavFile, audioBufferToWav } = load('services/audioExportService.ts');
const { compileMidiToSidTrace } = load('services/midiSidService.ts');

const table = base => Array.from({ length: 2048 }, (_, i) => {
    const p = i / 2047 * (base.length - 1), lo = Math.floor(p), hi = Math.min(lo + 1, base.length - 1);
    return base[lo] * (1 - (p - lo)) + base[hi] * (p - lo);
});
const tables = [
    table([220,221,222,225,230,240,260,300,380,500,750,1200,2000,3500,6000,9500,13500,16000]),
    table([0,20,50,100,200,400,800,1600,3200,6400,12800]),
];
function processor(kind, rate = 48000) {
    let Processor;
    const code = (kind === 'STD' ? generateWorkletCode() : generateHifiWorkletCode())
        .replace(/__F6581__/g, JSON.stringify(tables[0])).replace(/__F8580__/g, JSON.stringify(tables[1]));
    vm.runInNewContext(code, {
        sampleRate: rate,
        AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null, postMessage() {} }; } },
        registerProcessor(name, constructor) { Processor = constructor; },
    }, { timeout: 2000 });
    return new Processor();
}
const send = (p, type, payload) => p.port.onmessage({ data: { type, payload } });
const mixer = (pan = 0) => ({ masterVolume: 0.5, voices: Array.from({ length: 3 }, () => ({ volume: 1, pan, muted: false, solo: false })) });
const dry = { output: { gain: 1, enabled: true } };
const note = [
    { cycles: 0, reg: 0, val: 0x44 }, { cycles: 0, reg: 1, val: 0x1d },
    { cycles: 0, reg: 5, val: 0 }, { cycles: 0, reg: 6, val: 0xf0 },
    { cycles: 0, reg: 24, val: 15 }, { cycles: 0, reg: 4, val: 0x21 },
];
function block(p, count = 128) {
    const l = new Float32Array(count), r = new Float32Array(count);
    assert.equal(p.process([], [[l, r]]), true);
    for (const ch of [l, r]) for (const value of ch) assert.ok(Number.isFinite(value));
    return [l, r];
}
const energy = a => a.reduce((sum, x) => sum + x * x, 0);

for (const kind of ['STD','HIFI']) {
    test(kind + ': malformed controls are contained and absolute SID writes work', () => {
        const p=processor(kind), reports=[];
        p.port.postMessage=message=>reports.push(message);
        send(p,'DATA',{events:note,clock:985248});
        const original=p.ev;
        for(const [type,payload] of [['DATA',null],['DATA',{events:[{cycles:-1,reg:0,val:1}]}],
            ['LIVE',{reg:-1,val:20}],['LIVE',{reg:0xd41b,val:255}],['MODEL','bad'],['SEEK',Infinity]]) {
            assert.doesNotThrow(()=>send(p,type,payload));
        }
        assert.equal(reports.filter(r=>r.type==='CONTROL_ERROR').length,6);
        assert.strictEqual(p.ev,original);
        send(p,'MIXER',{});send(p,'MASK',null);send(p,'MASTER',null);
        send(p,'LIVE',{reg:0xd400,val:55});assert.equal(p.regs[0],55);
        assert.equal(p.process([],[]),true);
        send(p,'PLAY',true);block(p);
    });
    test(kind + ': chunked replay matches oscillator/envelope state and includes boundary writes', () => {
        const reference=processor(kind), replay=processor(kind);
        const events=[...note,...note.filter(e=>e.reg<7).map(e=>({...e,reg:e.reg+14})),
            {cycles:3000,reg:18,val:0x14},{cycles:4500,reg:18,val:0x15}];
        send(reference,'DATA',{events,clock:985248});send(reference,'PLAY',true);block(reference,512);
        const target=reference.cy;
        const boundary={cycles:target,reg:20,val:0xa0};
        reference.write(boundary.reg,boundary.val);
        send(replay,'DATA',{events:[...events,boundary],clock:985248});
        send(replay,'SEEK',{cycles:target,mode:'replay'});
        let turns=0;
        while(replay.seekTarget!==null) {
            const oldCycle=replay.cy;
            const [l,r]=block(replay);
            assert.equal(energy(l)+energy(r),0);
            assert.ok(replay.cy-oldCycle<=4096);
            assert.ok(++turns<10);
        }
        assert.ok(turns>1);
        for(let i=0;i<3;i++) for(const key of ['acc','env','lfsr','f','pw','ctrl','ad','sr']) {
            assert.equal(replay.v[i][key],reference.v[i][key],key);
        }
        assert.equal(replay.regs[20],0xa0);
        assert.equal(replay.ncQ,BigInt(target)<<32n);
        assert.equal(replay.regs[28],replay.v[2].env);
        assert.equal(replay.regs[27],Math.floor(replay.v[2].getWave(replay.v[1].acc)/16)&255);
    });
    test(kind + ': new seeks and DATA cancel replay; no-wave OSC3 is zero', () => {
        const p=processor(kind);
        send(p,'DATA',{events:note,clock:985248});
        send(p,'SEEK',{cycles:100000,mode:'replay'});block(p);
        send(p,'SEEK',2**32+7);assert.equal(p.seekTarget,null);assert.equal(p.cy,2**32+7);
        assert.equal(p.regs[27],0);
        send(p,'SEEK',{cycles:100000,mode:'replay'});block(p);
        send(p,'DATA',{events:[],clock:985248});assert.equal(p.seekTarget,null);assert.equal(p.cy,0);
        const before=p.cy;
        send(p,'SEEK',{cycles:10000001,mode:'replay'});assert.equal(p.cy,before);
        assert.equal(p.regs[27],0);assert.equal(p.regs[28],0);
    });
}
test('SidPlayer exposes safe Station-compatible controls without truncating long events', async () => {
    const p=new SidPlayer({state:'running'}), messages=[];
    p.node={port:{postMessage:m=>messages.push(m)}};
    await p.setData([{cycles:2**32+5,reg:0xd404,val:0x21}]);
    assert.equal(messages.at(-1).payload.events.at(-1).cycles,2**32+5);
    assert.equal(messages.at(-1).payload.events.at(-1).reg,4);
    p.liveWrite(0xd418,15); assert.equal(messages.at(-1).payload.reg,24);
    assert.throws(()=>p.liveWrite(0xd41c,1),/read-only/);
    p.volatileRegs[27]=73;assert.equal(p.getRegister(0xd41b),73);
    await p.setSpeed(2); assert.deepEqual(messages.at(-1),{type:'SPEED',payload:2});
    await p.seek(100,{mode:'replay'});assert.equal(p.volatileSeekTarget,100);
    await p.seek(2**32+5);assert.equal(p.volatileCycles,2**32+5);
    await assert.rejects(p.seek(10000001,{mode:'replay'}));
    await assert.rejects(p.setModel('bad'));
});

for (const kind of ['STD', 'HIFI']) {
    test(kind + ': compiled MIDI is audible and channel silence closes actual DSP voices', async () => {
        // Program 16, held C/E/G, expression zero at tick 120, restore at
        // tick 480, all-sound-off at tick 720. PPQ 480 at default 120 BPM.
        const track = [0,0xc0,16,0,0x90,60,100,0,0x90,64,100,0,0x90,67,100,
            120,0xb0,11,0,0x82,0x68,0xb0,11,127,0x81,0x70,0xb0,120,0,0,255,47,0];
        const midi = Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,
            77,84,114,107,0,0,0,track.length,...track]).buffer;
        const trace = await compileMidiToSidTrace(midi, { coupledEffects: false });
        const p = processor(kind);
        send(p,'MASTER',dry); send(p,'MODEL','8580');
        send(p,'DATA',{events:trace.events,clock:985248}); send(p,'PLAY',true);
        const [left,right] = block(p,57600);
        assert.ok(energy(left.subarray(2400,4800)) > 0.01);
        assert.ok(energy(left.subarray(26400,31200)) > 0.01);
        // Waveform output stops immediately; HIFI's DC-blocking filters retain
        // transient memory. Measure settled silence, not their expected tail.
        assert.ok(energy(left.subarray(19200,21600)) < 1e-8);
        assert.ok(energy(left.subarray(52800)) < 1e-8);
        assert.deepEqual(left,right);
        assert.ok(p.v.every(v=>v.ctrl===0));
    });
    test(kind + ': DATA clears stale state; SEEK preserves long-cycle precision', () => {
        const p = processor(kind);
        send(p, 'DATA', { events: note, clock: 985248 });
        send(p, 'PLAY', true); block(p, 512);
        assert.ok(p.v[0].acc > 0);
        send(p, 'DATA', { events: [], clock: 985248 });
        assert.ok(p.v.every(v => v.env === 0 && v.acc === 0 && v.ctrl === 0));
        assert.equal((p.f || p.filter).vol, 0);
        assert.equal(p.ei, 0);
        const target = 2 ** 32 + 50;
        send(p, 'DATA', { events: [{ cycles: target, reg: 0, val: 73 }], clock: 985248 });
        assert.equal(p.regs[0], 0);
        send(p, 'SEEK', target - 1);
        assert.equal(p.regs[0], 0);
        send(p, 'SEEK', target);
        assert.equal(p.cy, target);
        assert.equal(p.regs[0], 73);
        assert.equal(p.ncQ, BigInt(target) << 32n);
        send(p, 'SPEED', Infinity); assert.equal(p.spd, 1);
        send(p, 'SPEED', 999); assert.equal(p.spd, 4);
    });
    test(kind + ': audible centered stereo, hard pan, solo, pause silence', () => {
        const p = processor(kind);
        send(p, 'MASTER', dry); send(p, 'DATA', { events: note, clock: 985248 });
        send(p, 'MODEL', '8580'); send(p, 'PLAY', true);
        let [l, r] = block(p, 2048);
        assert.ok(energy(l) > 0.01);
        assert.deepEqual(l, r);
        send(p, 'MIXER', mixer(-1));
        send(p, 'DATA', { events: note, clock: 985248 });
        [l, r] = block(p, 2048);
        assert.ok(energy(l) > 0.01);
        assert.equal(energy(r), 0);
        const m = mixer(); m.voices[1].solo = true;
        send(p, 'MIXER', m); send(p, 'DATA', { events: note, clock: 985248 });
        [l, r] = block(p, 1024);
        assert.equal(energy(l) + energy(r), 0);
        send(p, 'PLAY', false);
        const cy = p.cy;
        [l, r] = block(p); assert.equal(energy(l) + energy(r), 0); assert.equal(p.cy, cy);
    });
    test(kind + ': triangle/ring/noise, exact frequency, and silent no-wave', () => {
        const p = processor(kind), v = p.v[0];
        v.ctrl = 0x10; v.acc = 0x400000;
        assert.equal(v.getWave(0), 0x800);
        v.ctrl = 0x14; v.acc = 0xc00000;
        assert.equal(v.getWave(0x800000), 0x800);
        v.ctrl = 0x80;
        assert.equal(v.getWave(0) & 15, 0);
        v.ctrl = 0; v.env = 255;
        if (v.compute) { v.compute(0); assert.equal(v.output, 0); }
        else { v.accumulate(0); assert.equal(v.getSample(), 0); }
        v.write(0, 1); v.write(1, 0); v.acc = 0;
        send(p, 'PLAY', true); block(p, 128);
        assert.equal(v.acc, p.cy);
    });
    test(kind + ': envelope attack and lower-sustain decay', () => {
        const v = processor(kind).v[0], phase = kind === 'STD' ? 'phase' : 'envState';
        v.write(5, 0); v.write(6, 0xf0); v.write(4, 0x21);
        for (let i = 0; i < 9 * 255; i++) v.stepEnv();
        assert.equal(v.env, 255); assert.equal(v[phase], 2);
        for (let i = 0; i < 100; i++) v.stepEnv();
        assert.equal(v.env, 255); assert.equal(v[phase], 3);
        v.write(6, 0x80);
        for (let i = 0; i < 3000; i++) v.stepEnv();
        assert.equal(v.env, 136);
        v.write(4, 0x20);
        for (let i = 0; i < 100000; i++) v.stepEnv();
        assert.equal(v.env, 0);
    });
    test(kind + ': voice-3-off only suppresses bypass, filter sweeps stay finite', () => {
        const p = processor(kind), Filter = (p.f || p.filter).constructor;
        for (const model of ['6581', '8580']) {
            const f = new Filter(); f.model = model;
            f.write(21, 7); f.write(22, 255); f.write(23, 4); f.write(24, 0x9f);
            let sum = 0;
            for (let i = 0; i < 10000; i++) sum += Math.abs(f.process([0, 0, 0.1], 0, 48000));
            assert.ok(sum > 0.1);
            const bypass = new Filter(); bypass.model = model;
            bypass.write(24, 0x8f);
            assert.equal(bypass.process([0, 0, 0.1], 0, 48000), 0);
            for (let cut = 0; cut < 2048; cut++) {
                f.write(21, cut & 7); f.write(22, cut >> 3);
                f.write(23, ((cut & 15) << 4) | 7); f.write(24, 0x7f);
                assert.ok(Number.isFinite(f.process([1, -1, 1], 0, 48000)));
            }
        }
    });
}
test('Offline envelope matches HIFI decay trajectory and reset clears timing', () => {
    const offline = new internals.Voice(), live = processor('HIFI').v[0];
    for (const v of [offline, live]) { v.write(5, 0); v.write(6, 0); v.write(4, 0x21); }
    for (let i = 0; i < 50000; i++) {
        offline.stepEnv(); live.stepEnv();
        assert.equal(offline.env, live.env);
    }
    offline.rateCount = 100; offline.expCount = 10; offline.reset();
    assert.equal(offline.rateCount, 0); assert.equal(offline.expCount, 0);
});
test('Shared offline/worklet mastering produces identical output and resets completely', () => {
    const Kernel = vm.runInNewContext(MASTERING_DSP_CODE + '\nMasteringChain');
    const a = new MasteringChain(44100), b = new Kernel(44100);
    for (let i = 0; i < 2000; i++) {
        const l = Math.sin(i / 11), r = Math.cos(i / 13);
        assert.deepEqual(a.process(l, r), Array.from(b.process(l, r)));
    }
    a.reset();
});
test('Mastering output zero, optional compressor/EQ, invalid input and limiter ceiling', () => {
    const a = new MasteringChain(44100);
    a.updateParams({ output: { gain: 0 } });
    for (let i = 0; i < 1000; i++) assert.deepEqual(a.process(1, -1), [0, 0]);
    a.updateParams({ output: { gain: 4 }, limiter: { enabled: true, ceiling: 0.2 } });
    for (let i = 0; i < 2000; i++) for (const x of a.process(i % 9 ? 0 : 8, -8)) assert.ok(Math.abs(x) <= 0.2 + 1e-12);
    a.updateParams({ eq: { enabled: true, tilt: NaN }, reverb: { active: true, time: Infinity }, output: { gain: NaN } });
    for (const x of a.process(NaN, Infinity)) assert.ok(Number.isFinite(x));
    const plain = new MasteringChain(44100), compressed = new MasteringChain(44100);
    plain.updateParams(dry); compressed.updateParams({ comp: { enabled: true, threshold: 0.1, ratio: 20 } });
    assert.ok(Math.abs(compressed.process(1, 1)[0]) < Math.abs(plain.process(1, 1)[0]));
});
test('Limiter actually delays impulses; reset removes old effect tails', () => {
    const a = new MasteringChain(48000);
    a.updateParams({ limiter: { enabled: true, ceiling: 0.5 } });
    assert.deepEqual(a.process(1, 1), [0, 0]);
    let peak = 0;
    for (let i = 0; i < 500; i++) peak = Math.max(peak, Math.abs(a.process(0, 0)[0]));
    assert.ok(peak > 0);
    a.reset();
    const fresh = new MasteringChain(48000);
    fresh.updateParams({ limiter: { enabled: true, ceiling: 0.5 } });
    for (let i = 0; i < 1000; i++) assert.deepEqual(a.process(0, 0), fresh.process(0, 0));
});
test('WAV supports mono, stereo duplication, finite PCM and rejects bad shapes', async () => {
    const mono = { numberOfChannels: 1, sampleRate: 44100, getChannelData(i) { assert.equal(i, 0); return Float32Array.of(-1, 0, 1, NaN); } };
    const bytes = new DataView(await audioBufferToWav(mono).arrayBuffer());
    assert.equal(bytes.byteLength, 52); assert.equal(bytes.getUint16(22, true), 1);
    assert.equal(bytes.getInt16(44, true), -32768); assert.equal(bytes.getInt16(48, true), 32767); assert.equal(bytes.getInt16(50, true), 0);
    const stereo = new DataView(await createWavFile(Float32Array.of(0.5), 48000).arrayBuffer());
    assert.equal(stereo.getInt16(44, true), stereo.getInt16(46, true));
    assert.throws(() => createWavFile(new Float32Array(1), 48000, 2, new Float32Array(0)), /equal lengths/);
    assert.throws(() => createWavFile(new Float32Array(1), 0), /sample rate/);
    assert.throws(() => createWavFile(new Float32Array(1), 44100, 3), /mono or stereo/);
});
test('Offline WAV honors frame duration, stereo pan, mastering, and releases held notes', async () => {
    const frame = new Array(25).fill(0);
    for (const e of note) frame[e.reg] = e.val;
    const trace = { header: { clock: 985248, fps: 50 }, frames: [frame, frame], events: [] };
    const progress = [];
    const wav = new DataView(await (await OfflineSidRenderer.render(trace, dry, mixer(-1), '8580', p => progress.push(p))).arrayBuffer());
    const samples = Math.ceil((Math.ceil(2 * 985248 / 50) + 985248) * 44100 / 985248);
    assert.equal(wav.byteLength, 44 + samples * 4);
    let loud = 0;
    for (let i = 44; i < wav.byteLength; i += 4) {
        loud += Math.abs(wav.getInt16(i, true)); assert.equal(wav.getInt16(i + 2, true), 0);
    }
    assert.ok(loud > 100);
    assert.equal(progress.at(-1), 1);
    for (let i = wav.byteLength - 400; i < wav.byteLength; i++) assert.equal(wav.getUint8(i), 0);
    await assert.rejects(OfflineSidRenderer.render({ ...trace, header: { clock: NaN } }, dry, mixer(), '8580'), /clock/);
    // Throw after the first chunk: the asynchronous export must reject, not hang.
    await assert.rejects(OfflineSidRenderer.render(trace, dry, mixer(), '8580', () => { throw new Error('progress failed'); }), /progress failed/);
});
test('SidPlayer creates stereo output, validates events and retries failed initialization', async () => {
    const old = global.AudioWorkletNode;
    let options, fail = true;
    global.AudioWorkletNode = class { constructor(ctx, name, opts) { options = opts; this.port = { postMessage() {} }; } connect() {} };
    try {
        const player = new SidPlayer({ audioWorklet: { async addModule() { if (fail) throw new Error('test failure'); } }, destination: {} });
        await assert.rejects(player.init(), /test failure/);
        fail = false; await player.init();
        assert.deepEqual(options.outputChannelCount, [2]);
        await assert.rejects(player.setData([{ cycles: -1, reg: 0, val: 0 }]), /event/);
        await assert.rejects(player.setData([], Infinity), /clock/);
    } finally { global.AudioWorkletNode = old; }
});

test('Instrument audition resumes audio, schedules gate-off and leaves song transport untouched', async () => {
    const old = global.AudioWorkletNode, nodes = [];
    let resumed = 0;
    global.AudioWorkletNode = class {
        constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; nodes.push(this); }
        connect() {} disconnect() { this.disconnected = true; }
    };
    const ctx = { state: 'suspended', async resume() { resumed++; this.state = 'running'; }, audioWorklet: { async addModule() {} }, destination: {} };
    const player = new SidPlayer(ctx);
    try {
        await player.init('HIFI');
        await player.setData(note, 985248);
        const messagesBefore = nodes[0].messages.length;
        player.volatileCycles = 12345;
        await player.audition([0x44, 0x1d, 0, 8, 0x21, 0, 0xf0], 350);
        assert.equal(resumed, 1); assert.equal(nodes.length, 2);
        assert.equal(player.isPlaying, false); assert.equal(player.volatileCycles, 12345);
        assert.equal(nodes[0].messages.length, messagesBefore);
        const events = nodes[1].messages.find(m => m.type === 'DATA').payload.events;
        assert.equal(events.at(-1).cycles, Math.round(985248 * 0.35));
        assert.equal(events.at(-1).val & 1, 0);
        await player.audition([0, 20, 0, 8, 0x41, 0, 0xf0]);
        assert.equal(nodes[1].disconnected, true);
        assert.equal(nodes[1].messages.at(-1).type, 'DISPOSE');
        await assert.rejects(player.audition([0]), /seven voice-register/);
    } finally { player.stopAudition(); global.AudioWorkletNode = old; }
    assert.equal(nodes.at(-1).disconnected, true);
});

for (const kind of ['STD', 'HIFI']) test(kind + ': disposed worklet stops processing', () => {
    const p = processor(kind);
    send(p, 'DISPOSE');
    assert.equal(p.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
});

for (const kind of ['STD', 'HIFI']) test(kind + ': paused seek publishes state and RMS never exceeds sample peak', () => {
    const p = processor(kind), reports = [];
    p.port.postMessage = message => reports.push(message);
    send(p, 'DATA', { events: note, clock: 985248 });
    send(p, 'SEEK', 10000);
    assert.equal(reports.at(-1).cy, 10000);
    assert.equal(reports.at(-1).regs[4], 0x21);
    send(p, 'PLAY', true);
    for (let i = 0; i < 20; i++) block(p, 256);
    const report = reports.at(-1);
    assert.ok(report.vPeaks[0] > 0);
    assert.ok(report.vRms[0] > 0);
    assert.ok(report.vRms[0] <= report.vPeaks[0] + 1e-10);
});

test('Destroy during module loading prevents a late audio node and is idempotent', async () => {
    const old = global.AudioWorkletNode;
    let finish, created = 0, closed = 0;
    global.AudioWorkletNode = class { constructor() { created++; } };
    const player = new SidPlayer({ state: 'running', destination: {},
        audioWorklet: { addModule: () => new Promise(resolve => { finish = resolve; }) },
        async close() { closed++; }
    });
    try {
        const pending = player.init();
        player.destroy(); player.destroy(); finish();
        await assert.rejects(pending, /destroyed/);
        await assert.rejects(player.init(), /destroyed/);
        await assert.rejects(player.play(), /destroyed/);
        await assert.rejects(player.seek(1, { mode: 'replay' }), /destroyed/);
        assert.equal(created, 0); assert.equal(closed, 1);
        assert.equal(player.node, null); assert.equal(player.isPlaying, false);
        assert.equal(player.volatileSeekTarget, null);
    } finally { global.AudioWorkletNode = old; }
});

test('Destroy while resuming prevents transport resurrection', async () => {
    let finish;
    const player = new SidPlayer({ state: 'suspended',
        resume: () => new Promise(resolve => { finish = resolve; }), async close() {} });
    const pending = player.play();
    await Promise.resolve();
    player.destroy(); finish();
    await assert.rejects(pending, /destroyed/);
    assert.equal(player.isPlaying, false);
});

for (const kind of ['STD', 'HIFI']) test(kind + ': paused live edits publish and supply follows model, not clock', () => {
    const p = processor(kind), reports = [];
    p.port.postMessage = message => reports.push(message);
    send(p, 'DATA', { events: note, clock: 1022727 });
    send(p, 'LIVE', { reg: 0xd400, val: 123 });
    assert.equal(reports.at(-1).regs[0], 123);
    for (const [model, supply] of [['8580', 9], ['6581', 12]]) {
        send(p, 'MODEL', model);
        send(p, 'PLAY', true);
        for (let i = 0; i < 20; i++) block(p, 128);
        assert.equal(reports.at(-1).phys.vSupply, supply);
    }
});
