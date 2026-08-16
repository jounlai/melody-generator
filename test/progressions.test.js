import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHORD_VOCAB } from '../src/theory.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../src/data/progressions.json');
const progressions = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

const CADENCES = ['deceptive', 'authentic', 'plagal', 'open'];

// 転回形・テンションを取り除いた基本形。
function baseForm(symbol) {
  return symbol.replace(/(M7|7|sus4|add9)?(\/(3|5|7))?$/, '');
}

test('進行はちょうど99件', () => {
  assert.ok(Array.isArray(progressions));
  assert.equal(progressions.length, 99);
});

test('メジャー55件・マイナー44件', () => {
  const major = progressions.filter((p) => p.mode === 'major');
  const minor = progressions.filter((p) => p.mode === 'minor');
  assert.equal(major.length, 55);
  assert.equal(minor.length, 44);
  assert.equal(major.length + minor.length, progressions.length);
});

test('id は p01〜p99 で重複なし', () => {
  const ids = progressions.map((p) => p.id);
  assert.equal(new Set(ids).size, 99);
  const expected = Array.from({ length: 99 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
  assert.deepEqual([...ids].sort(), expected.sort());
  for (const id of ids) assert.match(id, /^p\d{2}$/);
});

test('bars は必ず4小節', () => {
  for (const p of progressions) {
    assert.ok(Array.isArray(p.bars), `${p.id}: bars は配列`);
    assert.equal(p.bars.length, 4, `${p.id}: bars が4要素ではない`);
    for (const bar of p.bars) {
      assert.equal(typeof bar.chord, 'string', `${p.id}: chord が文字列ではない`);
    }
  }
});

test('全コード記号が CHORD_VOCAB[mode] に含まれる', () => {
  for (const p of progressions) {
    const vocab = CHORD_VOCAB[p.mode];
    assert.ok(vocab, `${p.id}: 未知の mode ${p.mode}`);
    for (const bar of p.bars) {
      assert.ok(
        vocab.includes(bar.chord),
        `${p.id}: 語彙外のコード ${bar.chord} (mode=${p.mode})`,
      );
    }
  }
});

test('tension は4要素で各1〜5', () => {
  for (const p of progressions) {
    assert.ok(Array.isArray(p.tension), `${p.id}: tension は配列`);
    assert.equal(p.tension.length, 4, `${p.id}: tension が4要素ではない`);
    for (const t of p.tension) {
      assert.ok(Number.isInteger(t), `${p.id}: tension が整数ではない (${t})`);
      assert.ok(t >= 1 && t <= 5, `${p.id}: tension が範囲外 (${t})`);
    }
  }
});

test('cadence は4種類のいずれか', () => {
  for (const p of progressions) {
    assert.ok(CADENCES.includes(p.cadence), `${p.id}: 未知の cadence ${p.cadence}`);
  }
});

test('サブドミナントマイナーを含む進行が5件以上ある', () => {
  const sdm = progressions.filter(
    (p) => p.mode === 'major' && p.bars.some((b) => baseForm(b.chord) === 'iv'),
  );
  assert.ok(sdm.length >= 5, `サブドミナントマイナーが ${sdm.length} 件しかない`);
});

test('偽終止が3件以上ある', () => {
  const deceptive = progressions.filter((p) => p.cadence === 'deceptive');
  assert.ok(deceptive.length >= 3, `偽終止が ${deceptive.length} 件しかない`);
});

test('同一の進行が重複していない', () => {
  const keys = progressions.map((p) => `${p.mode}|${p.bars.map((b) => b.chord).join(' ')}`);
  const seen = new Set();
  for (const key of keys) {
    assert.ok(!seen.has(key), `重複した進行: ${key}`);
    seen.add(key);
  }
  assert.equal(seen.size, 99);
});
