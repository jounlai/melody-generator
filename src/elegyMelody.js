// 動機を実音へ置き、8小節のフレーズに組む。
//
// 守る規則（仕様）:
//   ・フレーズの頂点は8小節につき1つだけ
//   ・跳躍は原則6度以内
//   ・4度以上跳んだら、反対方向へ順次進行する
//   ・各4小節に最低1回、4分または8分の休符を置く
//   ・すべての小節を小節頭から始めない
//   ・非和声音は 準備 → 緊張 → 解決 の3段階で扱う
//   ・最高音 Ab5 は掛留か9thとして鳴らし、直後に下行解決させる

import {
  RANGE, chordAtBeat, isChordTone, chordTones, scaleStep, scaleDistance,
  melStep, melDistance, inMelScale,
} from './elegy.js';

const { MEL_LO, MEL_HI, BEATS_PER_BAR } = RANGE;

/** その和音の構成音のうち、target にいちばん近い実音。 */
function nearestChordTone(target, chord, lo = MEL_LO, hi = MEL_HI) {
  const tones = chordTones(chord, lo, hi);
  if (tones.length === 0) return Math.min(hi, Math.max(lo, target));
  let best = tones[0];
  for (const t of tones) if (Math.abs(t - target) < Math.abs(best - target)) best = t;
  return best;
}

/**
 * 動機を、この2小節の和音の上に置く。
 *
 * 形（度数の相対列）はそのまま保ち、起点だけを和音に合わせて選ぶ。
 * そのあと、和音との噛み合いを整える。
 *
 * @param {object} motif  { rhythm, shape }
 * @param {number} startBar  置く小節（曲頭からの通し）
 * @param {number} anchor  だいたいこの高さに置きたい（実音）
 * @param {number|null} prev  直前の音（実音）。声部進行に使う
 * @param {number} hi  この区画で許す上限（実音）。セクションごとの天井
 */
export function placeMotif(motif, startBar, anchor, prev, hi = MEL_HI) {
  const firstChord = chordAtBeat(startBar, motif.rhythm[0].b % BEATS_PER_BAR);

  // 起点は「前のフレーズの終わりから続く高さ」を最優先にする。
  //
  // !!! ここを anchor（そのセクションで置きたい高さ）で決めてはいけない !!!
  // それをやると2小節ごとに線が飛び、各区画が独立した往復になって
  // 曲全体の線が消える。実際に「行って戻る」だけの旋律になった。
  // 前の音との距離を第一、狙った高さを第二にして選ぶ。
  const tones = chordTones(firstChord, MEL_LO, hi).filter(inMelScale);
  const pool = tones.length > 0 ? tones : chordTones(firstChord, MEL_LO, hi);
  let start = pool[0];
  let bestScore = Infinity;
  for (const t of pool) {
    // 前の音から五音で2歩以内が理想。3歩以上は急に高くつく。
    const steps = prev === null ? 0 : Math.abs(melDistance(prev, t));
    const jumpCost = steps <= 2 ? steps : 6 + (steps - 2) * 4;
    // 狙った高さからのずれ。
    //
    // !!! ここを軽くしすぎると音域が制御できない !!!
    // 0.35 にしていたら連続性だけで起点が決まり、セクションごとの音域が
    // まったく効かなかった（提示も回想もクライマックスと同じ高さになった）。
    // 半音1つぶんを、五音1歩ぶんと同程度に重く見る。
    const aimCost = Math.abs(t - anchor) * 0.9;
    const score = jumpCost + aimCost;
    if (score < bestScore) { bestScore = score; start = t; }
  }

  // 形が音域に収まる高さへ起点を持ち上げる。
  //
  // 形が下降するとき起点が低いと下限で頭打ちになり、clamp で全部同じ音に
  // 潰れる（形 -2 -3 -4 が Eb4 Eb4 Eb4 になった）。同音の連打の正体はこれ。
  const lowSteps = Math.min(0, ...motif.shape);
  const highSteps = Math.max(0, ...motif.shape);
  const shiftBy = (base, steps) => {
    let m = base;
    for (let k = 0; k < Math.abs(steps); k += 1) m = melStep(m, Math.sign(steps));
    return m;
  };
  //
  // !!! 天井は、置いたあとに潰すのではなくここで効かせること !!!
  // あとから天井を超えた音だけを下ろすと、下ろした先が前後と噛み合わず
  // 同じ2音の往復が4箇所生まれた。形ごと収まる高さから始めれば、線は壊れない。
  for (let guard = 0; guard < 8; guard += 1) {
    if (shiftBy(start, highSteps) > hi) start = melStep(start, -1);
    else if (shiftBy(start, lowSteps) < MEL_LO) start = melStep(start, 1);
    else break;
  }

  // 形を実音へ。五音音階の上で動かす。
  const notes = [];
  for (let i = 0; i < motif.rhythm.length; i += 1) {
    const r = motif.rhythm[i];
    const steps = motif.shape[i] ?? 0;
    notes.push({
      midi: Math.min(hi, Math.max(MEL_LO, shiftBy(start, steps))),
      beat: (startBar * BEATS_PER_BAR) + r.b,
      dur: r.d,
    });
  }
  return notes;
}

/**
 * 非和声音を 準備 → 緊張 → 解決 の3段階に整える。
 *
 * 準備 : その音は直前の音から順次で入る（跳んで入る非和声音は唐突）
 * 緊張 : 強拍または長い音の上に置く（弱拍の短い音は通過音でよい）
 * 解決 : 次の音へ順次で、和声音へ降りる
 *
 * この3つが揃わない非和声音は和声音へ寄せる。揃うものは残す——そこが
 * 「泣ける」瞬間を作っている当のものだから。
 */
export function resolveNonChordTones(notes) {
  for (let i = 0; i < notes.length; i += 1) {
    const n = notes[i];
    const bar = Math.floor(n.beat / BEATS_PER_BAR);
    const inBar = n.beat - bar * BEATS_PER_BAR;
    const chord = chordAtBeat(bar, inBar);
    if (isChordTone(n.midi, chord)) continue;
    if (n.keepDissonance) continue;   // 頂点の掛留・9th は触らない

    const prev = notes[i - 1];
    const next = notes[i + 1];
    const strong = inBar === 0 || inBar === 2 || n.dur >= 1;
    const prepared = !prev || Math.abs(scaleDistance(prev.midi, n.midi)) <= 1;
    const resolved = next && Math.abs(scaleDistance(n.midi, next.midi)) === 1
      && isChordTone(next.midi, chordAtBeat(
        Math.floor(next.beat / BEATS_PER_BAR),
        next.beat - Math.floor(next.beat / BEATS_PER_BAR) * BEATS_PER_BAR,
      ));

    // 弱拍の短い音は通過音として通す（準備と解決があれば）
    if (!strong && prepared && resolved) continue;
    // 強拍でも、3段階が揃っていれば掛留として残す
    if (strong && prepared && resolved) continue;

    // 和声音へ寄せる。
    //
    // !!! 寄せ先が直前の音と同じになると往復が生まれる !!!
    // 七音音階は隣り合う音が近いので、丸めると前後が同じ場所へ集まりやすい。
    // 実測で往復が 47% まで増えた。直前と同じ音になる候補は外す。
    const tones = chordTones(chord).filter((t) => !prev || t !== prev.midi);
    if (tones.length === 0) { n.midi = nearestChordTone(n.midi, chord); continue; }
    let best = tones[0];
    for (const t of tones) if (Math.abs(t - n.midi) < Math.abs(best - n.midi)) best = t;
    n.midi = best;
  }
  return notes;
}

/**
 * 跳躍の始末。
 *   ・6度を超える跳躍は、間の和声音へ寄せて縮める
 *   ・4度以上跳んだ直後は、反対方向へ順次進行させる
 */
export function fixLeaps(notes) {
  for (let i = 1; i < notes.length; i += 1) {
    const jump = melDistance(notes[i - 1].midi, notes[i].midi);
    const size = Math.abs(jump);
    if (size > 3) {
      // 五音で3歩（おおよそ6度）を超えた。3歩に収める
      let m = notes[i - 1].midi;
      for (let k = 0; k < 3; k += 1) m = melStep(m, Math.sign(jump));
      const bar = Math.floor(notes[i].beat / BEATS_PER_BAR);
      const inBar = notes[i].beat - bar * BEATS_PER_BAR;
      notes[i].midi = nearestChordTone(m, chordAtBeat(bar, inBar));
    }
    // 4度以上（音階上3歩以上）跳んだら、次は反対向きの順次
    const after = notes[i + 1];
    if (!after) continue;
    const j2 = melDistance(notes[i - 1].midi, notes[i].midi);
    if (Math.abs(j2) < 2) continue;
    // 頂点の音の直後は、別途下行解決させるので触らない
    if (notes[i].isPeak) continue;
    const back = melStep(notes[i].midi, -Math.sign(j2));
    if (back < MEL_LO || back > MEL_HI) continue;
    // 埋め戻した先が、その前後の音と同じ高さになるなら動かさない。
    // ここを無条件に書き換えていたせいで同音の連続が 24.3% まで増えていた。
    if (back === notes[i].midi) continue;
    if (notes[i + 2] && notes[i + 2].midi === back) continue;
    after.midi = back;
  }
  return notes;
}

/**
 * 小節の頭を空ける。すべての小節を1拍目から始めない。
 * 動機の頭（フレーズの入り）は動かさない。
 */
export function offsetBarHeads(notes, rng, skipBars) {
  const byBar = new Map();
  for (const n of notes) {
    const bar = Math.floor(n.beat / BEATS_PER_BAR);
    if (!byBar.has(bar)) byBar.set(bar, []);
    byBar.get(bar).push(n);
  }
  for (const [bar, list] of byBar) {
    if (skipBars.has(bar)) continue;
    list.sort((a, b) => a.beat - b.beat);
    const head = list[0];
    if (head.beat !== bar * BEATS_PER_BAR) continue;   // 既に弱起
    if (list.length < 2) continue;
    if (rng() > 0.45) continue;
    const gap = list[1].beat - head.beat;
    // ずらす幅は隙間より必ず小さく（同じ位置に2音が重なるのを防ぐ）
    const shift = gap > 1 ? 1 : (gap > 0.5 ? 0.5 : 0);
    if (shift === 0) continue;
    head.beat += shift;
    head.dur = Math.max(0.25, head.dur - shift);
  }
  return notes;
}

/** 4小節ごとに、休符が最低1つあるかを見て、無ければ最後の音を短くして作る。 */
export function ensureRests(notes) {
  for (let from = 0; from < 32; from += 4) {
    const to = from + 4;
    const inRange = notes
      .filter((n) => n.beat >= from * BEATS_PER_BAR && n.beat < to * BEATS_PER_BAR)
      .sort((a, b) => a.beat - b.beat);
    if (inRange.length < 2) continue;
    let hasRest = false;
    for (let i = 1; i < inRange.length; i += 1) {
      const gap = inRange[i].beat - (inRange[i - 1].beat + inRange[i - 1].dur);
      if (gap >= 0.5) { hasRest = true; break; }
    }
    const tailGap = to * BEATS_PER_BAR
      - (inRange[inRange.length - 1].beat + inRange[inRange.length - 1].dur);
    if (tailGap >= 0.5) hasRest = true;
    if (hasRest) continue;
    // 無ければ、この4小節でいちばん長い音を4分ぶん短くして息を作る
    let longest = inRange[0];
    for (const n of inRange) if (n.dur > longest.dur) longest = n;
    longest.dur = Math.max(0.5, longest.dur - 1);
  }
  return notes;
}

export { nearestChordTone };
