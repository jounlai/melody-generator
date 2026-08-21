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
export function fillBetween(from, to, n, prevStep = 0) {
  if (n <= 0) return [];
  const clamp = (d) => Math.min(DEG_MAX, Math.max(DEG_MIN, d));
  const swing = Math.sign(to - from) || -1;
  const out = [];
  let cur = from;
  let last = prevStep;   // 直前の動き（符号つき）。跳んだ直後かを見るのに使う

  for (let i = 0; i < n; i += 1) {
    const left = n - i;              // これから置ける音の数
    const remain = to - cur;         // 目標までの符号つき距離
    const need = Math.abs(remain);
    let next;

    if (Math.abs(last) >= 3 && need < left) {
      // ギャップフィル。直前が跳躍で、かつ目標まで余裕があるときは、
      // まず逆向きに1つ戻す。旋律分析でもっとも頑健な発見で、これが無いと
      // 跳んだきり線が切れて聴こえる。余裕が無いときは目標を優先する。
      next = cur - Math.sign(last);
    } else if (need > left) {
      // 届かない。歩幅は2度まで。ここを広げると「跳んで、そのまま同じ向きへ
      // 跳び続ける」形になり、埋め戻しが成り立たなくなる。
      next = cur + Math.sign(remain) * Math.min(2, Math.max(1, Math.round(need / left)));
    } else if (need === left) {
      next = cur + Math.sign(remain); // ちょうど順次で届く
    } else {
      // 音数が余る。刺繍音。輪郭の向きへ触れ、直前と同じ音は置かない。
      const away = cur + swing;
      next = (out.length > 0 && away === out[out.length - 1]) ? cur - swing : away;
    }

    if (next === cur) next = cur + swing;   // 同じ音を続けない
    const stepped = clamp(next);
    last = stepped - cur;
    cur = stepped;
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

  // 1.5 跳躍の埋め戻し（ギャップフィル）。
  //
  // 骨格音どうしが大きく離れると、小節の変わり目で跳んだきり埋め戻されない。
  // 旋律分析でもっとも頑健な発見は「大きく跳んだら逆向きに順次で埋める」で、
  // ここが崩れると線が繋がって聴こえない（実測で埋め戻し率が 23.1% まで落ちた）。
  // 跳んだ次の小節の骨格音を、跳んだ向きと逆へ1つ寄せる。
  for (let b = 1; b < structural.length - 1; b += 1) {
    const jump = structural[b] - structural[b - 1];
    if (Math.abs(jump) < 3) continue;
    const back = structural[b] - Math.sign(jump);
    if (back < lo || back > hi) continue;
    // 寄せた先も和声音でなければならない（強拍に置く音だから）。
    if (isChordTone(back, mode, chords[b + 1])) structural[b + 1] = back;
  }

  // 2. 各小節を、その骨格音から次の骨格音へ向かって埋める。
  const notes = [];
  for (let b = 0; b < chords.length; b += 1) {
    let cell = rhythm[b] ?? [];
    // 断片が小節を空けていることがある。そのまま通すと旋律に穴が開く
    // （実測で32小節のうち何小節かが無音になっていた）。
    // 全音符1つで埋める。退屈でも、音楽が止まるよりよい。
    if (cell.length === 0) cell = [{ beat: 0, dur: 4 }];
    const here = structural[b];
    const next = b + 1 < structural.length ? structural[b + 1] : here;
    // 直前の小節からの動き。跳んで入ってきたなら、この小節の頭で埋め戻す。
    const enter = b > 0 ? here - structural[b - 1] : 0;
    const inner = fillBetween(here, next, cell.length - 1, enter);
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

    // 3.6 長く伸びる音は和声音に限る。
    //
    // 短い音なら非和声音でも通過音として流れるが、1.5拍以上鳴り続ける音が
    // 和音から外れていると、はっきり濁って聴こえる（実測で長い音の 31.5% が
    // 外れていた）。掛留として次へ順次で解決するものだけは残す——そこは
    // 意図してぶつけている当のものだから。
    //
    // 小節線をまたぐ音は、またいだ先の和音でも鳴り続ける。次の小節の和音にも
    // 乗る音を選ぶ（両方に乗る音が無ければ、この小節の和音を優先する）。
    for (let i = 0; i < degs.length; i += 1) {
      const cellNote = cell[i];
      if (!cellNote) continue;
      // 長い音（1.5拍以上）と、小節線をまたぐ音の両方を見る。
      // またぐ音は短くても次の和音の上で鳴り続けるので、そこで濁る。
      const crossesBar = cellNote.beat + cellNote.dur > 4;
      if (cellNote.dur < 1.5 && !crossesBar) continue;
      if (isChordTone(degs[i], mode, chords[b])) {
        // この小節には乗っている。またぐ先も見る。
        const nextChord = chords[b + 1];
        if (!crossesBar || !nextChord || isChordTone(degs[i], mode, nextChord)) continue;
      }
      const nx = degs[i + 1];
      const resolves = nx !== undefined && Math.abs(nx - degs[i]) === 1
        && isChordTone(nx, mode, chords[b]);
      if (resolves) continue;
      degs[i] = nearestChordTone(degs[i], mode, chords[b], lo, hi,
        crossesBar ? chords[b + 1] : null);
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

/**
 * その和音の構成音のうち、deg にいちばん近いもの。同点なら下を採る。
 * nextChord を渡すと、そちらにも乗る音を優先する（小節線をまたぐ音のため）。
 */
function nearestChordTone(deg, mode, chord, lo, hi, nextChord = null) {
  const tones = chordToneDegrees(chord, mode, lo, hi);
  if (tones.length === 0) return deg;

  // 小節線をまたぐ音の優先順:
  //   1. 両方の和音に乗る音（いちばん滑らか）
  //   2. **次の**和音に乗る音
  //   3. この小節の和音に乗る音
  //
  // 2 が 3 より上なのは、またいで鳴り続ける音は耳には「次の和音の音が半拍
  // 早く出た」ものとして聴こえるから（食いの定義そのもの）。ここを逆にすると、
  // 前の和音の音が次の和音の上で鳴り続けて濁る（実測で 23.9% がこれだった）。
  let pool = tones;
  if (nextChord) {
    const both = tones.filter((d) => isChordTone(d, mode, nextChord));
    if (both.length > 0) pool = both;
    else {
      const next = chordToneDegrees(nextChord, mode, lo, hi);
      if (next.length > 0) pool = next;
    }
  }
  let best = pool[0];
  for (const d of pool) {
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
