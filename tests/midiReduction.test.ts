import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { compileMidiToSidTrace } from '../services/midiSidService';
import { selectSidNotes } from '../services/midiReductionService';
import type { ParsedTrace } from '../types';

test('percussion panic cannot retrigger a melodic note occupying voice three', async () => {
    const trace = await run([...chord([36,60,84]),[120,0xb9,120,0],off(480,36),off(480,60),off(480,84)]);
    const cycle = Math.round(clock / 8);
    assert.deepEqual(trace.events.filter(e => e.cycles === cycle && [4,11,18].includes(e.reg)), []);
});

test('zero volume or expression immediately silences already-releasing filtered notes', async () => {
    for (const cc of [7,11]) {
        const trace = await run([[0,0xc0,19],[0,0x90,60,100],off(120,60),[144,0xb0,cc,0],[480,0xb0,cc,127]]);
        assert.ok(at(trace,0.13)[4] & 0xf0);
        assert.equal(at(trace,0.15)[4],0);
        assert.equal(at(trace,0.15)[23]&7,0);
    }
});

test('muting percussion restores the third melodic voice in the same SID cycle', async () => {
    const trace = await run([...chord([36,60,84]),[0,0x99,49,100],[120,0xb9,11,0],
        off(480,36),off(480,60),off(480,84)]);
    assert.deepEqual(notesAt(trace,0.125),[36,60,84]);
});

test('reset controllers clears per-note pressure including filter release ownership', async () => {
    const trace = await run([[0,0xc0,19],[0,0x90,60,100],[1,0xa0,60,127],[120,0xb0,121,0],off(480,60)]);
    const base = Math.round(440*Math.pow(2,(60-69)/12)*16777216/clock);
    assert.equal(frequency(at(trace,0.15),0),base);
    assert.equal(frequency(at(trace,0.25),0),base);
    assert.equal(at(trace,0.15)[21] | at(trace,0.15)[22]<<3,0x3c0);
    const tail = await run([[0,0xc0,19],[0,0x90,60,100],[1,0xa0,60,127],
        off(120,60),[144,0xb0,121,0],[480,0xb0,1,0]]);
    assert.ok(at(tail,0.15)[23]&1);
    assert.equal(at(tail,0.15)[21] | at(tail,0.15)[22]<<3,0x3c0);
});

test('percussion expression updates an active envelope without retriggering', async () => {
    const trace = await run([[0,0x99,49,127],[120,0xb9,11,32],[240,0xb9,11,127],[480,0x89,49,0]]);
    assert.ok((at(trace,0.13)[20]>>4) < (at(trace,0)[20]>>4));
    assert.equal(at(trace,0.26)[20]>>4,at(trace,0)[20]>>4);
    assert.ok(!trace.events.some(e=>e.cycles===Math.round(clock/8)&&e.reg===18));
});

test('percussion All Notes Off clears old key identities before a same-key retrigger', async () => {
    const trace = await run([[0,0x99,36,100],[30,0xb9,123,0],[60,0x99,36,100],[90,0x89,36,0],[480,0xb9,1,0]]);
    assert.equal(at(trace,0.10)[18]&1,0);
});

test('parser safety limits include ignored metadata and direct API file size', async () => {
    const count = 500001;
    const bytes = new Uint8Array(22 + count * 4);
    bytes.set(new Uint8Array(smf([[0,0x90,60,100]])).subarray(0,22));
    new DataView(bytes.buffer).setUint32(18,count*4);
    for (let i=0;i<count;i++) bytes.set([0,255,1,0],22+i*4);
    await assert.rejects(compileMidiToSidTrace(bytes.buffer),/event safety limit/);
    await assert.rejects(compileMidiToSidTrace(new ArrayBuffer(16*1024*1024+1)),/16 MiB/);
    await assert.rejects(run([[0,0x90,60,100],[1,255,128,0]]),/meta-event type/);
});

const clock = 985248;
const vlq = (value: number) => {
    const bytes = [value & 127];
    while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
    return bytes;
};
type Ev = [number, ...number[]];
function smf(events: Ev[]): ArrayBuffer {
    let last = 0;
    const data = events.flatMap(([tick, ...message]) => { const delta = tick - last; last = tick; return [...vlq(delta), ...message]; });
    data.push(0, 255, 47, 0);
    const n = data.length;
    return Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,n>>>24,(n>>>16)&255,(n>>>8)&255,n&255,...data]).buffer;
}
const run = (events: Ev[], options = {}) => compileMidiToSidTrace(smf(events), { clock, coupledEffects: false, ...options });
const at = (trace: ParsedTrace, seconds: number) => {
    const r = new Array(32).fill(0);
    for (const e of trace.events) { if (e.cycles > Math.round(seconds * clock)) break; r[e.reg] = e.val; }
    return r;
};
const frequency = (r: number[], i: number) => r[i * 7] | r[i * 7 + 1] << 8;
const noteOf = (r: number[], i: number) => Math.round(69 + 12 * Math.log2(frequency(r, i) * clock / 16777216 / 440));
const notesAt = (trace: ParsedTrace, seconds: number) => {
    const r = at(trace, seconds);
    return [0,1,2].filter(i => r[i*7+4] & 1).map(i => noteOf(r,i)).sort((a,b)=>a-b);
};
const chord = (keys: number[]): Ev[] => keys.map(key => [0, 0x90, key, 100]);
const off = (tick: number, key: number): Ev => [tick, 0x80, key, 0];

for (const [reduction, hash] of [
    ['balanced','c223df831f2a1a0c018da8f634cccda4bc771bc912e0bef0776142a65fe8ee4b'],
    ['arpeggio','7d11989b6c8e1cae5b8a956e4da731d10fa9b9ad7406b87be02be35848d48a3e'],
] as const) {
    test(reduction + ': dense held passage preserves the pre-optimization trace exactly', async () => {
        const events: Ev[] = Array.from({length:2048},(_,i)=>[0,0x90,i%96+24,50+i%78]);
        events.push(...Array.from({length:2048},(_,i)=>off(9600,i%96+24)));
        const trace = await compileMidiToSidTrace(smf(events),{reduction});
        // Includes snapshots, ordered writes and loss telemetry. Captured from
        // the uncached implementation; no flaky wall-clock assertions in CI.
        assert.equal(createHash('sha256').update(JSON.stringify(trace)).digest('hex'),hash);
    });
}

test('balanced selector protects extremes and pitch-class diversity independently of note order', () => {
    const notes = [36,60,64,67,84].map((key,id) => ({ id, key, channel: 0, program: 0, velocity: 100, start: 0, down: true }));
    for (const input of [notes, [...notes].reverse()]) {
        assert.deepEqual(selectSidNotes(input,3,new Set(),'balanced',0).map(n=>n.key), [36,84,64]);
    }
});

test('dense imports retain bass/melody and restore omitted held notes when space returns', async () => {
    const trace = await run([...chord([36,60,64,67,84]), off(240,84), off(480,64), off(720,67), off(960,60), off(960,36)]);
    assert.deepEqual(notesAt(trace,0), [36,64,84]);
    assert.deepEqual(notesAt(trace,0.26), [36,64,67]);
    assert.deepEqual(notesAt(trace,0.51), [36,60,67]);
    assert.equal(trace.header.midiReduction!.soundedNotes,5);
    assert.equal(trace.header.midiReduction!.peakPolyphony,5);
});

test('FIFO source instances survive stealing and repeated sustain note-offs', async () => {
    const stolen = await run([[0,0x90,60,10],[1,0x90,60,120],[2,0x90,36,100],[2,0x90,84,100],
        off(120,60),off(240,60),off(480,36),off(480,84)]);
    assert.ok(notesAt(stolen,0.13).includes(60));
    assert.ok(!notesAt(stolen,0.26).includes(60));
    const sustained = await run([[0,0xb0,64,127],[0,0x90,60,100],[1,0x90,60,100],
        off(120,60),off(240,60),[360,0xb0,64,0]]);
    assert.equal(notesAt(sustained,0.30).length,2);
    assert.equal(notesAt(sustained,0.38).length,0);
});

test('sostenuto captures existing keys only and All Sound Off bypasses both pedals', async () => {
    const trace = await run([[0,0x90,60,100],[60,0xb0,66,127],[120,0x90,64,100],
        off(180,60),off(180,64),[240,0xb0,120,0],[360,0xb0,66,0]]);
    assert.deepEqual(notesAt(trace,0.2),[60]);
    assert.ok([0,1,2].every(i => at(trace,0.26)[i*7+4] === 0));
});

test('optional arpeggio preserves outer voices while rotating inner chord tones', async () => {
    const keys = [36,60,64,67,84];
    const trace = await run([...chord(keys), ...keys.map(k=>off(960,k))], { reduction: 'arpeggio', arpeggioHz: 12 });
    const middle = new Set<number>();
    for (let i=0;i<9;i++) {
        const keys = notesAt(trace,i/12+0.01);
        assert.equal(keys[0],36); assert.equal(keys[2],84); middle.add(keys[1]);
    }
    assert.deepEqual([...middle].sort((a,b)=>a-b),[60,64,67]);
});

test('expression zero physically silences a note and restoring expression restores its allocation', async () => {
    const trace = await run([[0,0xc0,16],[0,0x90,60,100],[120,0xb0,11,0],[240,0xb0,11,127],off(480,60)]);
    assert.equal(at(trace,0.13)[4],0);
    assert.deepEqual(notesAt(trace,0.26),[60]);
});

test('pressure and modulation control frequency/PWM at a real 5 Hz rate', async () => {
    const trace = await run([[0,0xc0,16],[0,0x90,69,100],[120,0xd0,127],off(960,69)]);
    const values = [0.16,0.20,0.24,0.28,0.32].map(t=>frequency(at(trace,t),0));
    assert.ok(Math.max(...values)-Math.min(...values)>200);
    assert.ok(trace.events.some(e=>e.cycles>clock/8 && (e.reg===2||e.reg===3)));
    assert.ok(Math.abs(frequency(at(trace,0.2),0)-Math.round(440*16777216/clock))<3);
    const width = (time: number) => { const r = at(trace,time); return r[2] | r[3]<<8; };
    const center = width(0);
    assert.ok(width(0.15) < center - 300);
    assert.ok(width(0.25) > center + 300);
    assert.ok(Math.abs(width(0.2) - center) <= 1);
});

test('brightness/resonance and ADSR controllers write bounded registers; release keeps filter ownership', async () => {
    const trace = await run([[0,0xc0,33],[0,0x90,48,100],[60,0xb0,74,10],[120,0xb0,74,120],
        [120,0xb0,71,127],[120,0xb0,73,80],[120,0xb0,72,64],off(240,48)]);
    const a=at(trace,0.07), b=at(trace,0.13), release=at(trace,0.251);
    assert.ok((b[21]|b[22]<<3)>(a[21]|a[22]<<3));
    assert.equal(b[23]>>4,15); assert.equal(b[5]>>4,2);
    assert.equal(release[4]&1,0); assert.ok(release[23]&1);
    assert.equal(at(trace,100)[23],0);
});

test('ring modulation and sync reserve only spare oscillators and can be disabled', async () => {
    for (const [program,bit] of [[9,4],[80,2]]) {
        const enabled=await run([[0,0xc0,program],[0,0x90,60,100],off(120,60)],{coupledEffects:true});
        const r=at(enabled,0);
        assert.ok(r[4]&bit); assert.ok(frequency(r,2)>0); assert.equal(r[18],0); assert.ok(r[24]&128);
        const disabled=await run([[0,0xc0,program],[0,0x90,60,100],off(120,60)]);
        assert.equal(at(disabled,0)[4]&6,0);
        const full=await run([[0,0xc0,program],...chord([48,60,72]),off(240,48),off(240,60),off(240,72)],{coupledEffects:true});
        assert.deepEqual(notesAt(full,0),[48,60,72]);
        assert.ok([4,11,18].every(reg=>(at(full,0)[reg]&6)===0));
    }
});

test('upper notes fold by octaves rather than collapsing to a single clipped frequency', async () => {
    const trace=await run([...chord([120,124,127]),off(240,120),off(240,124),off(240,127)]);
    const pitches=notesAt(trace,0);
    assert.deepEqual(pitches.map(n=>n%12).sort((a,b)=>a-b),[0,4,7]);
    assert.equal(trace.header.midiReduction!.octaveFoldedNotes,3);
});

test('RPN bend/tuning follow selected parameters and NRPN cancels data-entry targeting', async () => {
    const trace=await run([[0,0xb0,101,0],[0,0xb0,100,0],[0,0xb0,6,12],[0,0xe0,127,127],
        [0,0x90,60,100],[120,0xb0,99,1],[120,0xb0,6,1],off(240,60)]);
    assert.deepEqual(notesAt(trace,0),[72]); assert.deepEqual(notesAt(trace,0.13),[72]);
    const tuned=await run([[0,0xb0,101,0],[0,0xb0,100,2],[0,0xb0,6,65],[0,0x90,60,100],off(240,60)]);
    assert.deepEqual(notesAt(tuned,0),[61]);
});

test('drums retrigger, ignore stale same-key note-offs and return the third voice', async () => {
    const trace=await run([...chord([36,60,84]),[1,0x99,36,100],[30,0x99,36,100],[60,0x89,36,0],
        [90,0x89,36,0],off(960,36),off(960,60),off(960,84)]);
    assert.equal(at(trace,0.07)[18]&1,1);
    assert.equal(at(trace,0.10)[18]&1,0);
    assert.deepEqual(notesAt(trace,0.5),[36,60,84]);
    assert.ok(trace.events.some(e=>e.reg===16||e.reg===17));
    const triggers=trace.events.filter(e=>e.reg===18&&e.cycles===Math.round(30/960*clock));
    assert.ok(triggers.some(e=>e.val===0));
});

test('source ordering preserves zero-length on/off pairs and tempo changes', async () => {
    const empty=await run([[0,0x90,60,100],off(0,60)]);
    assert.ok(empty.events.every(e=>![4,11,18].includes(e.reg)||!(e.val&1)));
    const trace=await run([[0,0x90,60,100],[120,255,81,3,15,66,64],off(240,60)]);
    assert.ok(trace.events.some(e=>e.reg===4&&!(e.val&1)&&e.cycles===Math.round(0.375*clock)));
});

test('every frame reconstructs from legal chronological SID writes at PAL and NTSC', async () => {
    for (const c of [985248,1022727]) {
        const trace=await run([[0,0xc0,64],...chord([40,60,80]),[120,0xb0,74,90],off(360,40),off(360,60),off(360,80)],{clock:c});
        const regs=new Array(32).fill(0); let ei=0,last=-1;
        for (const e of trace.events) {
            assert.ok(Number.isSafeInteger(e.cycles)&&e.cycles>=last); last=e.cycles;
            assert.ok(e.reg>=0&&e.reg<=24); assert.ok(Number.isInteger(e.val)&&e.val>=0&&e.val<=255);
        }
        trace.frames.forEach((frame,i)=>{
            const cycle=Math.floor(i*c/trace.header.fps!);
            while(ei<trace.events.length&&trace.events[ei].cycles<=cycle) { const e=trace.events[ei++]; regs[e.reg]=e.val; }
            assert.deepEqual(Array.from(frame),regs);
        });
    }
});

test('invalid conversion policies and clocks fail explicitly', async () => {
    for (const options of [{clock:0},{arpeggioHz:Infinity},{reduction:'random'}]) {
        await assert.rejects(run([[0,0x90,60,100],off(240,60)],options));
    }
});

test('simultaneous percussion keeps the rhythmic anchor independently of source order', async () => {
    for (const keys of [[36,38,42], [42,38,36]]) {
        const trace = await run([...keys.map(key => [0,0x99,key,100] as Ev),
            ...keys.map(key => [240,0x89,key,0] as Ev)]);
        const r = at(trace,0);
        assert.equal(r[18],0x11);
        assert.equal(frequency(r,2),Math.round(220*16777216/clock));
        assert.equal(trace.header.midiReduction!.inputNotes,3);
        assert.equal(trace.header.midiReduction!.soundedNotes,1);
        assert.equal(trace.header.midiReduction!.omittedNotes,2);
    }
    // A high-priority hit rounded to zero velocity must not hide an audible hit.
    const quiet = await run([[0,0xb9,7,1],[0,0x99,36,1],[0,0x99,38,127],
        [240,0x89,36,0],[240,0x89,38,0]]);
    assert.equal(at(quiet,0)[18],0x81);
    assert.equal(quiet.header.midiReduction!.soundedNotes,1);
});

test('zero-length, cancelled and silent drum hits do not preempt held melody', async () => {
    for (const drumEvents of [
        [[120,0x99,36,100],[120,0x89,36,0]],
        [[120,0x99,36,100],[120,0xb9,120,0]],
        [[120,0xb9,11,0],[120,0x99,36,100]],
    ] as Ev[][]) {
        const trace = await run([...chord([36,60,84]),...drumEvents,
            off(480,36),off(480,60),off(480,84)]);
        assert.deepEqual(notesAt(trace,0.13),[36,60,84]);
        assert.equal(trace.header.midiReduction!.soundedNotes,3);
        assert.equal(trace.header.midiReduction!.omittedNotes,1);
    }
});

test('malformed tempo/EOT fail explicitly and events after EOT are ignored', async () => {
    await assert.rejects(run([[0,0x90,60,100],[120,255,81,2,7,161]]),/three bytes/);
    await assert.rejects(run([[0,0x90,60,100],[120,255,47,1,0]]),/end-of-track/);
    const trace = await run([[0,0x90,60,100],off(120,60),[120,255,47,0],[240,0x90,84,100]]);
    assert.equal(trace.header.midiReduction!.inputNotes,1);
});

test('reset controllers preserves channel volume and registered tuning', async () => {
    const trace = await run([[0,0xc0,16],[0,0xb0,7,32],[0,0xb0,101,0],[0,0xb0,100,2],
        [0,0xb0,6,65],[0,0xb0,11,50],[0,0x90,60,100],[120,0xb0,121,0],off(480,60)]);
    assert.deepEqual(notesAt(trace,0.13),[61]);
    assert.ok((at(trace,0.13)[6]>>4)>(at(trace,0)[6]>>4));
    assert.ok((at(trace,0.13)[6]>>4)<5);
});
