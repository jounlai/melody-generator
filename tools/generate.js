// 2小節(8拍)のメロディー断片を大量に生成する。
// ここでの役割は「そこそこ筋の通った候補を、多様に、大量に」作ること。
// 美しさの選抜は後段の別モジュールが行う。
//
// 音符: { deg: 1〜15, beat: 0〜8, dur: 拍数, vel: 0〜1 }
// deg は通しスケール度数(1=トニック, 8=1oct上, 15=2oct上)。
// 乱数はすべて引数の rng を経由する(Math.random は使わない)。

import { randInt, pick } from '../src/rng.js';

const BEATS = 8;
const BAR = 4;
const MIN_DEG = 1;
const MAX_DEG = 15;

// 前半1小節(0〜4拍)の形をそのまま後半へコピーする。
// 「内部モチーフの反復」は曲としての求心力に直結するので、
// カタログの半分以上をこの形で作る。
function mirror(bar) {
  return bar.concat(bar.map((n) => ({ b: n.b + BAR, d: n.d })));
}

// リズム型カタログ。各要素は {b: 開始拍, d: 長さ拍} の配列。
// 制約: b+d<=8 / 重ならない / 音数4〜9 / 最短0.5拍。
// ヒーリング系なのでロングトーン(2〜3拍)と間を多めに含める。
export const RHYTHMS = [
  // --- 前半と後半が同形(モチーフ反復) ---
  mirror([{ b: 0, d: 2 }, { b: 2, d: 2 }]),
  mirror([{ b: 0, d: 3 }, { b: 3, d: 1 }]),
  mirror([{ b: 0, d: 1 }, { b: 1, d: 1 }, { b: 2, d: 2 }]),
  mirror([{ b: 0, d: 2 }, { b: 2, d: 1 }, { b: 3, d: 1 }]),
  mirror([{ b: 0, d: 1 }, { b: 1, d: 2 }, { b: 3, d: 1 }]),
  mirror([{ b: 0, d: 1.5 }, { b: 1.5, d: 0.5 }, { b: 2, d: 2 }]),
  mirror([{ b: 0, d: 0.5 }, { b: 0.5, d: 1.5 }, { b: 2, d: 2 }]),
  mirror([{ b: 0, d: 0.5 }, { b: 0.5, d: 0.5 }, { b: 1, d: 1 }, { b: 2, d: 2 }]),
  mirror([{ b: 0, d: 1 }, { b: 1, d: 0.5 }, { b: 1.5, d: 0.5 }, { b: 2, d: 2 }]),
  mirror([{ b: 0, d: 2 }, { b: 2, d: 0.5 }, { b: 2.5, d: 0.5 }, { b: 3, d: 1 }]),

  // --- 通しで書き下ろす型(終わりに向けて開く/閉じる) ---
  [{ b: 0, d: 1 }, { b: 1, d: 1 }, { b: 2, d: 2 }, { b: 4, d: 3 }, { b: 7, d: 1 }],
  [{ b: 0, d: 2 }, { b: 2, d: 2 }, { b: 4, d: 1 }, { b: 5, d: 1 }, { b: 6, d: 2 }],
  [{ b: 0, d: 1.5 }, { b: 1.5, d: 0.5 }, { b: 2, d: 1 }, { b: 3, d: 1 }, { b: 4, d: 4 }],
  [{ b: 0, d: 3 }, { b: 3, d: 1 }, { b: 4, d: 1 }, { b: 5, d: 0.5 }, { b: 5.5, d: 0.5 }, { b: 6, d: 2 }],
  [{ b: 0, d: 2 }, { b: 2, d: 1.5 }, { b: 3.5, d: 0.5 }, { b: 4, d: 2 }, { b: 6, d: 1 }, { b: 7, d: 1 }],
  [{ b: 0, d: 1 }, { b: 1, d: 1 }, { b: 2, d: 1 }, { b: 3, d: 1 }, { b: 4, d: 1 }, { b: 5, d: 1 }, { b: 6, d: 2 }],
  [{ b: 0, d: 0.5 }, { b: 0.5, d: 0.5 }, { b: 1, d: 1 }, { b: 2, d: 1 }, { b: 3, d: 1 }, { b: 4, d: 2 }, { b: 6, d: 2 }],
  [{ b: 0, d: 1 }, { b: 1, d: 0.5 }, { b: 1.5, d: 0.5 }, { b: 2, d: 2 }, { b: 4, d: 1.5 }, { b: 5.5, d: 0.5 }, { b: 6, d: 2 }],
];

// 0.0〜1.0 に正規化した高さの推移。線形補間して使う。
export const CONTOUR_SHAPE = {
  arch: [0, 0.4, 1.0, 0.6, 0.1],
  descend: [1.0, 0.7, 0.45, 0.2, 0.0],
  ascend: [0.0, 0.25, 0.5, 0.75, 1.0],
  wave: [0.3, 0.9, 0.2, 0.8, 0.3],
  question: [0.2, 0.5, 0.35, 0.7, 0.6],
  answer: [0.6, 0.8, 0.5, 0.3, 0.0],
};

const CONTOUR_NAMES = Object.keys(CONTOUR_SHAPE);

function clampDeg(deg) {
  return Math.min(MAX_DEG, Math.max(MIN_DEG, deg));
}

// shape を t(0〜1)で線形補間する。
function lerpShape(shape, t) {
  const u = Math.min(1, Math.max(0, t));
  const x = u * (shape.length - 1);
  const i = Math.min(Math.floor(x), shape.length - 2);
  return shape[i] + (shape[i + 1] - shape[i]) * (x - i);
}

// 跳躍(5度以上)の直後に同方向へ3以上動くのを潰す。
// 跳躍の連発は最も強い減点対象なので、生成時点で反転させておく。
function smoothLeaps(degs) {
  for (let i = 1; i < degs.length - 1; i++) {
    const d1 = degs[i] - degs[i - 1];
    if (Math.abs(d1) < 5) continue;
    const d2 = degs[i + 1] - degs[i];
    if (Math.abs(d2) < 3 || Math.sign(d2) !== Math.sign(d1)) continue;
    degs[i + 1] = clampDeg(degs[i] - d2);
  }
  return degs;
}

// 輪郭テンプレートに沿った長さ n の度数列を作る。
// opts: { lo, span } 省略時は lo=randInt(2,6), span=randInt(4,9)。
export function buildDegrees(rng, contour, n, opts = {}) {
  const shape = CONTOUR_SHAPE[contour] || CONTOUR_SHAPE.arch;
  const lo = opts.lo === undefined ? randInt(rng, 2, 6) : opts.lo;
  const span = opts.span === undefined ? randInt(rng, 4, 9) : opts.span;

  const degs = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const target = lerpShape(shape, t);
    const jitter = (rng() - 0.5) * 1.2;
    degs.push(clampDeg(Math.round(lo + target * span + jitter)));
  }
  return smoothLeaps(degs);
}

// 掛留の種: 頭の音を次の音の1つ上に置き換える。
// 後段で「2-1 で解決する掛留」として検出・加点される最重要要素。
function seedSuspension(degs, at) {
  const next = at + 1;
  if (next >= degs.length) return;
  const cand = degs[next] + 1;
  if (cand <= MAX_DEG) degs[at] = cand;
}

// 高い音ほどやや強く。0.55〜0.85 に収める。
function velocityFor(rng, deg, minDeg, maxDeg) {
  const range = maxDeg - minDeg;
  const t = range === 0 ? 0.5 : (deg - minDeg) / range;
  const v = 0.55 + t * 0.3 + (rng() - 0.5) * 0.04;
  return Math.round(Math.min(0.85, Math.max(0.55, v)) * 1000) / 1000;
}

export function generateCandidate(rng) {
  const contour = pick(rng, CONTOUR_NAMES);
  const rhythm = pick(rng, RHYTHMS);
  const degs = buildDegrees(rng, contour, rhythm.length);

  if (rng() < 0.35) {
    seedSuspension(degs, 0);
    const barTwo = rhythm.findIndex((r) => r.b >= BAR);
    if (barTwo > 0) seedSuspension(degs, barTwo);
  }

  const minDeg = Math.min(...degs);
  const maxDeg = Math.max(...degs);
  const notes = rhythm.map((r, i) => ({
    deg: degs[i],
    beat: r.b,
    dur: r.d,
    vel: velocityFor(rng, degs[i], minDeg, maxDeg),
  }));

  return { notes, contour };
}
