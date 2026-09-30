// Copyright (c) 2026 Ulf Bertilsson. SPDX-License-Identifier: GPL-3.0-only
// Shared browser/worklet boundary rules. No upstream implementation is copied.
export const SID_REPLAY_LIMIT = 10000000;
export const SID_REPLAY_BUDGET = 4096;
export function sidRegister(value) {
    if (!Number.isInteger(value)) throw new Error('Invalid SID register');
    if (value >= 0xd400 && value <= 0xd41f) return value - 0xd400;
    if (value >= 0 && value <= 31) return value;
    throw new Error('Invalid SID register');
}
export function sidByte(value) {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('Invalid SID byte');
    return value;
}
export function sidClock(value = 985248) {
    if (!Number.isFinite(value) || value < 100000 || value > 2000000) throw new Error('Invalid SID clock');
    return value;
}
export function sidEvents(input) {
    if (!Array.isArray(input) || input.length > 2000000) throw new Error('Invalid SID event collection');
    return input.map(event => {
        if (!event || !Number.isSafeInteger(event.cycles) || event.cycles < 0) throw new Error('Invalid SID event cycle');
        return { cycles: event.cycles, reg: sidRegister(event.reg), val: sidByte(event.val) };
    }).sort((a,b) => a.cycles - b.cycles);
}
export function sidSpeed(value) {
    return Number.isFinite(value) ? Math.max(0.01, Math.min(4, value)) : 1;
}
export function sidMask(value) {
    return [0,1,2].map(i => typeof value?.[i] === 'boolean' ? value[i] : true);
}
export function sidMixer(value) {
    const bounded = (v, lo, hi, fallback) => Number.isFinite(v) ? Math.max(lo,Math.min(hi,v)) : fallback;
    return {
        masterVolume: bounded(value?.masterVolume,0,2,0.5),
        voices: [0,1,2].map(i => {
            const voice = value?.voices?.[i];
            return { volume: bounded(voice?.volume,0,2,1), pan: bounded(voice?.pan,-1,1,0),
                muted: voice?.muted === true, solo: voice?.solo === true };
        })
    };
}
export function sidSeek(cycles, mode = 'registers') {
    if (!Number.isSafeInteger(cycles) || cycles < 0) throw new Error('Invalid SID seek cycle');
    if (mode !== 'registers' && mode !== 'replay') throw new Error('Invalid SID seek mode');
    if (mode === 'replay' && cycles > SID_REPLAY_LIMIT) throw new Error('State replay exceeds 10000000 cycles; use register seek for longer traces');
    return { cycles, mode };
}
