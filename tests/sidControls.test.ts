import assert from 'node:assert/strict';
import test from 'node:test';
import { sidRegister, sidByte, sidEvents, sidClock, sidSpeed, sidMask, sidMixer, sidSeek, SID_REPLAY_LIMIT } from '../services/sidPlaybackControls';

test('SID addresses accept offsets and the exact D400-D41F block without aliasing', () => {
    for(let i=0;i<32;i++) assert.equal(sidRegister(0xd400+i),i);
    for(const r of [-1,32,0xd420,0xd3ff,1.5,NaN,Infinity,'0xd400',null]) assert.throws(()=>sidRegister(r));
    for(const value of [-1,256,1.5,NaN,null]) assert.throws(()=>sidByte(value));
});
test('trace boundary makes independent stable copies and retains long-cycle precision', () => {
    const input=[{cycles:2**32+1,reg:0xd404,val:33},{cycles:0,reg:4,val:0},{cycles:0,reg:4,val:33}];
    const result=sidEvents(input);
    assert.deepEqual(result.map(e=>e.val),[0,33,33]);
    assert.equal(result[2].cycles,2**32+1);
    input[0].val=0; assert.equal(result[2].val,33);
    assert.throws(()=>sidEvents([{cycles:0.1,reg:0,val:0}]));
    assert.throws(()=>sidEvents([null]));
});
test('control defaults are finite, bounded and independent across partial voices', () => {
    assert.equal(sidClock(),985248); assert.throws(()=>sidClock(Infinity));
    assert.equal(sidSpeed(Infinity),1); assert.equal(sidSpeed(99),4);
    assert.deepEqual(sidMask([false]),[false,true,true]);
    const mix=sidMixer({masterVolume:NaN,voices:[{volume:3,pan:-2,solo:true},null]});
    assert.equal(mix.masterVolume,0.5); assert.equal(mix.voices.length,3);
    assert.deepEqual(mix.voices[0],{volume:2,pan:-1,solo:true,muted:false});
    assert.equal(mix.voices[1].volume,1);
    assert.deepEqual(sidMixer(null),sidMixer({}));
});
test('state replay is bounded without truncating normal long-trace seeks', () => {
    assert.equal(sidSeek(2**32+1).cycles,2**32+1);
    assert.equal(sidSeek(SID_REPLAY_LIMIT,'replay').mode,'replay');
    assert.throws(()=>sidSeek(SID_REPLAY_LIMIT+1,'replay'));
    for(const value of [-1,0.5,NaN,Infinity]) assert.throws(()=>sidSeek(value));
    assert.throws(()=>sidSeek(1,'unknown'));
});
