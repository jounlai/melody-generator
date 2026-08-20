// 和音が重なった MIDI から「上声＝旋律らしい線」を取り出し、
// スケール度数の並びに直す。
//
// ここで作るのは解析の中間物であって、リポジトリに残すものではない。
// 残してよいのは、この出力からさらに刻んだ統計（音程の並びの出現頻度など）だけ。
//
// 手順は5つ。
//   1. スカイライン  … 同時に鳴っている音のうち、いちばん高い音だけを追う
//   2. 量子化        … 16分の格子に丸める
//   3. 調の判定      … ピッチクラスの分布を長短の型と突き合わせる
//   4. 度数化        … 主音からのスケール度数へ
//   5. 楽節切り      … 休符で切り、短すぎる/跳ねすぎる断片を捨てる

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// 長音階・自然短音階の、主音からの半音。
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/**
 * 同時に鳴る音のうち、いちばん高い線だけを残す。
 * 伴奏つきの編曲では旋律がほぼ最上声にいるので、これでかなり拾える。
 */
export function skyline(notes) {
  if (notes.length === 0) return [];
  const events = [];
  for (const n of notes) {
    events.push({ t: n.tick, on: true, n });
    events.push({ t: n.tick + n.dur, on: false, n });
  }
  events.sort((a, b) => a.t - b.t || (a.on ? 1 : -1));

  const live = new Set();
  const out = [];
  let cur = null;
  for (const e of events) {
    if (e.on) live.add(e.n); else live.delete(e.n);
    let top = null;
    for (const n of live) if (!top || n.midi > top.midi) top = n;
    const midi = top ? top.midi : null;
    if (cur && cur.midi === midi) continue;
    if (cur && cur.midi !== null && e.t > cur.tick) {
      out.push({ midi: cur.midi, tick: cur.tick, dur: e.t - cur.tick, vel: cur.vel });
    }
    cur = midi === null ? null : { midi, tick: e.t, vel: top.vel };
  }
  return out;
}

/** 16分の格子へ丸める。長さが0になる音は捨てる。 */
export function quantize(notes, division) {
  const grid = division / 4; // 16分
  const out = [];
  for (const n of notes) {
    const tick = Math.round(n.tick / grid) * grid;
    const end = Math.round((n.tick + n.dur) / grid) * grid;
    if (end <= tick) continue;
    out.push({ midi: n.midi, tick, dur: end - tick, vel: n.vel });
  }
  // 同じ拍に重なったものは高いほうを残す
  const byTick = new Map();
  for (const n of out) {
    const prev = byTick.get(n.tick);
    if (!prev || n.midi > prev.midi) byTick.set(n.tick, n);
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

/** ピッチクラス分布から調を当てる。長さで重み付けする。 */
export function detectKey(notes) {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[((n.midi % 12) + 12) % 12] += n.dur;
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  const norm = hist.map((v) => v / total);
  let best = { tonic: 0, mode: 'major', score: -Infinity };
  for (let t = 0; t < 12; t += 1) {
    for (const [mode, prof] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]]) {
      let s = 0;
      for (let i = 0; i < 12; i += 1) s += norm[(t + i) % 12] * prof[i];
      if (s > best.score) best = { tonic: t, mode, score: s };
    }
  }
  return best;
}

/**
 * 実音をスケール度数へ。音階外の音は最寄りの度数へ丸め、丸めた数を返す。
 * 度数は corpus.js と同じ流儀（1 = 主音、8 = 1オクターブ上、0 以下は下の音域）。
 */
export function toDegrees(notes, tonic, mode) {
  const steps = mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
  let off = 0;
  const degs = notes.map((n) => {
    const rel = n.midi - tonic;
    const oct = Math.floor(rel / 12);
    const pc = ((rel % 12) + 12) % 12;
    let idx = steps.indexOf(pc);
    if (idx < 0) {
      off += 1;
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < steps.length; i += 1) {
        const d = Math.abs(steps[i] - pc);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      idx = bestI;
    }
    return { deg: oct * 7 + idx + 1, tick: n.tick, dur: n.dur, vel: n.vel };
  });
  return { degs, chromaticRatio: notes.length ? off / notes.length : 1 };
}

/** 休符で楽節に切る。gapTicks 以上の空きがあれば切れ目とみなす。 */
export function splitPhrases(notes, gapTicks) {
  const out = [];
  let cur = [];
  for (let i = 0; i < notes.length; i += 1) {
    const n = notes[i];
    if (cur.length) {
      const prev = cur[cur.length - 1];
      if (n.tick - (prev.tick + prev.dur) >= gapTicks) { out.push(cur); cur = []; }
    }
    cur.push(n);
  }
  if (cur.length) out.push(cur);
  return out;
}
