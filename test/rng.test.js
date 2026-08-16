import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, seedFromString, randInt, pick, shuffle } from '../src/rng.js';

test('makeRng は同じシードで同じ列を返す', () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('makeRng は違うシードで違う列を返す', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  assert.notEqual(a(), b());
});

test('makeRng の出力は [0,1) に収まる', () => {
  const r = makeRng(999);
  for (let i = 0; i < 2000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `範囲外: ${v}`);
  }
});

test('seedFromString は同じ文字列で同じ値、違う文字列で違う値', () => {
  assert.equal(seedFromString('a3f91c'), seedFromString('a3f91c'));
  assert.notEqual(seedFromString('a3f91c'), seedFromString('a3f91d'));
  assert.ok(Number.isInteger(seedFromString('x')));
});

test('randInt は min と max を両端とも含む', () => {
  const r = makeRng(7);
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(randInt(r, 3, 6));
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
});

test('pick は配列の要素を返す', () => {
  const r = makeRng(42);
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) assert.ok(arr.includes(pick(r, arr)));
});

test('shuffle は元配列を壊さず、同じ要素を返す', () => {
  const r = makeRng(5);
  const src = [1, 2, 3, 4, 5, 6];
  const out = shuffle(r, src);
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...out].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6]);
});
