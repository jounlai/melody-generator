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

// --- リズムの多様性を測る道具 ---
// 音価が均一な型は、音程が何であろうと童謡にしか聴こえない。
// ここでの判定は tools/analyze.js の syncopation / has-rest と同じ定義。
const q = (v) => Math.round(v * 1e4) / 1e4;
const durationsOf = (r) => r.map((n) => q(n.d));
const distinctDurations = (r) => new Set(durationsOf(r)).size;
const durationRatio = (r) => Math.max(...durationsOf(r)) / Math.min(...durationsOf(r));

// 拍の裏から始まり、次の拍をまたいで伸びる音がある型。
const hasSyncopation = (r) => r.some((n) => q(n.b) % 1 !== 0 && n.d >= 1);

// 音と音のあいだが0.5拍以上空くか、最初の音が拍頭から遅れて入る型。
const hasRest = (r) => q(r[0].b) > 0
  || r.some((n, i) => i + 1 < r.length && q(r[i + 1].b - (n.b + n.d)) >= 0.5);

// 弱起: 短い音から入って、次の拍の頭に長い音で着地する型。
const isAnacrusis = (r) => r.length >= 2 && r[0].d <= 0.5 && q(r[1].b) % 1 === 0 && r[1].d >= 1;

// 付点のリズム(1.5+0.5 / 0.75+0.25)を含む型。
const hasDotted = (r) => r.some((n, i) => i + 1 < r.length
  && ((q(n.d) === 1.5 && q(r[i + 1].d) === 0.5)
    || (q(n.d) === 0.75 && q(r[i + 1].d) === 0.25)));

// 音が等間隔に並ぶだけの型(童謡の正体)。
const isEvenlySpaced = (r) => {
  if (r.length < 3) return false;
  return new Set(r.slice(1).map((n, i) => q(n.b - r[i].b))).size === 1;
};

const rate = (list, fn) => list.filter(fn).length / list.length;

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

test('RHYTHMS は24個以上あり、全型が制約を満たす', () => {
  assert.ok(RHYTHMS.length >= 24, `リズム型が足りない: ${RHYTHMS.length}`);
  for (const [idx, r] of RHYTHMS.entries()) {
    assert.ok(Array.isArray(r), `#${idx} が配列でない`);
    // 2小節あたり6〜16音。
    assert.ok(r.length >= 6 && r.length <= 16, `#${idx} の音数が範囲外: ${r.length}`);
    let prevEnd = 0;
    let sixteenths = 0;
    for (const n of r) {
      assert.ok(typeof n.b === 'number' && typeof n.d === 'number', `#${idx} の音が {b,d} でない`);
      assert.ok(n.d >= 0.25, `#${idx} に16分より短い音がある: ${n.d}`);
      assert.ok(q(n.b) >= q(prevEnd), `#${idx} で音が重なっている: b=${n.b} < ${prevEnd}`);
      assert.ok(n.b + n.d <= 8, `#${idx} が8拍を超える: ${n.b}+${n.d}`);
      if (n.d < 0.5) sixteenths++;
      prevEnd = n.b + n.d;
    }
    // 16分は装飾。並べると単に忙しいだけになる。
    assert.ok(sixteenths <= 3, `#${idx} の16分が多すぎる: ${sixteenths}音`);
  }
});

test('RHYTHMS は全型が3種類以上の音価を持ち、最長÷最短が3以上', () => {
  for (const [idx, r] of RHYTHMS.entries()) {
    assert.ok(
      distinctDurations(r) >= 3,
      `#${idx} の音価が ${distinctDurations(r)} 種類しかない: [${durationsOf(r).join(' ')}]`,
    );
    assert.ok(
      durationRatio(r) >= 3,
      `#${idx} の最長÷最短が ${durationRatio(r)} しかない: [${durationsOf(r).join(' ')}]`,
    );
    assert.ok(!isEvenlySpaced(r), `#${idx} は音が等間隔に並んでいる`);
  }
});

test('RHYTHMS は全型の最後の音が1.5拍以上(フレーズの息継ぎ)', () => {
  for (const [idx, r] of RHYTHMS.entries()) {
    const last = r[r.length - 1];
    assert.ok(last.d >= 1.5, `#${idx} の最終音が短い: ${last.d}`);
  }
});

test('RHYTHMS はシンコペーション40%以上・休符30%以上・弱起25%以上を含む', () => {
  const sync = rate(RHYTHMS, hasSyncopation);
  const rest = rate(RHYTHMS, hasRest);
  const anacrusis = rate(RHYTHMS, isAnacrusis);
  assert.ok(sync >= 0.4, `シンコペーションの型が少ない: ${(sync * 100).toFixed(1)}%`);
  assert.ok(rest >= 0.3, `休符を含む型が少ない: ${(rest * 100).toFixed(1)}%`);
  assert.ok(anacrusis >= 0.25, `弱起の型が少ない: ${(anacrusis * 100).toFixed(1)}%`);
});

test('RHYTHMS は付点のリズムを含む型を6個以上持つ', () => {
  const dotted = RHYTHMS.filter(hasDotted).length;
  assert.ok(dotted >= 6, `付点の型が少ない: ${dotted}`);
});

test('RHYTHMS の6割程度は後半1小節が前半と同形', () => {
  const mirrored = RHYTHMS.filter(isMirrored).length;
  const ratio = mirrored / RHYTHMS.length;
  assert.ok(ratio >= 0.55, `モチーフ反復型が少ない: ${mirrored}/${RHYTHMS.length}`);
  assert.ok(ratio <= 0.75, `モチーフ反復型が多すぎる: ${mirrored}/${RHYTHMS.length}`);
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
      // 最短音価は0.25拍(16分)。
      assert.ok(n.beat >= 0 && n.dur >= 0.25, `不正な音: ${JSON.stringify(n)}`);
      assert.ok(n.beat + n.dur <= 8, `8拍を超える: ${JSON.stringify(n)}`);
      if (k + 1 < notes.length) {
        assert.ok(n.beat + n.dur <= notes[k + 1].beat, `重なり: ${JSON.stringify(notes)}`);
      }
    }
  }
});

test('generateCandidate は音価の一定な断片を作らない', () => {
  const rng = makeRng(1234);
  let sync = 0;
  let rest = 0;
  for (let i = 0; i < 500; i++) {
    const { notes } = generateCandidate(rng);
    const r = notes.map((n) => ({ b: n.beat, d: n.dur }));
    assert.ok(
      distinctDurations(r) >= 3,
      `音価が ${distinctDurations(r)} 種類しかない: ${JSON.stringify(notes)}`,
    );
    assert.ok(durationRatio(r) >= 3, `音価の落差が小さい: ${JSON.stringify(notes)}`);
    assert.ok(r[r.length - 1].d >= 1.5, `最終音が短い: ${JSON.stringify(notes)}`);
    if (hasSyncopation(r)) sync++;
    if (hasRest(r)) rest++;
  }
  // 引く確率どおりならシンコペーション・休符はそれぞれ半数前後になる。
  assert.ok(sync >= 150, `シンコペーションが少ない: ${sync}/500`);
  assert.ok(rest >= 100, `休符が少ない: ${rest}/500`);
});

// 旋律型の経路では、開始音(その断片をどの高さに置くか)は1小節につき一度だけ決める。
// これが音ごとに決まると、音ごとに置き場所が変わって旋律型の形が壊れる。
// 「音ごとに乱数を引いていないこと」を乱数の消費回数で見張る。
// (vel は仕様上1音1回引くので、その分は差し引いて数える)
test('旋律型の断片は開始音を音ごとに引き直さない', () => {
  const byPath = new Map();
  for (let seed = 1; seed <= 2000; seed++) {
    const base = makeRng(seed);
    let draws = 0;
    const rng = () => {
      draws++;
      return base();
    };
    const cand = generateCandidate(rng);
    if (!cand.path.startsWith('formula:')) continue;
    const extra = draws - cand.notes.length; // vel のぶんを除いた消費
    if (!byPath.has(cand.path)) byPath.set(cand.path, []);
    byPath.get(cand.path).push(extra);
    assert.ok(extra <= 25, `${cand.path} が乱数を使いすぎ: ${extra} (音数 ${cand.notes.length})`);
  }
  assert.ok(byPath.size > 0, '旋律型の断片が1つも出ていない');
  for (const [path, list] of byPath) {
    const spread = Math.max(...list) - Math.min(...list);
    // 音数は6〜16音まで開くので、音ごとに引いていれば必ず10前後の差が出る。
    assert.ok(spread <= 8, `${path} の乱数消費が音数につれて増えている: 幅 ${spread}`);
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
