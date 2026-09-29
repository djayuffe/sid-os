import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncResource } from '../services/asyncResource';

test('concurrent audio initialization shares a single resource and reset disposes it once', async () => {
    let creations = 0;
    const disposed: number[] = [];
    const resource = new AsyncResource<number>(value => disposed.push(value));
    const create = async () => ++creations;
    const first = resource.get(create);
    assert.strictEqual(resource.get(create), first);
    assert.equal(await first, 1);
    assert.equal(await resource.get(create), 1);
    assert.equal(creations, 1);
    resource.reset();
    resource.reset();
    assert.deepEqual(disposed, [1]);
    assert.equal(await resource.get(create), 2);
});

test('late audio engine completion is retired without replacing the new engine', async () => {
    const disposed: number[] = [];
    const resource = new AsyncResource<number>(value => disposed.push(value));
    let resolve!: (value: number) => void;
    const old = resource.get(() => new Promise<number>(done => { resolve = done; }));
    resource.reset();
    assert.equal(await resource.get(async () => 2), 2);
    resolve(1);
    assert.equal(await old, null);
    assert.deepEqual(disposed, [1]);
    assert.equal(await resource.get(async () => 3), 2);
});

test('failed initialization permits retry, including synchronous failures', async () => {
    const resource = new AsyncResource<number>(() => {});
    await assert.rejects(resource.get(async () => { throw new Error('module failed'); }));
    await assert.rejects(resource.get(() => { throw new Error('context failed'); }));
    assert.equal(await resource.get(async () => 3), 3);
});
