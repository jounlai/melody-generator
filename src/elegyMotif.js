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
const MOTIF_RHYTHMS = [
  // 語りかけるように。3音置いて、伸ばす
  [{ b: 0, d: 1 }, { b: 1, d: 0.5 }, { b: 1.5, d: 1.5 }, { b: 4, d: 2 }, { b: 6, d: 1.5 }],
  // 弱起。半拍遅れて歌い出す
  [{ b: 0.5, d: 1.5 }, { b: 2, d: 1 }, { b: 3, d: 1 }, { b: 4.5, d: 1.5 }, { b: 6, d: 1.5 }],
  // 白玉から動く
  [{ b: 0, d: 2 }, { b: 2, d: 1 }, { b: 3, d: 0.5 }, { b: 4, d: 1.5 }, { b: 6, d: 2 }],
  // 付点8分＋16分（この1つだけ）
  [{ b: 0, d: 0.75 }, { b: 0.75, d: 0.25 }, { b: 1, d: 1 }, { b: 2, d: 2 },
    { b: 4, d: 1.5 }, { b: 5.5, d: 0.5 }, { b: 6, d: 1.5 }],
  // 間を大きく取る
  [{ b: 0, d: 1.5 }, { b: 1.5, d: 0.5 }, { b: 2, d: 1.5 }, { b: 4, d: 1 }, { b: 5, d: 2 }],
];

// 主動機の輪郭（度数の相対列、先頭0）。
// 「静かに受け入れる」ので、上って一歩下がる形か、下って収まる形を中心にする。
const MOTIF_SHAPES = [
  [0, 1, 2, 1, -1],      // 上って、戻って、下へ収まる
  [0, -1, 1, 0, -2],     // 一度沈んでから、また沈む
  [0, 2, 1, -1, -2],     // 3度上がって、順次で降りる
  [0, 1, -1, -2, -3],    // 一歩上がってから、長く降りる
  [0, -2, -1, 0, -3],    // 下がって戻って、最後に落ちる
];

/** 動機をひとつ作る。 */
export function makeMotif(rng) {
  const rhythm = MOTIF_RHYTHMS[Math.floor(rng() * MOTIF_RHYTHMS.length)];
  const raw = MOTIF_SHAPES[Math.floor(rng() * MOTIF_SHAPES.length)];
  // リズムの音数に形を合わせる（足りなければ最後の動きを繰り返して伸ばす）
  const shape = [];
  for (let i = 0; i < rhythm.length; i += 1) {
    if (i < raw.length) shape.push(raw[i]);
    else shape.push(raw[raw.length - 1] + (i - raw.length + 1) * -1);
  }
  return { rhythm: rhythm.map((r) => ({ ...r })), shape, tag: 'motif' };
}

// 変奏のリズム。元と同じ音数のものだけを使う（形を保つため）。
function otherRhythm(rng, motif) {
  const same = MOTIF_RHYTHMS.filter((r) => r.length === motif.rhythm.length
    && r.map((x) => x.b).join() !== motif.rhythm.map((x) => x.b).join());
  if (same.length === 0) {
    // 音数の合う別の型が無ければ、打点を後ろへずらして作る（弱起にする）
    const shifted = motif.rhythm.map((r, i) => (i === 0
      ? { b: r.b + 0.5, d: Math.max(0.25, r.d - 0.5) }
      : { ...r }));
    return shifted;
  }
  return same[Math.floor(rng() * same.length)].map((r) => ({ ...r }));
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
    const shape = motif.shape.slice(0, rhythm.length);
    while (shape.length < rhythm.length) shape.push(shape[shape.length - 1]);
    return { rhythm, shape, tag: `var:rhythm` };
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

export { MOTIF_RHYTHMS, MOTIF_SHAPES };
