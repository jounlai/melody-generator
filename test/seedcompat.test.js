// test/seedcompat.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSnapshot, loadData } from '../tools/snapshot.js';

// 編曲層は「いつ鳴らすか」だけを変える。「どの音を鳴らすか」が動いたら、
// 同じ曲コードから別の旋律が出るということで、共有済みのURLが壊れる。
const snapshotPath = new URL('./data/melody-snapshot.json', import.meta.url);
const has = fs.existsSync(snapshotPath) && fs.existsSync(new URL('../src/data/melodies.json', import.meta.url));
const opts = { skip: has ? false : 'スナップショットまたは src/data/*.json が無い' };

test('旋律の midi の並びがスナップショットと完全に一致する', opts, () => {
  const want = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const got = buildSnapshot(loadData());
  const keys = Object.keys(want);
  assert.ok(keys.length >= 60, `スナップショットが少ない: ${keys.length}`);
  for (const key of keys) {
    assert.equal(got[key], want[key], `${key}: 旋律の音程が変わった`);
  }
  assert.deepEqual(Object.keys(got).sort(), keys.sort(), '曲の集合が変わった');
});
