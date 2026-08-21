// 主動機と、その変奏。
//
// 変奏は「リズム・方向・終止音のうち**ひとつだけ**」を変える。
// ひとつだけなら耳は元の形を追える。全部変えると別の動機になってしまう。
//
// 動機は「度数の相対列 + リズム」で持つ。実音にするのは配置のとき。
// そうしておくと、和音が変わっても同じ形として置き直せる。

import { RANGE } from './elegy.js';

const { BEATS_PER_BAR } = RANGE;

// 主動機のリズムの候補（2小節ぶん）。
//
// 「別れを静かに受け入れる」ので、音数は少なく、間を置き、フレーズ末で伸ばす。
// 付点8分＋16分は定型として乱用しないよう、候補のうち1つだけに留める。
// どの型も、4小節のうちに休符が入るよう最後を短く切るか、途中を空けてある。
// リズムには2つの家系がある。
//
// !!! 全部を「長い音で閉じる」型にしてはいけない !!!
// そうすると2小節ごとに息が切れ、32小節に16回のため息が並ぶだけになる。
// 「青春の影」も「愛は勝つ」も、フレーズは一息で8小節を歌い切る一文で、
// 長い音が来るのはその終わりだけ。文の途中で息を継いだら文にならない。
//
// flowing : フレーズの途中。最後の音を短く切って、次の小節へ渡す
// closing : フレーズの終わり。長く伸ばして息を継ぐ
const FLOWING_RHYTHMS = [
  [{ b: 0, d: 1 }, { b: 1, d: 1 }, { b: 2, d: 1 }, { b: 3, d: 1 },
    { b: 4, d: 1.5 }, { b: 5.5, d: 0.5 }, { b: 6, d: 1 }, { b: 7, d: 1 }],
  [{ b: 0, d: 1.5 }, { b: 1.5, d: 0.5 }, { b: 2, d: 1 }, { b: 3, d: 1 },
    { b: 4, d: 1 }, { b: 5, d: 1 }, { b: 6, d: 1.5 }, { b: 7.5, d: 0.5 }],
  [{ b: 0, d: 1 }, { b: 1, d: 0.5 }, { b: 1.5, d: 1.5 }, { b: 3, d: 1 },
    { b: 4, d: 1 }, { b: 5, d: 1 }, { b: 6, d: 1 }, { b: 7, d: 1 }],
  [{ b: 1, d: 1 }, { b: 2, d: 1 }, { b: 3, d: 1 },
    { b: 4, d: 1.5 }, { b: 5.5, d: 0.5 }, { b: 6, d: 1 }, { b: 7, d: 1 }],
  // !!! 音数の違う型を必ず混ぜること !!!
  // 上の4型はどれも7〜8音で、変奏が「同じ音数の別の型」しか選べなかったため、
  // 32小節が実質2つのリズムだけで埋まった（9回と8回、あわせて17小節）。
  // 音数が散らばっていれば、変奏のたびに刻みの密度そのものが動く。
  [{ b: 0, d: 2 }, { b: 2, d: 1 }, { b: 3, d: 1 },
    { b: 4, d: 2 }, { b: 6, d: 1 }, { b: 7, d: 1 }],
  [{ b: 0, d: 1.5 }, { b: 1.5, d: 2.5 }, { b: 4, d: 1 }, { b: 5, d: 2 }, { b: 7, d: 1 }],
  [{ b: 1, d: 1 }, { b: 2, d: 2 }, { b: 4, d: 1.5 }, { b: 5.5, d: 0.5 },
    { b: 6, d: 1 }, { b: 7, d: 1 }],
  [{ b: 0, d: 1 }, { b: 1, d: 2 }, { b: 3, d: 1 }, { b: 4, d: 1 },
    { b: 5, d: 0.5 }, { b: 5.5, d: 1.5 }, { b: 7, d: 1 }],
  [{ b: 0, d: 1 }, { b: 1, d: 1 }, { b: 2, d: 0.5 }, { b: 2.5, d: 0.5 }, { b: 3, d: 1 },
    { b: 4, d: 1 }, { b: 5, d: 1 }, { b: 6, d: 1 }, { b: 7, d: 1 }],
];

const CLOSING_RHYTHMS = [
  [{ b: 0, d: 1 }, { b: 1, d: 1 }, { b: 2, d: 1 }, { b: 3, d: 1 }, { b: 4, d: 4 }],
  [{ b: 0, d: 1.5 }, { b: 1.5, d: 0.5 }, { b: 2, d: 2 }, { b: 4, d: 3.5 }],
  [{ b: 0, d: 1 }, { b: 1, d: 1 }, { b: 2, d: 2 }, { b: 4, d: 1 }, { b: 5, d: 3 }],
  [{ b: 1, d: 1 }, { b: 2, d: 1 }, { b: 3, d: 1 }, { b: 4, d: 4 }],
];

const MOTIF_RHYTHMS = [...FLOWING_RHYTHMS, ...CLOSING_RHYTHMS];

// 主動機の輪郭（度数の相対列、先頭0）。
// 「静かに受け入れる」ので、上って一歩下がる形か、下って収まる形を中心にする。
// 8小節の一文としての輪郭。フレーズは長いので、形も長く持つ。
//
// !!! 上下の幅は3歩まで、往復（… 1 0 1 …）を作らないこと !!!
// 幅を超えると音域を突き抜け、往復だと線が前へ進まない。
//
// 「青春の影」「愛は勝つ」のように一息で歌い切る線は、途中で戻らずに
// ゆっくり登るか、ゆっくり降りる。山はフレーズにひとつだけ。
const MOTIF_SHAPES = [
  [0, 1, 2, 3, 2, 1, 0, -1],     // ゆっくり登って、ゆっくり降りる
  [0, -1, -2, -3, -2, -1, 0, 1], // 沈んでから、登り返す
  [0, 1, 1, 2, 3, 2, 1, 0],      // 溜めてから登り、収める
  [0, -1, -1, -2, -3, -2, -1, 0],// 溜めてから降り、戻る
  [0, 2, 3, 2, 1, 0, -1, -2],    // 早く登って、長く降りる
  [0, 1, 2, 2, 3, 3, 2, 1],      // 二段で登る（サビの形）
];

/**
 * 形を n 個に伸縮する。位置で線形に補間するので、輪郭の山谷は保たれる。
 * 「最後の動きを繰り返す」やり方だと、伸ばした先で形が壊れて音域を突き抜けた。
 */
export function fitShape(raw, n) {
  if (raw.length === n) return raw.slice();
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0 : (i * (raw.length - 1)) / (n - 1);
    const lo = Math.floor(t);
    const hi = Math.min(raw.length - 1, lo + 1);
    out.push(Math.round(raw[lo] + (raw[hi] - raw[lo]) * (t - lo)));
  }
  return out;
}

/** 動機をひとつ作る。 */
export function makeMotif(rng) {
  const rhythm = FLOWING_RHYTHMS[Math.floor(rng() * FLOWING_RHYTHMS.length)];
  const raw = MOTIF_SHAPES[Math.floor(rng() * MOTIF_SHAPES.length)];
  // リズムの音数に形を合わせる。
  // 足りなければ間引き、多ければ形を引き伸ばして補う（線の形は保つ）。
  const shape = fitShape(raw, rhythm.length);
  return { rhythm: rhythm.map((r) => ({ ...r })), shape, tag: 'motif' };
}

// 変奏のリズム。
//
// 音数が変わってもよい。形（度数の相対列）は fitShape で伸縮できるので、
// 輪郭は保たれる。同じ音数に縛っていたときは、7音の型が1つしか無いため
// 変奏が毎回もとの型へ戻ってしまっていた。
// 閉じる型は選ばない——フレーズの途中で息を継ぐことになるから。
function otherRhythm(rng, motif) {
  const key = (r) => r.map((x) => `${x.b}:${x.d}`).join();
  const mine = key(motif.rhythm);
  const others = FLOWING_RHYTHMS.filter((r) => key(r) !== mine);
  if (others.length === 0) return motif.rhythm.map((r) => ({ ...r }));
  return others[Math.floor(rng() * others.length)].map((r) => ({ ...r }));
}

/**
 * 変奏を1つ作る。変えるのは kind ひとつだけ。
 *   'rhythm'  リズムだけ変える（音形はそのまま）
 *   'mirror'  方向だけ変える（上下を反転。リズムはそのまま）
 *   'ending'  終止音だけ変える（途中はそのまま）
 */
export function varyMotif(motif, kind, rng) {
  if (kind === 'rhythm') {
    const rhythm = otherRhythm(rng, motif);
    return { rhythm, shape: fitShape(motif.shape, rhythm.length), tag: 'var:rhythm' };
  }
  if (kind === 'mirror') {
    return {
      rhythm: motif.rhythm.map((r) => ({ ...r })),
      shape: motif.shape.map((v) => -v),
      tag: 'var:mirror',
    };
  }
  // ending: 最後の1〜2音だけ差し替える
  const shape = motif.shape.slice();
  const last = shape.length - 1;
  const dir = shape[last] >= shape[last - 1] ? -1 : 1;
  shape[last] = shape[last - 1] + dir * (1 + Math.floor(rng() * 2));
  return { rhythm: motif.rhythm.map((r) => ({ ...r })), shape, tag: 'var:ending' };
}

/**
 * 動機の断片化。前半1小節だけを取り出す（回想で使う）。
 */
export function fragmentMotif(motif) {
  const rhythm = motif.rhythm.filter((r) => r.b < BEATS_PER_BAR).map((r) => ({ ...r }));
  if (rhythm.length < 2) return null;
  return {
    rhythm,
    shape: motif.shape.slice(0, rhythm.length),
    tag: 'var:fragment',
  };
}

/**
 * 動機の拡大。音価を1.5倍にして、ゆっくり歌い直す（喪失で使う）。
 * 2小節に収まらない音は落とす。
 */
export function augmentMotif(motif) {
  const rhythm = [];
  for (const r of motif.rhythm) {
    const b = r.b * 1.5;
    if (b >= 2 * BEATS_PER_BAR) break;
    rhythm.push({ b, d: Math.min(r.d * 1.5, 2 * BEATS_PER_BAR - b) });
  }
  if (rhythm.length < 2) return null;
  return { rhythm, shape: motif.shape.slice(0, rhythm.length), tag: 'var:augment' };
}

export { MOTIF_RHYTHMS, MOTIF_SHAPES, FLOWING_RHYTHMS, CLOSING_RHYTHMS };
