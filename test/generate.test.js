import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng.js';
import { RHYTHMS, CONTOUR_SHAPE, buildDegrees, generateCandidate } from '../tools/generate.js';

const SEEDS = [1, 7, 42, 99, 123, 2024, 31337, 555, 8080, 64738];

// 前半1小節(b<4)と後半1小節(b>=4)がまったく同じ形か。
function isMirrored(rhythm) {
  const first = rhythm.filter((n) => n.b < 4);
  const second = rhythm.filter((n) => n.b >= 4);
  if (first.length === 0 || first.length !== second.length) return false;
  if (first.some((n) => n.b + n.d > 4)) return false;
  return first.every((n, i) => n.b + 4 === second[i].b && n.d === second[i].d);
}

function sample(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn(i));
  return out;
}

// 10回中7回以上成立することを求める。
function assertMostly(label, results) {
  const ok = results.filter(Boolean).length;
  assert.ok(ok >= 7, `${label}: ${ok}/${results.length} 回しか成立していない`);
}

test('RHYTHMS は12個以上あり、全型が制約を満たす', () => {
  assert.ok(RHYTHMS.length >= 12, `リズム型が足りない: ${RHYTHMS.length}`);
  for (const [idx, r] of RHYTHMS.entries()) {
    assert.ok(Array.isArray(r), `#${idx} が配列でない`);
    assert.ok(r.length >= 4 && r.length <= 9, `#${idx} の音数が範囲外: ${r.length}`);
    let prevEnd = 0;
    for (const n of r) {
      assert.ok(typeof n.b === 'number' && typeof n.d === 'number', `#${idx} の音が {b,d} でない`);
      assert.ok(n.d >= 0.5, `#${idx} に8分より短い音がある: ${n.d}`);
      assert.ok(n.b >= prevEnd, `#${idx} で音が重なっている: b=${n.b} < ${prevEnd}`);
      assert.ok(n.b + n.d <= 8, `#${idx} が8拍を超える: ${n.b}+${n.d}`);
      prevEnd = n.b + n.d;
    }
  }
});

test('RHYTHMS の半分以上は後半1小節が前半と同形', () => {
  const mirrored = RHYTHMS.filter(isMirrored).length;
  assert.ok(
    mirrored * 2 >= RHYTHMS.length,
    `モチーフ反復型が少ない: ${mirrored}/${RHYTHMS.length}`,
  );
});

test('CONTOUR_SHAPE は6種類あり、値が 0〜1 に収まる', () => {
  const names = Object.keys(CONTOUR_SHAPE);
  assert.equal(names.length, 6);
  for (const name of names) {
    const shape = CONTOUR_SHAPE[name];
    assert.ok(Array.isArray(shape) && shape.length >= 2, `${name} の形が不正`);
    for (const v of shape) {
      assert.ok(v >= 0 && v <= 1, `${name} に範囲外の値: ${v}`);
    }
  }
});

test('buildDegrees は指定した長さの配列を返す', () => {
  const rng = makeRng(11);
  for (const n of [1, 2, 4, 5, 7, 9]) {
    for (const contour of Object.keys(CONTOUR_SHAPE)) {
      assert.equal(buildDegrees(rng, contour, n).length, n, `${contour} n=${n}`);
    }
  }
});

test('buildDegrees の全要素が 1〜15 の整数に収まる', () => {
  for (const seed of SEEDS) {
    const rng = makeRng(seed);
    for (const contour of Object.keys(CONTOUR_SHAPE)) {
      // 極端な lo/span を与えてもクランプされること。
      for (const opts of [{}, { lo: 1, span: 20 }, { lo: -5, span: 30 }, { lo: 14, span: 9 }]) {
        for (const deg of buildDegrees(rng, contour, 8, opts)) {
          assert.ok(Number.isInteger(deg), `整数でない: ${deg}`);
          assert.ok(deg >= 1 && deg <= 15, `範囲外: ${deg} (${contour})`);
        }
      }
    }
  }
});

test('buildDegrees(ascend) は概ね上行する', () => {
  assertMostly(
    'ascend',
    SEEDS.map((seed) => {
      const degs = buildDegrees(makeRng(seed), 'ascend', 6);
      return degs[degs.length - 1] > degs[0];
    }),
  );
});

test('buildDegrees(descend) は概ね下行する', () => {
  assertMostly(
    'descend',
    SEEDS.map((seed) => {
      const degs = buildDegrees(makeRng(seed), 'descend', 6);
      return degs[degs.length - 1] < degs[0];
    }),
  );
});

test('buildDegrees(arch) の最高音は両端でなく中間寄りにある', () => {
  assertMostly(
    'arch',
    SEEDS.map((seed) => {
      const degs = buildDegrees(makeRng(seed), 'arch', 6);
      const peak = degs.indexOf(Math.max(...degs));
      return peak > 0 && peak < degs.length - 1;
    }),
  );
});

test('generateCandidate は同じシードなら同じ結果を返す', () => {
  for (const seed of SEEDS) {
    const a = makeRng(seed);
    const b = makeRng(seed);
    for (let i = 0; i < 20; i++) {
      assert.deepEqual(generateCandidate(a), generateCandidate(b), `seed=${seed} i=${i}`);
    }
  }
});

test('generateCandidate の notes は beat 昇順', () => {
  const rng = makeRng(4649);
  for (let i = 0; i < 500; i++) {
    const { notes } = generateCandidate(rng);
    assert.ok(notes.length > 0);
    for (let k = 1; k < notes.length; k++) {
      assert.ok(notes[k].beat >= notes[k - 1].beat, `beat が降順: ${JSON.stringify(notes)}`);
    }
  }
});

test('generateCandidate の notes は重ならず 8拍に収まる', () => {
  const rng = makeRng(20260816);
  for (let i = 0; i < 500; i++) {
    const { notes } = generateCandidate(rng);
    for (let k = 0; k < notes.length; k++) {
      const n = notes[k];
      assert.ok(n.beat >= 0 && n.dur >= 0.5, `不正な音: ${JSON.stringify(n)}`);
      assert.ok(n.beat + n.dur <= 8, `8拍を超える: ${JSON.stringify(n)}`);
      if (k + 1 < notes.length) {
        assert.ok(n.beat + n.dur <= notes[k + 1].beat, `重なり: ${JSON.stringify(notes)}`);
      }
    }
  }
});

test('generateCandidate を1000回で6種類の輪郭がすべて出現する', () => {
  const rng = makeRng(777);
  const seen = new Set(sample(1000, () => generateCandidate(rng).contour));
  assert.deepEqual(
    [...seen].sort(),
    Object.keys(CONTOUR_SHAPE).sort(),
    `出現した輪郭: ${[...seen].join(',')}`,
  );
});

test('generateCandidate を1000回で deg が広く散る', () => {
  const rng = makeRng(31415);
  const degs = [];
  for (let i = 0; i < 1000; i++) {
    for (const n of generateCandidate(rng).notes) degs.push(n.deg);
  }
  const min = Math.min(...degs);
  const max = Math.max(...degs);
  assert.ok(min <= 3, `低音側が狭い: min=${min}`);
  assert.ok(max >= 12, `高音側が狭い: max=${max}`);
});

test('generateCandidate の15%以上に掛留の種が入っている', () => {
  const rng = makeRng(2718);
  let hits = 0;
  for (let i = 0; i < 1000; i++) {
    const { notes } = generateCandidate(rng);
    if (notes.length >= 2 && notes[0].deg === notes[1].deg + 1) hits++;
  }
  assert.ok(hits >= 150, `掛留の種が少ない: ${hits}/1000`);
});

test('全 vel が 0.0〜1.0 に収まる', () => {
  const rng = makeRng(8888);
  for (let i = 0; i < 1000; i++) {
    for (const n of generateCandidate(rng).notes) {
      assert.ok(typeof n.vel === 'number', `vel が数値でない: ${n.vel}`);
      assert.ok(n.vel >= 0 && n.vel <= 1, `vel が範囲外: ${n.vel}`);
    }
  }
});
