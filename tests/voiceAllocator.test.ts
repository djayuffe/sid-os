import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceAllocator, voiceLayout } from '../services/voiceAllocator';


test('allocator uses three stable slots, steals only one quietest voice', () => {
    const a = new VoiceAllocator();
    const notes = [a.noteOn(0, 60, 100), a.noteOn(0, 64, 20), a.noteOn(0, 67, 110)];
    assert.deepEqual(notes.map(n => n.voice), [0,1,2]);
    assert.equal(a.noteOn(1, 72, 90).voice, 1);
    assert.deepEqual(a.slots.map(n => n?.note), [60,72,67]);
    assert.equal(a.noteOff(0,64), null);
    assert.equal(a.slots[1]?.note,72);
});

test('stolen overlapping same-pitch note-off never cuts its replacement', () => {
    const a = new VoiceAllocator();
    a.noteOn(0,60,10); a.noteOn(0,64,100); a.noteOn(0,67,100);
    a.noteOn(0,60,100);
    assert.equal(a.noteOff(0,60),null);
    assert.equal(a.slots[0]?.note,60);
    assert.equal(a.noteOff(0,60)?.voice,0);
});

test('sustain consumes each overlapping key release once and pedal-up releases both', () => {
    const a = new VoiceAllocator();
    a.setSustain(0,true); a.noteOn(0,60,100); a.noteOn(0,60,100);
    assert.equal(a.noteOff(0,60),null); assert.equal(a.noteOff(0,60),null);
    assert.deepEqual(a.slots.filter(Boolean).map(n => n!.keyDown),[false,false]);
    assert.equal(a.setSustain(0,false).length,2);
    assert.equal(a.slots.filter(Boolean).length,0);
});

test('free then pedal-held slots are preferred over physically held notes', () => {
    const a = new VoiceAllocator();
    a.noteOn(0,60,10); a.noteOn(0,64,100);
    a.setSustain(0,true); a.noteOff(0,64);
    assert.equal(a.noteOn(0,67,100).voice,2);
    assert.equal(a.noteOn(0,69,100).voice,1);
    assert.equal(a.setSustain(0,false).length,0);
});

test('ownership is channel-specific and all-notes-off honors sustain', () => {
    const a = new VoiceAllocator();
    a.noteOn(0,60,100); a.noteOn(1,60,100); a.setSustain(0,true);
    assert.equal(a.allNotesOff(0).length,0);
    assert.equal(a.allNotesOff(0,false).length,1);
    assert.equal(a.slots[1]?.channel,1);
    assert.equal(a.noteOff(1,60)?.voice,1);
});

test('dense allocation is deterministic, bounded to three owners and drains cleanly', () => {
    const run = () => {
        const a = new VoiceAllocator(); const assignments: number[] = [];
        for (let i=0; i<300; i++) {
            assignments.push(a.noteOn(i%4,48+i%24,1+i%127).voice);
            assert.ok(a.slots.filter(Boolean).length <= 3);
            for (const [index,note] of a.slots.entries()) if (note) assert.equal(note.voice,index);
        }
        for (let i=0; i<300; i++) a.noteOff(i%4,48+i%24);
        assert.equal(a.activeNotes.length,0);
        assert.ok(a.slots.every(n => n === null));
        return assignments;
    };
    assert.deepEqual(run(),run());
});

test('live unison is only a projection and does not consume polyphonic slots', () => {
    const a = new VoiceAllocator();
    const first = a.noteOn(0,60,100);
    assert.deepEqual(voiceLayout(a,true).map(n => n?.id),[first.entry.id,first.entry.id,first.entry.id]);
    assert.equal(a.slots.filter(Boolean).length,1);
    a.noteOn(0,64,100);
    assert.deepEqual(voiceLayout(a,true).map(n => n?.note ?? -1),[60,64,-1]);
    a.noteOn(0,67,100);
    assert.deepEqual(voiceLayout(a,true).map(n => n?.note),[60,64,67]);
    a.noteOff(0,64); a.noteOff(0,67);
    assert.deepEqual(voiceLayout(a,true).map(n => n?.note),[60,60,60]);
    a.noteOff(0,60);
    assert.deepEqual(voiceLayout(a,true),[null,null,null]);
});

test('same-pitch live retrigger receives a fresh identity even on the same oscillator', () => {
    const a = new VoiceAllocator();
    const first = a.noteOn(0,60,100);
    a.noteOn(0,64,100); a.noteOn(0,67,100);
    const second = a.noteOn(0,60,100);
    assert.equal(first.voice,second.voice);
    assert.notEqual(first.entry.id,second.entry.id);
});

test('pedal release never gates off a physically held note on another channel', () => {
    const a = new VoiceAllocator();
    a.setSustain(0,true); a.noteOn(0,60,100); a.noteOff(0,60);
    a.noteOn(1,60,100);
    assert.equal(a.setSustain(0,false).length,1);
    assert.deepEqual(a.slots.filter(Boolean).map(n => n!.channel),[1]);
});

test('retired voices retain note-off bookkeeping without reserving an oscillator', () => {
    const a = new VoiceAllocator();
    a.noteOn(9,42,100); a.retireVoice(0);
    assert.equal(a.slots.filter(Boolean).length,0);
    a.noteOn(9,42,100);
    assert.equal(a.noteOff(9,42),null);
    assert.equal(a.slots.filter(Boolean).length,1);
    assert.notEqual(a.noteOff(9,42),null);
});

test('invalid notes and channels cannot alias a valid note-off or poison sustain', () => {
    const a = new VoiceAllocator();
    a.noteOn(0,0,100);
    assert.equal(a.noteOff(-1,128),null);
    assert.equal(a.noteOff(0.5,-64),null);
    assert.equal(a.slots[0]?.note,0);
    for (const channel of [-1,16,NaN,0.5]) {
        assert.throws(() => a.noteOn(channel,60,100));
        assert.deepEqual(a.setSustain(channel,true),[]);
        assert.deepEqual(a.allNotesOff(channel),[]);
    }
    for (const velocity of [0,-1,128,NaN,Infinity]) assert.throws(() => a.noteOn(0,60,velocity));
    assert.equal(a.noteOff(0,0)?.voice,0);
});
