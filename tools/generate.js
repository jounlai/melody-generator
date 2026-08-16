// 2小節(8拍)のメロディー断片を大量に生成する。
// ここでの役割は「そこそこ筋の通った候補を、多様に、大量に」作ること。
// 美しさの選抜は後段の別モジュールが行う。
//
// 音符: { deg: 1〜15, beat: 0〜8, dur: 拍数, vel: 0〜1 }
// deg は通しスケール度数(1=トニック, 8=1oct上, 15=2oct上)。
// 乱数はすべて引数の rng を経由する(Math.random は使わない)。
//
// 設計の柱は4つ。優先順位の高い順に:
//   1. 旋律型  : バッハからJ-POPまで共通の一般的な旋律語彙(FORMULAS)から組み立てる。
//                輪郭が合っていても中身が音楽の語彙になっていないと、
//                「ランダムな音程の並び」にしか聴こえない。
//   2. リズム  : 音価が均一だと、音程が何であろうと童謡にしか聴こえない。
//                1つの型のなかで長い音と短い音を混ぜ(3種類以上の音価)、
//                シンコペーション・休符・弱起・付点で拍から音をずらす。
//                密度は2小節6〜16音。
//   3. 動機    : 後半1小節を前半の平行移動(ゼクエンツ)や完全反復にする。
//                形が反復されて初めて「メロディー」として記憶される。
//   4. 大衆性  : ペンタトニック(五音音階)へ寄せる。J-POP・童謡・民謡を貫く
//                「口ずさめる」の核心。ただし旋律型の形のほうが優先。

import { randInt, pick, shuffle } from '../src/rng.js';

const BAR = 4;
const MIN_DEG = 1;
const MAX_DEG = 15;

// [開始拍, 長さ拍] の組を {b,d} へ。リズム表を読みやすく保つためだけの糖衣。
const cell = (pairs) => pairs.map(([b, d]) => ({ b, d }));

// 前半1小節(0〜4拍)の形をそのまま後半へコピーする。
// 「内部モチーフの反復」は曲としての求心力に直結するので、
// カタログの6〜7割をこの形で作る。
function mirror(bar) {
  return bar.concat(bar.map((n) => ({ b: n.b + BAR, d: n.d })));
}

// ---------------------------------------------------------------------------
// リズム型カタログ
// ---------------------------------------------------------------------------
// 「音程の長さが一定過ぎて童謡に聴こえる」を潰すのがこの表の役目。
// 8分音符が延々と並ぶ型・4分音符だけの型・等間隔の型は1つも置かない。
//
// 全型が満たす制約:
//   - b+d<=8 / 重ならない / 最短0.25拍(16分は装飾として型あたり2〜3音まで)
//   - 音価が3種類以上ある(同じ長さの音ばかりの型を作らない)
//   - 最長音価 ÷ 最短音価 >= 3 (2.0拍と0.5拍が同居するくらいの落差)
//   - 最後の音は 1.5拍以上(フレーズの息継ぎ)
//   - 音数は2小節あたり6〜16音
// 表全体では シンコペーション40%以上 / 休符30%以上 / 弱起25%以上 /
// 付点(1.5+0.5, 0.75+0.25)を含む型6個以上。

// 後半1小節が前半とまったく同じ形の型。ゼクエンツ・完全反復はここからしか引かない。
// mirror するので、1小節目の最後の音がそのまま断片の最後の音になる。
// つまり各小節が「動く区間 + 息継ぎのロングトーン」の形になり、
// 小節の中で「詰まって、伸びる」対比が生まれる。
export const MOTIF_RHYTHMS = [
  // --- 素直に流れて伸びる ---
  mirror(cell([[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]])), // 8
  mirror(cell([[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]])), // 8
  mirror(cell([[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 1.5]])), // 10 シンコペ
  mirror(cell([[0, 0.5], [0.5, 1.5], [2, 2]])), // 6 シンコペ
  mirror(cell([[0, 2], [2, 0.5], [2.5, 1.5]])), // 6 シンコペ
  // --- 付点(1.5+0.5 / 0.75+0.25) ---
  mirror(cell([[0, 1.5], [1.5, 0.5], [2, 2]])), // 6 付点
  mirror(cell([[0, 0.75], [0.75, 0.25], [1, 0.5], [1.5, 0.5], [2, 2]])), // 10 付点+16分
  mirror(cell([[0, 0.5], [0.5, 0.5], [1, 0.75], [1.75, 0.25], [2, 2]])), // 10 付点+16分
  mirror(cell([[0, 0.75], [0.75, 0.25], [1, 0.5], [1.5, 2.5]])), // 8 付点+16分 シンコペ
  // --- シンコペーション(拍の裏から入って拍をまたぐ) ---
  mirror(cell([[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 2]])), // 8 シンコペ
  mirror(cell([[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 0.5], [2.5, 1.5]])), // 10 シンコペ
  mirror(cell([[0, 1], [1, 0.5], [1.5, 1], [2.5, 1.5]])), // 8 シンコペ
  // --- 休符(音と音のあいだを空ける) ---
  mirror(cell([[0, 1], [1, 0.5], [2, 0.5], [2.5, 1.5]])), // 8 休符+シンコペ
  mirror(cell([[0, 1], [1.5, 0.5], [2, 2]])), // 6 休符
  mirror(cell([[0, 0.5], [1, 0.5], [1.5, 1], [2.5, 1.5]])), // 8 休符+シンコペ
  // --- 弱起(短い音から入って、次の拍の頭に長い音で着地) ---
  mirror(cell([[0.5, 0.5], [1, 1], [2, 2]])), // 6 弱起+休符
  mirror(cell([[0.5, 0.5], [1, 1], [2, 0.5], [2.5, 1.5]])), // 8 弱起+休符+シンコペ
  mirror(cell([[0, 0.5], [1, 1], [2, 2]])), // 6 弱起+休符
  mirror(cell([[0.75, 0.25], [1, 1], [2, 0.5], [2.5, 1.5]])), // 8 弱起+休符+シンコペ+16分
  mirror(cell([[0, 0.25], [1, 1], [2, 0.5], [2.5, 1.5]])), // 8 弱起+休符+シンコペ+16分
  mirror(cell([[0.5, 0.25], [1, 1], [2, 0.5], [2.5, 1.5]])), // 8 弱起+休符+シンコペ+16分
  mirror(cell([[0, 0.5], [1, 1], [2, 0.5], [2.5, 1.5]])), // 8 弱起+休符+シンコペ
  mirror(cell([[0.5, 0.5], [1, 0.5], [1.5, 1], [2.5, 1.5]])), // 8 休符+シンコペ
  // --- 密(12音)。細かい動きのあとに必ず伸びる音が来る ---
  mirror(cell([[0, 0.5], [0.5, 0.5], [1, 0.75], [1.75, 0.25], [2, 0.5], [2.5, 1.5]])), // 12 付点+シンコペ
  mirror(cell([[0, 0.75], [0.75, 0.25], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 1.5]])), // 12 付点+シンコペ
];

// 通しで書き下ろす型。終わりに向けて開く/閉じる。
// 最後の1音だけがロングトーンなので、途中はモチーフ型より自由に動ける。
export const FREE_RHYTHMS = [
  // --- 密(10〜13音) ---
  cell([[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 0.5], [5.5, 0.5], [6, 0.5], [6.5, 1.5]]), // 13 シンコペ
  cell([[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1], [3, 0.75], [3.75, 0.25],
    [4, 0.5], [4.5, 0.5], [5, 0.5], [5.5, 0.5], [6, 2]]), // 12 付点+16分
  cell([[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]]), // 10
  cell([[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 0.5], [2.5, 1], [3.5, 0.5],
    [4, 0.5], [4.5, 1], [5.5, 0.5], [6, 2]]), // 10 シンコペ
  cell([[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 1],
    [4.5, 0.5], [5, 0.5], [5.5, 0.5], [6, 2]]), // 10 シンコペ
  cell([[0, 0.5], [0.5, 0.5], [1, 0.75], [1.75, 0.25], [2, 1], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]]), // 10 付点+16分
  // --- 中(7〜9音) ---
  cell([[0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]]), // 9 弱起+休符
  cell([[0.75, 0.25], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]]), // 9 弱起+休符+16分
  cell([[0, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1],
    [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]]), // 9 弱起+休符
  cell([[0, 1], [1, 0.5], [1.5, 0.5], [2, 1.5], [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]]), // 8 休符
  cell([[0, 1], [1, 1], [2, 1.5], [4, 0.5], [4.5, 0.5], [5, 0.5], [5.5, 0.5], [6, 2]]), // 8 休符
  cell([[0, 1], [2, 0.5], [2.5, 0.5], [3, 1], [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]]), // 8 休符
  cell([[0, 1.5], [1.5, 0.5], [2, 1], [3, 1], [4, 1.5], [5.5, 0.5], [6, 2]]), // 7 付点
  // --- 疎(6〜7音。対比と終止用) ---
  cell([[0, 2], [2, 1], [3, 1], [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]]), // 7
  cell([[0.5, 0.5], [1, 1], [2, 0.5], [2.5, 1.5], [4.5, 0.5], [5, 1], [6, 2]]), // 7 弱起+休符+シンコペ
  cell([[0, 1], [1, 0.5], [1.5, 1.5], [3.5, 0.5], [4, 2], [6, 0.5], [6.5, 1.5]]), // 7 休符+シンコペ
];

export const RHYTHMS = [...MOTIF_RHYTHMS, ...FREE_RHYTHMS];

// リズム型の抽選。大衆的なメロディーは反復が多いので、
// 後半が前半と同形の型を優先的に引く(6〜7割)。
export const MOTIF_RATE = 0.65;

export function pickRhythm(rng) {
  return rng() < MOTIF_RATE ? pick(rng, MOTIF_RHYTHMS) : pick(rng, FREE_RHYTHMS);
}

// ---------------------------------------------------------------------------
// 旋律型ライブラリ
// ---------------------------------------------------------------------------
// 最初の音からの度数オフセットで持つ。こうすると任意の高さに置ける。
// 順次進行系と刺繍音系の重みが高いのは、名曲のメロディーの過半数が
// 順次進行でできているという統計的事実に合わせているため。
// 特定の曲のものではなく、バッハからJ-POPまで共通の一般的な語彙。

export const FORMULAS = [
  // --- 順次上行（歌い出しの定番）---
  { id: 'asc-scale', steps: [0, 1, 2, 3], weight: 3 },
  { id: 'asc-1235', steps: [0, 1, 2, 4], weight: 4 }, // ド-レ-ミ-ソ
  { id: 'asc-scale5', steps: [0, 1, 2, 3, 4], weight: 3 },
  // --- 順次下行（終止の定番）---
  { id: 'desc-54321', steps: [0, -1, -2, -3, -4], weight: 4 }, // ソ-ファ-ミ-レ-ド
  { id: 'desc-321', steps: [0, -1, -2], weight: 4 }, // ミ-レ-ド
  { id: 'desc-8765', steps: [0, -1, -2, -3], weight: 3 },
  // --- アルペジオ（和音を歌う）---
  { id: 'arp-up', steps: [0, 2, 4], weight: 3 }, // ド-ミ-ソ
  { id: 'arp-up-oct', steps: [0, 2, 4, 7], weight: 2 }, // ド-ミ-ソ-ド
  { id: 'arp-down', steps: [0, -2, -4], weight: 2 },
  { id: 'arp-updown', steps: [0, 2, 4, 2], weight: 3 },
  // --- 刺繍音・回音（最も頻出。歌の「揺れ」を作る）---
  { id: 'neighbor-up', steps: [0, 1, 0], weight: 4 }, // ミ-ファ-ミ
  { id: 'neighbor-dn', steps: [0, -1, 0], weight: 4 },
  { id: 'turn', steps: [0, 1, 0, -1, 0], weight: 3 }, // 回音
  { id: 'turn-down', steps: [0, 1, 0, -1, -2], weight: 4 }, // 回音から下降して着地
  // --- 跳躍してから順次で埋め戻す（「ため息」の形。泣ける）---
  { id: 'leap6-fill', steps: [0, 5, 4, 3, 2], weight: 4 }, // 6度上行→順次下降
  { id: 'leap-oct-fill', steps: [0, 7, 6, 5], weight: 3 }, // オクターブ上行→下降
  { id: 'leap4-fill', steps: [0, 3, 2, 1], weight: 3 },
  // --- 跳ね返り（上がって下がって戻る）---
  { id: 'arch-small', steps: [0, 1, 2, 1, 0], weight: 3 },
  { id: 'arch-mid', steps: [0, 2, 3, 2, 0], weight: 3 },
  // --- 同音反復から動く（語りかけの形）---
  { id: 'repeat-then-up', steps: [0, 0, 1, 2], weight: 3 },
  { id: 'repeat-then-down', steps: [0, 0, -1, -2], weight: 3 },
  // --- 終止形（フレーズの締め）---
  { id: 'cadence-231', steps: [0, -1, -3], weight: 3 },
  { id: 'cadence-171', steps: [0, -1, 0], weight: 2 },
];

// フレーズを閉じるための型。2小節目を「着地」で終える経路で使う。
export const CADENCE_FORMULAS = FORMULAS.filter((f) => /^(cadence|desc)-/.test(f.id));

/** 重み付きで旋律型を1つ引く */
export function pickFormula(rng, pool = FORMULAS) {
  const list = pool.length > 0 ? pool : FORMULAS;
  let total = 0;
  for (const f of list) total += f.weight;
  let r = rng() * total;
  for (const f of list) {
    r -= f.weight;
    if (r < 0) return f;
  }
  return list[list.length - 1];
}

/**
 * 旋律型をつないで長さ n の相対度数列(先頭 0)を作る。
 * 型を継ぎ足すときは前の型の終点を次の型の起点として共有する。
 * 返り値の used は採用した型の id(統計とテスト用)。
 */
export function formulaLine(rng, n, pool = FORMULAS) {
  const rel = [0];
  const used = [];
  let guard = 0;

  while (rel.length < n && guard++ < 8) {
    const room = n - rel.length + 1; // 起点を共有するぶん +1
    const fits = pool.filter((f) => f.steps.length <= room);
    const f = pickFormula(rng, fits.length > 0 ? fits : pool);
    used.push(f.id);
    const base = rel[rel.length - 1];
    for (let i = 1; i < f.steps.length && rel.length < n; i++) {
      rel.push(base + f.steps[i] - f.steps[0]);
    }
  }
  // 保険(型が尽きるほど長いリズムは無いが、念のため順次で埋める)
  while (rel.length < n) rel.push(rel[rel.length - 1] + (rel.length % 2 === 0 ? 1 : -1));

  return { rel: rel.slice(0, n), used };
}

// ---------------------------------------------------------------------------
// 輪郭テンプレート(旋律型を使わない経路)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ペンタトニック
// ---------------------------------------------------------------------------

// スケール度数(1〜7)で表したペンタトニック。
export const PENTA_DEGS = {
  major: [1, 2, 3, 5, 6], // 4 と 7 を使わない
  minor: [1, 3, 4, 5, 7], // 2 と 6 を使わない
};
const PENTA_SET = {
  major: new Set(PENTA_DEGS.major),
  minor: new Set(PENTA_DEGS.minor),
};

// 歌い出し・着地として安定する度数(主和音の構成音)。
const STABLE_SET = new Set([1, 3, 5]);
const STABLE_STARTS = [3, 5, 8, 10]; // 度数3〜10のうち {1,3,5} に当たるもの

// 音階外の音を寄せる先。第1候補は半音距離が近い側。
// major: 4は3へ(半音1つ下)、7は8へ(半音1つ上)。minor: 2は3へ、6は5へ。
const SNAP_MOVES = {
  major: { 4: [-1, 1], 7: [1, -1] },
  minor: { 2: [1, -1], 6: [-1, 1] },
};

// 生成の配分。30%は7音すべてを使う断片として残す(陰影と多様性のため)。
export const PENTA_RATES = { major: 0.45, minor: 0.25, none: 0.3 };

/** 'major' | 'minor' | null をこの配分で引く */
export function drawPenta(rng) {
  const r = rng();
  if (r < PENTA_RATES.major) return 'major';
  if (r < PENTA_RATES.major + PENTA_RATES.minor) return 'minor';
  return null;
}

function clampDeg(deg) {
  return Math.min(MAX_DEG, Math.max(MIN_DEG, deg));
}

function scaleDeg(deg) {
  return ((((deg - 1) % 7) + 7) % 7) + 1;
}

/** deg がスケール度数の集合 allowed に含まれるか */
function inSet(deg, allowed) {
  return allowed.has(scaleDeg(deg));
}

/** deg から dir 方向へ探して、最初に見つかる allowed の音を返す(無ければ null) */
function nextInSet(deg, dir, allowed) {
  for (let d = deg + dir; d >= MIN_DEG && d <= MAX_DEG; d += dir) {
    if (inSet(d, allowed)) return d;
  }
  return null;
}

/**
 * 度数列を allowed(スケール度数の集合)へ寄せる。
 * 寄せた結果うまれた同音連打はほどく(同音連打は減点対象)。
 * moves は「スケール度数 -> 移動候補」。無ければ近い側から総当たりで探す。
 */
function snapToSet(degs, allowed, moves) {
  const out = degs.slice();

  for (let i = 0; i < out.length; i++) {
    if (inSet(out[i], allowed)) continue;

    const prev = i > 0 ? out[i - 1] : null;
    const options = [];
    const mv = moves && moves[scaleDeg(out[i])];
    if (mv) {
      for (const m of mv) options.push(out[i] + m);
    } else {
      // 近い順に候補を並べる(同距離なら下側を先に)
      for (let r = 1; r <= 7; r++) options.push(out[i] - r, out[i] + r);
    }

    let chosen = null;
    let fallback = null;
    for (const cand of options) {
      if (cand < MIN_DEG || cand > MAX_DEG || !inSet(cand, allowed)) continue;
      if (fallback === null) fallback = cand;
      if (cand === prev) continue; // 同音連打は作らない
      chosen = cand;
      break;
    }
    out[i] = chosen ?? fallback ?? out[i];
  }

  for (let i = 1; i < out.length; i++) {
    if (out[i] !== out[i - 1]) continue;
    if (degs[i] === degs[i - 1]) continue; // もともと同音なら触らない
    const dir = degs[i] > degs[i - 1] ? 1 : -1;
    const alt = nextInSet(out[i], dir, allowed) ?? nextInSet(out[i], -dir, allowed);
    if (alt !== null) out[i] = alt;
  }

  return out;
}

/** 度数列をペンタトニックへスナップする */
export function snapToPenta(degs, kind) {
  const allowed = PENTA_SET[kind];
  if (!allowed) return degs.slice();
  return snapToSet(degs, allowed, SNAP_MOVES[kind]);
}

/** ペンタトニックから外れている音の数 */
function offPentaCount(degs, kind) {
  if (!kind) return 0;
  const set = PENTA_SET[kind];
  let n = 0;
  for (const d of degs) if (!set.has(scaleDeg(d))) n++;
  return n;
}

/**
 * 旋律型を作ったあとのスナップ。
 * ずれる音が3音以上になるとき(型が大きく崩れるとき)はスナップを諦める。
 * 形のほうが優先で、ペンタトニックは形を壊してまで取りに行かない。
 */
const SNAP_TOLERANCE = 2;

function snapKeepingShape(degs, kind) {
  if (!kind) return degs.slice();
  if (offPentaCount(degs, kind) > SNAP_TOLERANCE) return degs.slice();
  return snapToPenta(degs, kind);
}

// ---------------------------------------------------------------------------
// 度数列(輪郭ベース)
// ---------------------------------------------------------------------------

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

/**
 * 輪郭テンプレートに沿った長さ n の度数列を作る。
 * opts: { lo, span } 省略時は lo=randInt(1,6), span=randInt(3,10)。
 *
 * 補間値をそのまま丸めるのではなく、目標へ「歩いて」寄せる。
 * 単純な丸めだと音数が増えたときに同じ音が並んで線が止まり、
 * 「音程が並んでいるだけ」に聴こえる。常に動く線にするのが要点。
 */
export function buildDegrees(rng, contour, n, opts = {}) {
  const shape = CONTOUR_SHAPE[contour] || CONTOUR_SHAPE.arch;
  const lo = opts.lo === undefined ? randInt(rng, 1, 6) : opts.lo;
  const span = opts.span === undefined ? randInt(rng, 3, 10) : opts.span;

  const degs = [];
  let prev = null;
  let dir = 1;

  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    // jitter は ±0.3。大きく振ると輪郭が溶けて形が記憶に残らない。
    const target = clampDeg(Math.round(lo + lerpShape(shape, t) * span + (rng() - 0.5) * 0.6));

    if (prev === null) {
      degs.push(target);
      prev = target;
      continue;
    }

    const diff = target - prev;
    let next;
    if (diff === 0) {
      // 目標に居座る区間は刺繍音で動かす。たまに3度動かして単調な往復を崩す。
      next = prev + dir * (rng() < 0.3 ? 2 : 1);
    } else if (Math.abs(diff) <= 2) {
      next = target;
    } else if (rng() < 0.25) {
      next = target; // 一気に跳ぶ(sigh の種)
    } else {
      next = prev + Math.sign(diff) * 2; // ふだんは2度ずつ寄せる
    }

    next = clampDeg(next);
    if (next === prev) next = clampDeg(prev + (prev >= MAX_DEG ? -1 : 1));
    dir = next > prev ? -1 : 1; // 刺繍音は向きを交互に
    degs.push(next);
    prev = next;
  }

  return smoothLeaps(degs);
}

// スナップ → 跳躍ならし → 再スナップ。
// 跳躍ならしは音階外の音を作りうるので、最後にもう一度寄せる。
function pentaize(degs, kind) {
  if (!kind) return degs.slice();
  return snapToPenta(smoothLeaps(snapToPenta(degs, kind)), kind);
}

// ---------------------------------------------------------------------------
// 置き場所(開始音)の決定
// ---------------------------------------------------------------------------

/**
 * 相対度数列 rel を実際の度数に置くときの開始音を選ぶ。
 * - 1〜15 に収まること(収まらない置き方はそもそも候補にしない)
 * - want に近いこと(want は「3〜10、6割は安定音」で引いた希望)
 * - ペンタトニックから外れる音が少ないこと(型を崩さずに音階へ寄せるため)
 * - endStable なら最後の音が {1,3,5} に着地すること
 */
function placeStart(rel, want, kind, endStable = false) {
  const min = Math.min(...rel);
  const max = Math.max(...rel);
  const lo = Math.max(MIN_DEG, MIN_DEG - min);
  const hi = Math.min(MAX_DEG, MAX_DEG - max);
  if (lo > hi) return clampDeg(want); // 15度に収まらない形は諦めてクランプ

  let best = null;
  for (let s = lo; s <= hi; s++) {
    const last = s + rel[rel.length - 1];
    const cost = offPentaCount(rel.map((r) => s + r), kind) * 3
      + Math.abs(s - want)
      + (endStable && !STABLE_SET.has(scaleDeg(last)) ? 8 : 0);
    if (best === null || cost < best.cost) best = { s, cost };
  }
  return best.s;
}

/** 歌い出しの希望。度数3〜10、6割は安定音 {1,3,5}。 */
function drawStart(rng) {
  return rng() < 0.6 ? pick(rng, STABLE_STARTS) : randInt(rng, 3, 10);
}

// ---------------------------------------------------------------------------
// ゼクエンツ(平行移動)
// ---------------------------------------------------------------------------

export const SEQ_OFFSETS = [-2, -1, 1, 2];

// オフセット off で平行移動してもペンタトニックに留まるスケール度数の集合。
// 例: major で off=+1 なら {1,2,5}(1→2, 2→3, 5→6)。
// 先にこの集合へ寄せてから平行移動すれば、前後半とも音階内で、
// かつ全音が同じオフセットになる = 動機として完全なゼクエンツになる。
function seqSet(kind, off) {
  const set = PENTA_SET[kind];
  const out = new Set();
  for (const s of set) {
    const moved = ((((s - 1 + off) % 7) + 7) % 7) + 1;
    if (set.has(moved)) out.add(s);
  }
  return out;
}

// 輪郭テンプレートの後半が前半より高いか低いか。
// ゼクエンツを上へ動かすか下へ動かすかをこれで決める。
function shapeDirection(contour) {
  const shape = CONTOUR_SHAPE[contour] || CONTOUR_SHAPE.arch;
  return lerpShape(shape, 0.75) >= lerpShape(shape, 0.25) ? 1 : -1;
}

/**
 * 前半 head を平行移動して後半にするオフセットを選ぶ。
 * 1〜15 に収まり、できればペンタトニックから外れないもの。
 * 同条件なら輪郭テンプレートの向きに合うものを先に採る。
 */
function chooseShift(rng, head, kind, dir) {
  const order = shuffle(rng, SEQ_OFFSETS)
    .sort((a, b) => (Math.sign(b) === dir ? 1 : 0) - (Math.sign(a) === dir ? 1 : 0));

  let fallback = 0;
  let found = false;
  for (const off of order) {
    const moved = head.map((d) => d + off);
    if (moved.some((d) => d < MIN_DEG || d > MAX_DEG)) continue;
    if (!found) {
      fallback = off;
      found = true;
    }
    if (offPentaCount(moved, kind) === 0) return off;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// 掛留・強弱
// ---------------------------------------------------------------------------

// 掛留の種: 頭の音を次の音の1つ上に置き換える。
// 後段で「2-1 で解決する掛留」として検出・加点される最重要要素。
// ペンタトニックから外れる音が入りうるが、掛留は「泣ける」の中核なので優先する。
function seedSuspension(degs, at) {
  const next = at + 1;
  if (next >= degs.length) return false;
  const cand = degs[next] + 1;
  if (cand > MAX_DEG) return false;
  degs[at] = cand;
  return true;
}

// 高い音ほどやや強く。0.55〜0.85 に収める。
function velocityFor(rng, deg, minDeg, maxDeg) {
  const range = maxDeg - minDeg;
  const t = range === 0 ? 0.5 : (deg - minDeg) / range;
  const v = 0.55 + t * 0.3 + (rng() - 0.5) * 0.04;
  return Math.round(Math.min(0.85, Math.max(0.55, v)) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// 候補1件
// ---------------------------------------------------------------------------

// 旋律型から組み立てる経路の割合。残りは輪郭ベース(多様性のために残す)。
export const FORMULA_RATE = 0.6;

// 旋律型経路で、2小節目をどう作るか。
export const BAR2_RATES = { sequence: 0.4, repeat: 0.15, cadence: 0.3, other: 0.15 };

export function drawBar2Mode(rng) {
  const r = rng();
  if (r < BAR2_RATES.sequence) return 'sequence';
  if (r < BAR2_RATES.sequence + BAR2_RATES.repeat) return 'repeat';
  if (r < BAR2_RATES.sequence + BAR2_RATES.repeat + BAR2_RATES.cadence) return 'cadence';
  return 'other';
}

// 輪郭ベース経路の内訳。
export const PATH_RATES = { repeat: 0.15, sequence: 0.35, free: 0.5 };

export function drawPath(rng) {
  const r = rng();
  if (r < PATH_RATES.repeat) return 'repeat';
  if (r < PATH_RATES.repeat + PATH_RATES.sequence) return 'sequence';
  return 'free';
}

// --- 旋律型から2小節を組む ---
function formulaCandidate(rng, kind, contour, wantSus) {
  const mode = drawBar2Mode(rng);
  const paired = mode === 'sequence' || mode === 'repeat';
  const rhythm = paired ? pick(rng, MOTIF_RHYTHMS) : pickRhythm(rng);

  const split = rhythm.findIndex((r) => r.b >= BAR);
  const n1 = split < 0 ? rhythm.length : split;
  const n2 = rhythm.length - n1;

  // 1小節目: 旋律型を継ぎ足して埋め、跳躍の連続だけならしてから音階へ寄せる。
  const first = formulaLine(rng, n1, FORMULAS);
  const used = first.used.slice();
  const start = placeStart(first.rel, drawStart(rng), kind);
  let head = snapKeepingShape(smoothLeaps(first.rel.map((r) => r + start)), kind);

  let degs;
  let shift = null;
  if (paired && n2 === n1) {
    shift = mode === 'repeat' ? 0 : chooseShift(rng, head, kind, shapeDirection(contour));
    // 掛留は平行移動の前に前半へ仕込む。後から両小節に別々に入れると
    // 平行関係が崩れて「動機」でなくなる。
    if (wantSus && head.length >= 2) {
      const cand = head[1] + 1;
      const moved = cand + shift;
      if (cand <= MAX_DEG && moved >= MIN_DEG && moved <= MAX_DEG) head[0] = cand;
    }
    degs = head.concat(head.map((d) => d + shift));
  } else {
    // 2小節目は着地(終止型)か、別の型。前の音から近いところに置く。
    const endStable = mode === 'cadence';
    const second = formulaLine(rng, n2, endStable ? CADENCE_FORMULAS : FORMULAS);
    used.push(...second.used);
    const near = clampDeg(head[head.length - 1] + (endStable ? 1 : randInt(rng, -1, 2)));
    const tailStart = placeStart(second.rel, near, kind, endStable);
    const tail = second.rel.map((r) => r + tailStart);
    degs = head.concat(snapKeepingShape(smoothLeaps(tail), kind));
    if (wantSus) {
      seedSuspension(degs, 0);
      if (n1 > 0 && n2 > 0) seedSuspension(degs, n1);
    }
  }

  return { rhythm, degs, used, path: `formula:${mode}` };
}

// --- 輪郭テンプレートから2小節を組む(多様性の担保) ---
function contourCandidate(rng, kind, contour, wantSus) {
  const mode = drawPath(rng);

  if (mode === 'free') {
    const rhythm = pickRhythm(rng);
    const degs = pentaize(buildDegrees(rng, contour, rhythm.length), kind);
    if (wantSus) {
      seedSuspension(degs, 0);
      const barTwo = rhythm.findIndex((r) => r.b >= BAR);
      if (barTwo > 0) seedSuspension(degs, barTwo);
    }
    return { rhythm, degs, used: [], path: `contour:${mode}` };
  }

  const rhythm = pick(rng, MOTIF_RHYTHMS);
  const half = rhythm.length / 2;
  const lo = randInt(rng, 2, 7);
  const span = randInt(rng, 2, 6);
  const raw = buildDegrees(rng, contour, half, { lo, span });
  const order = shuffle(rng, SEQ_OFFSETS);

  let head = pentaize(raw, kind);
  let shift = 0;
  if (mode === 'sequence') {
    for (const off of order) {
      // 平行移動しても音階内に留まる集合へ先に寄せる = 完全なゼクエンツ
      const cand = kind ? snapToSet(raw, seqSet(kind, off), null) : raw.slice();
      if (cand.every((d) => d + off >= MIN_DEG && d + off <= MAX_DEG)) {
        head = cand;
        shift = off;
        break;
      }
    }
  }

  if (wantSus && head.length >= 2) {
    const cand = head[1] + 1;
    const moved = cand + shift;
    if (cand <= MAX_DEG && moved >= MIN_DEG && moved <= MAX_DEG) head[0] = cand;
  }

  return {
    rhythm,
    degs: head.concat(head.map((d) => d + shift)),
    used: [],
    path: `contour:${mode}`,
  };
}

export function generateCandidate(rng) {
  const kind = drawPenta(rng);
  const useFormula = rng() < FORMULA_RATE;
  const contour = pick(rng, CONTOUR_NAMES);
  const wantSus = rng() < 0.35;

  const built = useFormula
    ? formulaCandidate(rng, kind, contour, wantSus)
    : contourCandidate(rng, kind, contour, wantSus);

  const degs = built.degs.map(clampDeg);
  const minDeg = Math.min(...degs);
  const maxDeg = Math.max(...degs);
  const notes = built.rhythm.map((r, i) => ({
    deg: degs[i],
    beat: r.b,
    dur: r.d,
    vel: velocityFor(rng, degs[i], minDeg, maxDeg),
  }));

  return {
    notes,
    contour,
    penta: kind,
    path: built.path,
    source: useFormula ? 'formula' : 'contour',
    formulas: built.used,
  };
}
