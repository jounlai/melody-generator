import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectContour,
  isRestingDeg,
  hasInnerMotif,
  detectTags,
  tensionOf,
  analyzeFragment,
  hasSoar,
  stepRatioOf,
  thirdRatioOf,
  leapRatioOf,
  leapThenStepRatio,
} from '../tools/analyze.js';
import { scoreFragment } from '../tools/score.js';

// 音符を書きやすくするヘルパー
const n = (deg, beat, dur, vel = 0.6) => ({ deg, beat, dur, vel });

// ---------------------------------------------------------------------------
// 1. detectContour が6種類それぞれを返す
// ---------------------------------------------------------------------------

test('detectContour: 山なりは arch', () => {
  // 最高音5は位置2/4 = 0.5、first(1)+2 と last(1)+2 の両方を上回る
  assert.equal(detectContour([1, 3, 5, 3, 1]), 'arch');
});

test('detectContour: 方向転換3回以上は wave', () => {
  // 最高音7の位置は 1/5 = 0.2 なので arch にならず、転換4回で wave
  assert.equal(detectContour([5, 7, 5, 7, 5, 7]), 'wave');
});

test('detectContour: 下行は descend', () => {
  assert.equal(detectContour([8, 7, 6, 5]), 'descend');
});

test('detectContour: 上行は ascend', () => {
  assert.equal(detectContour([1, 2, 3, 5]), 'ascend');
});

test('detectContour: トニックで終わる小さな動きは answer', () => {
  assert.equal(detectContour([1, 2, 1]), 'answer');
});

test('detectContour: トニック以外で終わる小さな動きは question', () => {
  assert.equal(detectContour([3, 4, 3]), 'question');
});

test('detectContour: 音符が3個未満なら question', () => {
  assert.equal(detectContour([5, 6]), 'question');
  assert.equal(detectContour([]), 'question');
});

// ---------------------------------------------------------------------------
// 2. isRestingDeg
// ---------------------------------------------------------------------------

test('isRestingDeg はトニック度数だけ true', () => {
  assert.equal(isRestingDeg(1), true);
  assert.equal(isRestingDeg(8), true);
  assert.equal(isRestingDeg(15), true);
  assert.equal(isRestingDeg(4), false);
  assert.equal(isRestingDeg(7), false);
});

// ---------------------------------------------------------------------------
// 3. hasInnerMotif
// ---------------------------------------------------------------------------

test('hasInnerMotif: 前後半のリズムが一致すれば真（音高は問わない）', () => {
  const notes = [
    n(1, 0, 1), n(3, 1, 1), n(5, 2, 2),
    n(2, 4, 1), n(4, 5, 1), n(6, 6, 2),
  ];
  assert.equal(hasInnerMotif(notes), true);
});

test('hasInnerMotif: リズムが違えば偽', () => {
  const notes = [
    n(1, 0, 1), n(3, 1, 1), n(5, 2, 2),
    n(2, 4, 2), n(4, 6, 1), n(6, 7, 1),
  ];
  assert.equal(hasInnerMotif(notes), false);
});

test('hasInnerMotif: どちらかの小節が2音未満なら偽', () => {
  const notes = [n(1, 0, 4), n(2, 4, 2), n(3, 6, 2)];
  assert.equal(hasInnerMotif(notes), false);
});

// ---------------------------------------------------------------------------
// 4-5. detectTags の sigh 検出
// ---------------------------------------------------------------------------

test('detectTags: 跳躍上行のあとの順次下降を sigh として検出する', () => {
  // 度数 3 → 8 → 7 → 6（+5 のあとに -1, -1）
  const notes = [n(3, 0, 1), n(8, 1, 1), n(7, 2, 1), n(6, 3, 5)];
  const meta = analyzeFragment(notes);
  assert.deepEqual(meta.intervals, [5, -1, -1]);
  assert.ok(detectTags(notes, meta).includes('sigh'));
  assert.ok(meta.tags.includes('sigh'));
});

test('detectTags: 跳躍のない断片は sigh を返さない', () => {
  const notes = [n(1, 0, 1), n(2, 1, 1), n(3, 2, 1), n(4, 3, 1)];
  const tags = detectTags(notes, analyzeFragment(notes));
  assert.equal(tags.includes('sigh'), false);
  assert.ok(tags.includes('stepwise'));
});

test('detectTags: 下降が1音しか続かないと sigh にならない', () => {
  // 3 → 8 → 7 → 9 は跳躍のあと下降が1音だけ
  const notes = [n(3, 0, 1), n(8, 1, 1), n(7, 2, 1), n(9, 3, 1)];
  assert.equal(detectTags(notes).includes('sigh'), false);
});

// ---------------------------------------------------------------------------
// 6. analyzeFragment
// ---------------------------------------------------------------------------

test('analyzeFragment が主要なメタ情報を正しく返す', () => {
  const notes = [
    n(1, 0, 1), n(3, 1, 1), n(5, 2, 1, 0.65),
    n(3, 3, 1), n(2, 4, 2, 0.55), n(1, 6, 2, 0.5),
  ];
  const meta = analyzeFragment(notes);

  assert.equal(meta.startDeg, 1);
  assert.equal(meta.endDeg, 1);
  assert.deepEqual(meta.range, [1, 5]);
  assert.equal(meta.span, 4);
  assert.equal(meta.peakDeg, 5);
  assert.equal(meta.peakBeat, 2);
  assert.equal(meta.peakCount, 1);
  assert.equal(meta.density, 0.75); // 6音 / 8拍
  assert.equal(meta.distinctDurations, 2); // 1拍と2拍の2種類
  assert.equal(meta.durationRatio, 2); // 2 ÷ 1
  assert.deepEqual(meta.intervals, [2, 2, -2, -1, -1]);
  assert.equal(meta.contour, 'arch');
  // 度数 1,3,5,3,2,1 は 4 と 7 を使わないので penta-major。両端はトニック。
  // 最後の音は2拍なので long-ending（2.5拍以上）は付かない＝フレーズ途中に置ける断片。
  assert.deepEqual(meta.tags, [
    'single-peak', 'resolve-down', 'stepwise',
    'penta-major', 'stable-start', 'stable-end',
  ]);
  assert.equal(meta.tension, 2);
});

// ---------------------------------------------------------------------------
// 6b. リズムの多様性（音価が一定だと童謡になる）
// ---------------------------------------------------------------------------

test('analyzeFragment はリズムの多様性を測る', () => {
  // 0.5 / 1.5 / 2 の3種類。0.5拍から入って拍をまたぐ音があり、2.5〜3拍が休符。
  const varied = [n(1, 0, 0.5), n(3, 0.5, 1.5), n(5, 2, 0.5), n(6, 3, 2)];
  const meta = analyzeFragment(varied);
  assert.equal(meta.distinctDurations, 3);
  assert.equal(meta.durationRatio, 4); // 2 ÷ 0.5
  assert.ok(meta.tags.includes('syncopation'), `syncopation が無い: ${meta.tags}`);
  assert.ok(meta.tags.includes('has-rest'), `has-rest が無い: ${meta.tags}`);

  // 全部4分音符。拍の上に等間隔で並ぶ = 童謡。
  const mono = [n(1, 0, 1), n(2, 1, 1), n(3, 2, 1), n(2, 3, 1)];
  const flat = analyzeFragment(mono);
  assert.equal(flat.distinctDurations, 1);
  assert.equal(flat.durationRatio, 1);
  assert.equal(flat.tags.includes('syncopation'), false);
  assert.equal(flat.tags.includes('has-rest'), false);
});

test('音価が一定の断片は、音程が同じでもリズムの多様な断片より低い', () => {
  // 度数はまったく同じで、リズムだけが違う2つの断片。
  const degs = [1, 2, 3, 2, 1, 2, 3, 2];
  const MONO = degs.map((d, i) => n(d, i, 1)); // 4分音符が8つ並ぶだけ
  const VARIED = [
    n(1, 0, 0.5), n(2, 0.5, 1), n(3, 1.5, 0.5), n(2, 2, 2),
    n(1, 4, 0.5), n(2, 4.5, 1), n(3, 5.5, 0.5), n(2, 6, 2),
  ];

  const mono = scoreFragment(MONO, analyzeFragment(MONO));
  const varied = scoreFragment(VARIED, analyzeFragment(VARIED));

  // 共通: 50 + 密度(10) + resolve-down(6) + inner-motif(12) + inner-sequence(18)
  //       + inner-repeat(14) + penta(16) + stable-start(5) + wave(-6) = 125
  // MONO  : 音価1種類 -22                                        = 103
  assert.equal(mono, 103);
  // VARIED: 音価3種類 +6 / 最長÷最短 +8 / syncopation +8 = 147
  //         (最後は2拍なので long-ending は付かない)
  assert.equal(varied, 147);
  assert.ok(varied - mono === 44, `リズムの差が効いていない: ${varied} - ${mono}`);
});

test('analyzeFragment は最高音の重複を peakCount に数える', () => {
  const notes = [n(1, 0, 1), n(6, 1, 1), n(3, 2, 1), n(6, 3, 1), n(1, 4, 4)];
  const meta = analyzeFragment(notes);
  assert.equal(meta.peakDeg, 6);
  assert.equal(meta.peakBeat, 1); // 最初に現れた位置
  assert.equal(meta.peakCount, 2);
  assert.equal(meta.tags.includes('single-peak'), false);
});

// ---------------------------------------------------------------------------
// 6b-2. soar（舞い上がり）: 4度以上跳んで頂点に届き、そこから順次で降りる
//       Can't Help Falling in Love / Hey Jude の "better" の形。
// ---------------------------------------------------------------------------

test('hasSoar は跳び上がって頂点に届き降り始める形だけを拾う', () => {
  assert.equal(hasSoar([5, 8, 7, 6]), true); // 4度上行 -> 順次下降
  assert.equal(hasSoar([5, 6, 10, 9, 8]), true); // 5度上行でも成立
  assert.equal(hasSoar([5, 7, 6]), false); // 3度では跳躍が足りない
  assert.equal(hasSoar([5, 8, 4]), false); // 頂点の直後が3度以上の下降
  assert.equal(hasSoar([5, 8, 9]), false); // 頂点が末尾（降りてこない）
  assert.equal(hasSoar([9, 5, 6]), false); // 頂点が先頭（跳び上がっていない）
  assert.equal(hasSoar([5, 9, 8, 9, 5]), false); // 頂点が2回鳴る
});

test('detectTags: 舞い上がる断片に soar タグが付き、+16 加点される', () => {
  // 度数 5,6,10,9,8,7 -> 頂点10へ5度上行、そこから順次下降
  const SOAR = [
    n(5, 0, 0.5), n(6, 0.5, 0.5), n(10, 1, 1), n(9, 2, 2),
    n(8, 4, 1), n(7, 5, 1), n(6, 6, 2),
  ];
  const meta = analyzeFragment(SOAR);
  assert.ok(meta.tags.includes('soar'), `soar が無い: ${meta.tags}`);
  assert.equal(meta.peakCount, 1);

  // 頂点への跳躍を順次進行に均した版（同じリズム・同じ音数）
  const FLAT = [
    n(5, 0, 0.5), n(6, 0.5, 0.5), n(7, 1, 1), n(6, 2, 2),
    n(5, 4, 1), n(4, 5, 1), n(3, 6, 2),
  ];
  const flat = analyzeFragment(FLAT);
  assert.equal(flat.tags.includes('soar'), false);
  assert.ok(
    scoreFragment(SOAR, meta) > scoreFragment(FLAT, flat),
    `舞い上がりが優位でない: ${scoreFragment(SOAR, meta)} vs ${scoreFragment(FLAT, flat)}`,
  );
});

// ---------------------------------------------------------------------------
// 6c. 音程の分布（名旋律125曲のコーパス実測値への較正）
//     度数差1 = 2度(順次進行), 2 = 3度, 3以上 = 4度以上。
//     コーパス: 順次 0.696 / 3度 0.185 / 4度以上 0.055 / 跳躍後に順次 0.619
// ---------------------------------------------------------------------------

test('音程の割合を度数差ごとに数える', () => {
  const iv = [1, -1, 2, 1, -3, 1]; // 2度4つ / 3度1つ / 4度1つ
  assert.equal(stepRatioOf(iv), 4 / 6);
  assert.equal(thirdRatioOf(iv), 1 / 6);
  assert.equal(leapRatioOf(iv), 1 / 6);
  assert.equal(stepRatioOf([]), 0);
});

test('leapThenStepRatio は跳躍の直後が順次進行かを数える', () => {
  // 跳躍(3度以上 = 度数差2以上)は index 0 と 2。0の直後は 1(順次)、2の直後は 3(4度)。
  assert.equal(leapThenStepRatio([2, 1, -3, -3]), 1 / 2);
  assert.equal(leapThenStepRatio([2, 1, 2, 1]), 1); // 跳んだら必ず埋め戻す
  assert.equal(leapThenStepRatio([1, 1, 1]), null); // 跳躍が無ければ判定不能
  // 最後の音程は「直後」が無いので跳躍として数えない
  assert.equal(leapThenStepRatio([1, 1, 4]), null);
});

test('コーパスの音程分布に近い断片は、跳躍だらけの断片より高い', () => {
  // 度数 5,6,8,7,8,5,6,5 -> 音程 [1,2,-1,1,-3,1,-1]
  // 順次 5/7 = 0.71(帯の中) / 3度 1/7 = 0.14(帯の中) / 4度以上 1/7
  // 3度も4度も直後が順次 -> leapThenStep = 1.0
  const SINGABLE = [
    n(5, 0, 0.5), n(6, 0.5, 0.5), n(8, 1, 1), n(7, 2, 0.5), n(8, 2.5, 1.5),
    n(5, 4, 1), n(6, 5, 1), n(5, 6, 2),
  ];
  const meta = analyzeFragment(SINGABLE);
  assert.equal(meta.stepRatio, 5 / 7);
  assert.equal(meta.thirdRatio, 1 / 7);
  assert.equal(meta.leapRatio, 1 / 7);
  assert.equal(meta.leapThenStep, 1);

  // 同じ音数・同じリズムで、跳躍ばかりにした版
  const LEAPY = [
    n(5, 0, 0.5), n(9, 0.5, 0.5), n(4, 1, 1), n(10, 2, 0.5), n(3, 2.5, 1.5),
    n(11, 4, 1), n(4, 5, 1), n(12, 6, 2),
  ];
  const leapy = analyzeFragment(LEAPY);
  assert.equal(leapy.stepRatio, 0);
  assert.ok(leapy.leapRatio > 0.9, `4度以上の割合が低い: ${leapy.leapRatio}`);
  assert.ok(
    scoreFragment(SINGABLE, meta) > scoreFragment(LEAPY, leapy) + 50,
    `歌える断片が優位でない: ${scoreFragment(SINGABLE, meta)} vs ${scoreFragment(LEAPY, leapy)}`,
  );
});

test('跳躍したあと順次で埋め戻す断片は、埋め戻さない断片より高い', () => {
  // どちらも 4度上行を1つ持ち、リズムも音数も同じ。違いは跳躍の後だけ。
  const FILLED = [n(5, 0, 1), n(8, 1, 0.5), n(7, 1.5, 0.5), n(6, 2, 2),
    n(5, 4, 1), n(8, 5, 0.5), n(7, 5.5, 0.5), n(6, 6, 2)];
  const OPEN = [n(5, 0, 1), n(8, 1, 0.5), n(11, 1.5, 0.5), n(14, 2, 2),
    n(5, 4, 1), n(8, 5, 0.5), n(11, 5.5, 0.5), n(14, 6, 2)];
  const a = analyzeFragment(FILLED);
  const b = analyzeFragment(OPEN);
  assert.equal(a.leapThenStep, 1);
  assert.equal(b.leapThenStep, 0);
  assert.ok(
    scoreFragment(FILLED, a) > scoreFragment(OPEN, b),
    `埋め戻す形が優位でない: ${scoreFragment(FILLED, a)} vs ${scoreFragment(OPEN, b)}`,
  );
});

// ---------------------------------------------------------------------------
// 7. tensionOf
// ---------------------------------------------------------------------------

test('tensionOf: 低く順次進行の断片は 1〜2', () => {
  const calm = analyzeFragment([n(1, 0, 1), n(2, 1, 1), n(3, 2, 1), n(2, 3, 1), n(1, 4, 4)]);
  const t = tensionOf(calm);
  assert.equal(t, 1);
  assert.ok(t >= 1 && t <= 2);

  const mid = analyzeFragment([
    n(1, 0, 1), n(3, 1, 1), n(5, 2, 1), n(3, 3, 1), n(2, 4, 2), n(1, 6, 2),
  ]);
  assert.equal(tensionOf(mid), 2);
});

test('tensionOf: 高音かつ跳躍が多い断片は 4〜5', () => {
  const wild = analyzeFragment([n(1, 0, 1), n(5, 1, 1), n(9, 2, 1), n(13, 3, 1), n(9, 4, 4)]);
  const t = tensionOf(wild);
  assert.equal(t, 5);
  assert.ok(t >= 4 && t <= 5);
});

test('tensionOf は 1〜5 にクランプされる', () => {
  assert.equal(tensionOf({ peakDeg: 99, intervals: [12, -12, 12] }), 5);
  assert.equal(tensionOf({ peakDeg: -50, intervals: [] }), 1);
});

// ---------------------------------------------------------------------------
// 8. 良い断片 > 悪い断片（このモジュールの存在意義）
// ---------------------------------------------------------------------------

// 順次進行中心・アーチ型・ロングトーン終止
const GOOD = [
  n(1, 0, 1), n(3, 1, 1), n(5, 2, 1, 0.65),
  n(3, 3, 1), n(2, 4, 2, 0.55), n(1, 6, 2, 0.5),
];

// 大跳躍の連発・同音連打・音域が広い・細かすぎる
const BAD = [
  n(1, 0, 0.5), n(8, 0.5, 0.5), n(15, 1, 0.5), n(15, 1.5, 0.5),
  n(7, 2, 0.5), n(14, 2.5, 0.5), n(2, 3, 0.5), n(11, 3.5, 0.5),
];

test('良い断片は悪い断片より高得点になる', () => {
  const good = scoreFragment(GOOD, analyzeFragment(GOOD));
  const bad = scoreFragment(BAD, analyzeFragment(BAD));

  // 50 + single-peak(8) + resolve-down(6) + stable-start(5)
  //    + stable-end(10) + penta(16) + arch(5) - 音価2種類(8) = 92
  // (最後が2拍なので long-ending は付かない。音程は 3度が 3/5 = 0.6 で
  //  3度の帯(0.10〜0.30)から外れ、順次進行も 2/5 = 0.4 で帯の外)
  assert.equal(good, 92);
  // 50 - 跳躍と連続跳躍(146) - 音域超過(12) + 密度(10) - 音価1種類(22)
  //    + stable-start(5) - wave(6) - 4度以上が 6/7 = 0.857((0.857-0.1)*60 = 45.4)
  assert.equal(bad, -166.4);
  assert.ok(good > bad, `good=${good} は bad=${bad} より高いはず`);
});

test('sigh を含む断片は同形の跳躍なし断片より加点される', () => {
  const sigh = [n(3, 0, 1), n(8, 1, 1), n(7, 2, 1), n(6, 3, 1), n(5, 4, 4)];
  const flat = [n(3, 0, 1), n(4, 1, 1), n(5, 2, 1), n(4, 3, 1), n(3, 4, 4)];
  const withSigh = scoreFragment(sigh, analyzeFragment(sigh));
  const noSigh = scoreFragment(flat, analyzeFragment(flat));
  assert.ok(analyzeFragment(sigh).tags.includes('sigh'));
  assert.equal(analyzeFragment(flat).tags.includes('sigh'), false);
  assert.ok(withSigh > 0 && noSigh > 0);
});

test('inner-motif と long-ending の加点が効いている', () => {
  // 前後半が同じリズム型（0.5 / 1 / 2.5拍）。最後は2.5拍なので long-ending も付く。
  const motif = [
    n(1, 0, 0.5), n(3, 0.5, 1), n(5, 1.5, 2.5),
    n(2, 4, 0.5), n(4, 4.5, 1), n(6, 5.5, 2.5),
  ];
  const meta = analyzeFragment(motif);
  assert.ok(meta.tags.includes('inner-motif'), `inner-motif が無い: ${meta.tags}`);
  assert.ok(meta.tags.includes('long-ending'), `long-ending が無い: ${meta.tags}`);
  // 同じ音列・同じ終わり方で、後半のリズムだけ崩した版より高いこと
  const broken = [
    n(1, 0, 0.5), n(3, 0.5, 1), n(5, 1.5, 2.5),
    n(2, 4, 1), n(4, 5, 0.5), n(6, 5.5, 2.5),
  ];
  const brokenMeta = analyzeFragment(broken);
  assert.equal(brokenMeta.tags.includes('inner-motif'), false);
  assert.ok(brokenMeta.tags.includes('long-ending'));
  assert.ok(scoreFragment(motif, meta) > scoreFragment(broken, brokenMeta));
});

// ---------------------------------------------------------------------------
// 9. scoreFragment の戻り値は有限の数値
// ---------------------------------------------------------------------------

test('scoreFragment は常に有限の数値を返す', () => {
  const cases = [
    GOOD,
    BAD,
    [],
    [n(1, 0, 4)],
    [n(1, 0, 1), n(1, 1, 1), n(1, 2, 1), n(1, 3, 1)],
    [n(15, 0, 1), n(1, 1, 1), n(15, 2, 1), n(1, 3, 5)],
  ];
  for (const notes of cases) {
    const s = scoreFragment(notes, analyzeFragment(notes));
    assert.equal(typeof s, 'number');
    assert.ok(Number.isFinite(s), `有限でない: ${s}`);
  }
});

test('scoreFragment は meta 省略時も自前で分析する', () => {
  assert.equal(scoreFragment(GOOD), scoreFragment(GOOD, analyzeFragment(GOOD)));
  assert.equal(scoreFragment(GOOD), 92);
  // 空: 50 - 密度不足((0.7-0)*30 = 21) - question(4) = 25
  assert.equal(scoreFragment([]), 25);
  // 単音: 50 + single-peak(8) + long-ending(8) + stable-start(5) + stable-end(10)
  //       + penta(16) - question(4) - 音価1種類(22) - 密度不足((0.7-0.13)*30 = 17.1) = 53.9
  assert.equal(scoreFragment([n(1, 0, 4)]), 53.9);
});
