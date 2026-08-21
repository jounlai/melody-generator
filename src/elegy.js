// 「大切な人との別れを、静かに受け入れる」— C minor / 4/4 / 68BPM / 32小節のピアノ独奏。
//
// ■ これまでの生成器と何が違うか
//
// これまでは小節ごとに音符を作っていた。小節単位の多様性は出るが、曲全体として
// 旋律の因果関係が生まれない。10個の無関係な着想を並べたものは、1つ1つが
// どれだけ整っていても旋律として記憶に残らない。
//
// ここでは主題を育てる。2小節の主動機をひとつ作り、以降はすべてその変奏で
// 埋める。変奏は「リズム・方向・終止音のうち**ひとつだけ**」を変える。
// ひとつだけなら、耳は変形されても元の形を追える。全部変えると別の動機になる。
//
// ■ 4つのセクションの役割
//   1-8   提示      動機を素のまま置く。伴奏は疎らな分散和音
//   9-16  喪失      動機を翳らせる。内声を足す
//   17-24 クライマックス  動機を広げる。最高音 Ab5 はここに1回だけ
//   25-32 回想      動機を断片で思い出す。音数を減らして閉じる
//
// ■ 音域
//   旋律 Eb4(63) 〜 Ab5(80)。左手 C2(36) 〜 C4(60)。交差は禁止。

const MEL_LO = 63;   // Eb4
const MEL_HI = 80;   // Ab5
const LH_LO = 36;    // C2
const LH_HI = 60;    // C4
const TONIC = 60;    // C4 を主音の基準に取る（度数計算用）
const BEATS_PER_BAR = 4;

// C minor の自然短音階（主音からの半音）。伴奏と和声はこちらで考える。
const SCALE = [0, 2, 3, 5, 7, 8, 10];

// 旋律も七音音階（自然的短音階）で書く。
//
// !!! 五音音階（C Eb F G Bb ＝ ヨナ抜き短音階）へ寄せてはいけない !!!
// 一度そうしたが、それはまさに演歌・歌謡曲の音階で、狙いと逆方向だった。
// 現代のポップ・バラードは七音が土台で、**第2音(D)と第6音(Ab)を使うこと**が
// 演歌との違いそのものになっている。
//
// 「行って戻る」だけの往復は音階のせいではなく、動機の形と置き方の問題だった。
// そちらは形の候補と起点の選び方で直してある。
const MEL_SCALE = [0, 2, 3, 5, 7, 8, 10];

/**
 * 和声。指定どおりに小節へ割る。
 * pcs は実音のピッチクラス、bass はベースに置くピッチクラス。
 * 1小節1コードに固定せず、終止の直前だけ半小節で動かす（sus → 解決）。
 */
const CHORDS = {
  Cm: { pcs: [0, 3, 7], bass: 0, name: 'Cm' },
  'Cm/Eb': { pcs: [0, 3, 7], bass: 3, name: 'Cm/Eb' },
  'Cm/G': { pcs: [0, 3, 7], bass: 7, name: 'Cm/G' },
  'Cm(add9)': { pcs: [0, 2, 3, 7], bass: 0, name: 'Cm(add9)' },
  'Ab/Eb': { pcs: [8, 0, 3], bass: 3, name: 'Ab/Eb' },
  'Ab/G': { pcs: [8, 0, 3], bass: 7, name: 'Ab/G' },
  Abmaj7: { pcs: [8, 0, 3, 7], bass: 8, name: 'Abmaj7' },
  Fm7: { pcs: [5, 8, 0, 3], bass: 5, name: 'Fm7' },
  Fm9: { pcs: [5, 8, 0, 3, 7], bass: 5, name: 'Fm9' },
  Gsus4: { pcs: [7, 0, 2], bass: 7, name: 'Gsus4' },
  G: { pcs: [7, 11, 2], bass: 7, name: 'G' },
  G7: { pcs: [7, 11, 2, 5], bass: 7, name: 'G7' },
  G7sus4: { pcs: [7, 0, 2, 5], bass: 7, name: 'G7sus4' },
  Bb: { pcs: [10, 2, 5], bass: 10, name: 'Bb' },
  Gm7: { pcs: [7, 10, 2, 5], bass: 7, name: 'Gm7' },
};

// 32小節ぶんの和音。半小節で動くところは [前半, 後半] で書く。
export const HARMONY = [
  // 1-8 提示: Cm - Ab/Eb - Fm7 - Gsus4→G
  'Cm', 'Cm', 'Ab/Eb', 'Ab/Eb', 'Fm7', 'Fm7', 'Gsus4', ['Gsus4', 'G'],
  // 9-16 喪失: Cm/Eb - Abmaj7 - Fm9 - G7
  'Cm/Eb', 'Cm/Eb', 'Abmaj7', 'Abmaj7', 'Fm9', 'Fm9', 'G7', 'G7',
  // 17-24 クライマックス
  'Abmaj7', 'Bb', 'Gm7', 'Cm', 'Fm7', 'Ab/G', 'G7', 'Cm(add9)',
  // 25-32 回想
  'Cm/Eb', 'Abmaj7', 'Fm7', 'G7sus4', 'Cm/G', 'Abmaj7', 'G7', 'Cm(add9)',
];

/** その小節の（前半の）和音。 */
export function chordAt(bar) {
  const h = HARMONY[bar];
  return CHORDS[Array.isArray(h) ? h[0] : h];
}

/** その小節・その拍に鳴っている和音。終止直前だけ後半で変わる。 */
export function chordAtBeat(bar, beatInBar) {
  const h = HARMONY[bar];
  if (!Array.isArray(h)) return CHORDS[h];
  return CHORDS[beatInBar < 2 ? h[0] : h[1]];
}

/** 度数（1=主音）を実音へ。オクターブは deg に含める（8 = 1オクターブ上）。 */
export function degToMidi(deg) {
  const idx = deg - 1;
  const oct = Math.floor(idx / 7);
  return TONIC + oct * 12 + SCALE[((idx % 7) + 7) % 7];
}

/** 実音が、その和音の構成音か。 */
export function isChordTone(midi, chord) {
  return chord.pcs.includes(((midi % 12) + 12) % 12);
}

/** その和音の構成音のうち、音域に入る実音を全部。 */
export function chordTones(chord, lo = MEL_LO, hi = MEL_HI) {
  const out = [];
  for (let m = lo; m <= hi; m += 1) if (isChordTone(m, chord)) out.push(m);
  return out;
}

/** 旋律の音階の上で1つ隣（上/下）の実音。 */
export function melStep(midi, dir) {
  let m = midi + dir;
  for (let i = 0; i < 7; i += 1) {
    const pc = ((m - TONIC) % 12 + 12) % 12;
    if (MEL_SCALE.includes(pc)) return m;
    m += dir;
  }
  return midi + dir * 2;
}

/** 旋律の音階上の距離（何歩動くか）。 */
export function melDistance(a, b) {
  const idx = (m) => {
    const rel = m - TONIC;
    const oct = Math.floor(rel / 12);
    const pc = ((rel % 12) + 12) % 12;
    let i = MEL_SCALE.indexOf(pc);
    if (i < 0) i = MEL_SCALE.findIndex((s2) => s2 > pc);
    if (i < 0) i = 0;
    return oct * 7 + i;
  };
  return idx(b) - idx(a);
}

/** その実音が旋律の音階に含まれるか。 */
export function inMelScale(midi) {
  return MEL_SCALE.includes(((midi - TONIC) % 12 + 12) % 12);
}

/** 音階上で1つ隣（上/下）の実音。 */
export function scaleStep(midi, dir) {
  let m = midi + dir;
  for (let i = 0; i < 3; i += 1) {
    const pc = ((m - TONIC) % 12 + 12) % 12;
    if (SCALE.includes(pc)) return m;
    m += dir;
  }
  return midi + dir;
}

/** 音階上の距離（何度動くか）。 */
export function scaleDistance(a, b) {
  const idx = (m) => {
    const rel = m - TONIC;
    const oct = Math.floor(rel / 12);
    const pc = ((rel % 12) + 12) % 12;
    let i = SCALE.indexOf(pc);
    if (i < 0) i = SCALE.findIndex((s) => s > pc);
    if (i < 0) i = 0;
    return oct * 7 + i;
  };
  return idx(b) - idx(a);
}

export const RANGE = { MEL_LO, MEL_HI, LH_LO, LH_HI, TONIC, BEATS_PER_BAR };
export { CHORDS, MEL_SCALE, SCALE };
