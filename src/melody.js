// 旋律を「音符単位で」作る層。
//
// ■ なぜ要るか
//
// この生成系は 2小節の断片999個をあらかじめ作っておき、曲を組むときは
// 「その和音に乗るか」で断片を選んで並べていた。つまり **1つの音も
// 「前の音の続きとして」選ばれていない**。断片の中の音の並びは断片が
// 作られた時点で決まっていて、曲の文脈とは無関係だった。
//
// 歌のメロディは逆で、いまここまで来た線と、これから和音がどこへ行くかを見て
// 次の音が決まる。その一点がこの系には無かったので、統計をどれだけ整えても
// 「メロディとして成立しない」ままだった。
//
// ■ 作り方（対位法の骨格音＋装飾という古典的な手順）
//
//   1. 骨格音   小節ごとに1つ、その和音の構成音を置く。選ぶ基準は
//               「前の骨格音から滑らかに繋がること」と「輪郭の目標に近いこと」
//   2. 装飾     骨格音の間を、次の骨格音へ向かう順次進行で埋める。
//               余った打点は刺繍音（隣へ行って戻る）にする
//   3. 掛留     1フレーズに1回、強拍に非和声音を置いて順次下降で解決させる
//   4. 終止     フレーズの最後は、その和音の安定音（1/3/5度）へ着地する
//
// リズムは渡された型をそのまま使う（動機の反復はリズム側が担う）。
// ここが決めるのは音の高さだけ。
import { isChordTone } from './theory.js';

const DEG_MIN = 1;
const DEG_MAX = 15;

/** その和音の構成音になるスケール度数を、音域の中から全部拾う。 */
export function chordToneDegrees(chord, mode, lo = DEG_MIN, hi = DEG_MAX) {
  const out = [];
  for (let d = Math.max(DEG_MIN, lo); d <= Math.min(DEG_MAX, hi); d += 1) {
    if (isChordTone(d, mode, chord)) out.push(d);
  }
  return out;
}

/**
 * 小節の骨格音を選ぶ。
 *
 * 「前の音から滑らかに」と「輪郭の目標へ」の two objectives を足して比べる。
 * 順次（1度差）を最良とし、跳躍は輪郭がそれを求めるときだけ通す。
 *
 * @param {string} chord その小節の和音
 * @param {number|null} prev 前の骨格音。曲の頭は null
 * @param {number} target 輪郭が求める高さ
 */
export function chooseStructural(chord, mode, prev, target, lo, hi) {
  const tones = chordToneDegrees(chord, mode, lo, hi);
  if (tones.length === 0) return prev ?? target;
  let best = tones[0];
  let bestScore = Infinity;
  for (const d of tones) {
    // 前の音からの距離。順次(1)は据え置き、跳躍は距離の2乗で急に高くつく。
    const move = prev === null ? 0 : Math.abs(d - prev);
    const smooth = move <= 1 ? 0 : (move - 1) ** 2;
    // 輪郭からのずれ。骨格は輪郭に従うので、こちらの重みを大きめに取る。
    const shape = Math.abs(d - target) * 2;
    const score = smooth + shape;
    if (score < bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/**
 * 2つの骨格音の間を n 個の音で埋める。
 *
 * 距離が音数に足りるなら順次で歩く（これが「跳躍を埋め戻す」形そのもの）。
 * 余るぶんは刺繍音（隣へ行って戻る）で埋める。同じ音を続けて置かない。
 *
 * @returns {number[]} 長さ n の度数列（from は含まない、to も含まない）
 */
export function fillBetween(from, to, n) {
  if (n <= 0) return [];
  const clamp = (d) => Math.min(DEG_MAX, Math.max(DEG_MIN, d));
  const dir = Math.sign(to - from) || -1;
  const out = [];
  let cur = from;

  // 目標へ向かって歩く。残りの音数で届かないぶんは歩幅を広げ、
  // 音数が余るぶんは刺繍音（隣へ出て戻る）で時間を稼ぐ。
  //
  // !!! 同じ音を続けて置かないこと !!!
  // 「隣へ出て戻る」を素直に書くと戻り先が直前と同じ音になり、実測で同音が
  // 22.4% まで増えた（版1は 5.8%）。同音が多いと動きが乏しくなり、残った
  // 動きの偏りがそのまま「上がっていく」「下がっていく」の印象になる。
  // 刺繍音は必ず**別の音**を経由させる。
  for (let i = 0; i < n; i += 1) {
    const left = n - i;              // これから置ける音の数
    const remain = to - cur;         // 目標までの符号つき距離
    const need = Math.abs(remain);

    let next;
    if (need > left) {
      // 届かない。残りの音数で割って歩幅を決める。
      next = cur + Math.sign(remain) * Math.max(1, Math.round(need / left));
    } else if (need === left) {
      next = cur + Math.sign(remain); // ちょうど順次で届く
    } else {
      // 音数が余る。輪郭の向きへ1つ出るか、直前と違う側へ触れる。
      const away = cur + dir;
      next = (out.length > 0 && away === out[out.length - 1]) ? cur - dir : away;
    }
    if (next === cur) next = cur + dir; // 同じ音は置かない
    cur = clamp(next);
    out.push(cur);
  }
  return out;
}

/**
 * フレーズを1つ作る。
 *
 * @param {object} spec
 *   chords    小節ごとの和音記号
 *   mode      'major' | 'minor'
 *   rhythm    小節ごとの [{beat, dur}]（beat は小節内 0〜4）
 *   contour   小節ごとの目標の高さ（度数）
 *   startDeg  最初の骨格音。null なら輪郭に任せる
 *   register  [lo, hi] 使ってよい度数
 *   suspendAt 掛留を置く小節の番号。null なら置かない
 *   endDegrees 最後の音に置きたい度数（スケール度数 1/3/5 など）
 * @returns {Array<{deg:number, beat:number, dur:number}>} beat はフレーズ頭からの通し
 */
export function composePhrase(spec) {
  const {
    chords, mode, rhythm, contour, register = [3, 13],
    startDeg = null, suspendAt = null, suspendAtBars = null, endDegrees = null,
  } = spec;
  const [lo, hi] = register;
  const suspendBars = new Set(
    Array.isArray(suspendAtBars) ? suspendAtBars : (suspendAt === null ? [] : [suspendAt]),
  );

  // 1. 骨格音。小節ごとに1つ。
  const structural = [];
  let prev = startDeg;
  for (let b = 0; b < chords.length; b += 1) {
    const target = contour[b] ?? contour[contour.length - 1] ?? 8;
    const deg = chooseStructural(chords[b], mode, prev, target, lo, hi);
    structural.push(deg);
    prev = deg;
  }

  // 2. 各小節を、その骨格音から次の骨格音へ向かって埋める。
  const notes = [];
  for (let b = 0; b < chords.length; b += 1) {
    const cell = rhythm[b] ?? [];
    if (cell.length === 0) continue;
    const here = structural[b];
    const next = b + 1 < structural.length ? structural[b + 1] : here;
    const inner = fillBetween(here, next, cell.length - 1);
    const degs = [here, ...inner];

    // 3. 掛留（サスペンション）。強拍に非和声音を置き、次の音へ順次下降で解決させる。
    //
    // 「泣ける」瞬間はほぼこれが作っている。和音が変わった瞬間に、前の和音の音が
    // 残って半拍ぶつかり、そこから一歩下がって収まる——その一歩が感情を動かす。
    // 置く場所は指定された小節（陰りの和音 iv / bVI / bVII の上がいちばん効く）。
    if (suspendBars.has(b) && degs.length >= 2) {
      const sus = degs[0] + 1;
      if (sus <= hi && sus <= DEG_MAX && !isChordTone(sus, mode, chords[b])
        && isChordTone(sus - 1, mode, chords[b])) {
        degs[0] = sus;
        degs[1] = sus - 1;
      }
    }

    // 3.5 強拍の始末。
    //
    // 対位法の原則は「強拍は和声音、非和声音は弱拍」。埋める工程は次の骨格音へ
    // 向かって歩くだけで和音を見ていないので、通過音が強拍に居座ることがある。
    // 解決しない非和声音が強拍にあると、耳にははっきり「外れた音」に聴こえる。
    //
    // 次の音へ順次で解決しているものは触らない（それが掛留・経過音であり、
    // 陰りを作っている当のもの）。解決していないものだけ、いちばん近い和声音へ寄せる。
    for (let i = 0; i < degs.length; i += 1) {
      const at = cell[i]?.beat ?? 0;
      const strong = at === 0 || at === 2;
      if (!strong) continue;
      if (isChordTone(degs[i], mode, chords[b])) continue;
      const nx = degs[i + 1];
      const resolves = nx !== undefined && Math.abs(nx - degs[i]) === 1
        && isChordTone(nx, mode, chords[b]);
      if (resolves) continue;
      degs[i] = nearestChordTone(degs[i], mode, chords[b], lo, hi);
    }

    for (let i = 0; i < cell.length; i += 1) {
      notes.push({ deg: degs[i], beat: b * 4 + cell[i].beat, dur: cell[i].dur });
    }
  }

  // 4. 終止。最後の音は、その和音の安定音へ着地させる。
  if (notes.length > 0 && Array.isArray(endDegrees) && endDegrees.length > 0) {
    const last = notes[notes.length - 1];
    const chord = chords[chords.length - 1];
    const wanted = chordToneDegrees(chord, mode, lo, hi)
      .filter((d) => endDegrees.includes(scaleDegreeOf(d)));
    if (wanted.length > 0) {
      // いちばん近いものへ。飛ばずに着地させる。
      let best = wanted[0];
      for (const d of wanted) if (Math.abs(d - last.deg) < Math.abs(best - last.deg)) best = d;
      last.deg = best;
    }
  }
  return notes;
}

/** その和音の構成音のうち、deg にいちばん近いもの。同点なら下を採る。 */
function nearestChordTone(deg, mode, chord, lo, hi) {
  const tones = chordToneDegrees(chord, mode, lo, hi);
  if (tones.length === 0) return deg;
  let best = tones[0];
  for (const d of tones) {
    if (Math.abs(d - deg) < Math.abs(best - deg)) best = d;
  }
  return best;
}

function scaleDegreeOf(deg) {
  return ((((deg - 1) % 7) + 7) % 7) + 1;
}

/**
 * 山なりの輪郭を作る。上って、頂点で解放し、下りてくる。
 * @param {number} bars 小節数
 * @param {number} from 開始の高さ
 * @param {number} peak 頂点の高さ
 * @param {number} to 着地の高さ
 * @param {number} peakAt 頂点を置く位置（0〜1）
 */
export function archContour(bars, from, peak, to, peakAt = 0.65) {
  const out = [];
  const top = Math.max(1, Math.round(bars * peakAt));
  for (let b = 0; b < bars; b += 1) {
    if (b <= top) {
      const t = top === 0 ? 1 : b / top;
      out.push(Math.round(from + (peak - from) * t));
    } else {
      const t = (b - top) / Math.max(1, bars - 1 - top);
      out.push(Math.round(peak + (to - peak) * t));
    }
  }
  return out;
}

/**
 * 下降する輪郭。頂点を早めに置き、そこから長く下りてくる。
 *
 * 「G線上のアリア」のように、旋律が下りていく形は昔から美しさの型として
 * 使われてきた（嘆きの下行音型 passus duriusculus）。Huron の言う「下降傾斜」
 * ——旋律は上行より下行の順次が多い——も同じことを統計として言っている。
 *
 * 登りは短く、下りは長く。これが「上がって力み、下りて解ける」形を作る。
 */
export function fallingContour(bars, from, peak, to, peakAt = 0.3) {
  return archContour(bars, from, peak, to, peakAt);
}
