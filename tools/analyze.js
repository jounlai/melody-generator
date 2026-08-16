// メロディー断片（2小節 = 8拍）の形状分析。
// 音高は通しスケール度数（1 = トニック, 8 = 1オクターブ上, 15 = 2オクターブ上）だけを扱い、
// コード名・音名には一切依存しない。
//
// 音符: { deg: number, beat: number, dur: number, vel: number }
// 音符配列は beat 昇順で渡される前提。

const BAR = 4; // 1小節 = 4拍

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;
// beat/dur の浮動小数誤差を吸収してからキー化する
const q = (v) => Math.round(v * 1e4) / 1e4;

/** 隣接音の度数差の配列を返す */
function intervalsOf(degs) {
  const out = [];
  for (let i = 0; i + 1 < degs.length; i++) out.push(degs[i + 1] - degs[i]);
  return out;
}

/** 方向転換回数（0の音程は無視して符号の変化を数える） */
function turnsOf(intervals) {
  const signs = intervals.filter((d) => d !== 0).map((d) => Math.sign(d));
  let turns = 0;
  for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) turns++;
  return turns;
}

/** 1, 8, 15 ... のようにトニックなら true */
export function isRestingDeg(deg) {
  if (!Number.isFinite(deg)) return false;
  return ((((deg - 1) % 7) + 7) % 7) === 0;
}

/**
 * 輪郭の判定。判定順序は仕様どおり arch → wave → descend → ascend → answer/question。
 */
export function detectContour(degs) {
  if (!Array.isArray(degs) || degs.length < 3) return 'question';

  const intervals = intervalsOf(degs);
  const turns = turnsOf(intervals);
  const hi = Math.max(...degs);
  const rel = degs.indexOf(hi) / (degs.length - 1);
  const first = degs[0];
  const last = degs[degs.length - 1];

  if (rel >= 0.3 && rel <= 0.75 && hi >= first + 2 && hi >= last + 2) return 'arch';
  if (turns >= 3) return 'wave';
  if (last <= first - 2) return 'descend';
  if (last >= first + 2) return 'ascend';
  return isRestingDeg(last) ? 'answer' : 'question';
}

/**
 * 前半1小節と後半1小節のリズム型（beat と dur の並び）が完全一致するか。
 * 音高は問わない。どちらかの小節の音符が2個未満なら偽。
 */
export function hasInnerMotif(notes) {
  if (!Array.isArray(notes) || notes.length < 4) return false;

  const a = notes.filter((n) => n.beat < BAR);
  const b = notes.filter((n) => n.beat >= BAR);
  if (a.length < 2 || b.length < 2) return false;
  if (a.length !== b.length) return false;

  const keyA = a.map((n) => `${q(n.beat)}/${q(n.dur)}`).join(',');
  const keyB = b.map((n) => `${q(n.beat - BAR)}/${q(n.dur)}`).join(',');
  return keyA === keyB;
}

/** base が未指定でも動くように最低限の情報を組み立てる */
function baseOf(notes, base) {
  if (base && Array.isArray(base.intervals)) return base;
  const degs = notes.map((n) => n.deg);
  const intervals = intervalsOf(degs);
  const hi = degs.length ? Math.max(...degs) : 0;
  return {
    intervals,
    peakDeg: hi,
    peakCount: degs.filter((d) => d === hi).length,
  };
}

/**
 * 情動的な特徴タグ。
 * 'sigh' は「5度以上の上行跳躍の直後に順次下降が2音以上続く」形で、涙腺を刺激する中核パターン。
 */
export function detectTags(notes, base) {
  const list = Array.isArray(notes) ? notes : [];
  const b = baseOf(list, base);
  const intervals = b.intervals;
  const tags = [];

  // sigh: 上行跳躍（+5度以上）→ 順次下降（2度以内の下降）が2音以上
  const isStepDown = (d) => d < 0 && d >= -2;
  for (let i = 0; i < intervals.length; i++) {
    if (intervals[i] >= 5 && isStepDown(intervals[i + 1]) && isStepDown(intervals[i + 2])) {
      tags.push('sigh');
      break;
    }
  }

  if (b.peakCount === 1) tags.push('single-peak');

  const last = list[list.length - 1];
  if (last && last.dur >= 2) tags.push('long-ending');

  const lastInt = intervals[intervals.length - 1];
  if (lastInt !== undefined && lastInt < 0 && lastInt >= -2) tags.push('resolve-down');

  if (intervals.length > 0 && intervals.every((d) => Math.abs(d) <= 2)) tags.push('stepwise');

  if (hasInnerMotif(list)) tags.push('inner-motif');

  return tags;
}

/** 緊張度 1〜5 */
export function tensionOf(base) {
  const intervals = (base && Array.isArray(base.intervals)) ? base.intervals : [];
  const peakDeg = (base && Number.isFinite(base.peakDeg)) ? base.peakDeg : 0;

  const heightScore = clamp((peakDeg - 3) / 9, 0, 1);
  const leaps = intervals.filter((d) => Math.abs(d) >= 3).length;
  const leapScore = clamp(leaps / 3, 0, 1);

  const t = 1 + Math.round(Math.min(1, 0.65 * heightScore + 0.35 * leapScore) * 4);
  return clamp(t, 1, 5);
}

/** 断片のメタ情報一式 */
export function analyzeFragment(notes) {
  const list = Array.isArray(notes) ? notes : [];

  if (list.length === 0) {
    return {
      startDeg: 0, endDeg: 0, range: [0, 0], span: 0,
      peakDeg: 0, peakBeat: 0, peakCount: 0,
      density: 0, intervals: [], contour: 'question', tags: [], tension: 1,
    };
  }

  const degs = list.map((n) => n.deg);
  const lo = Math.min(...degs);
  const hi = Math.max(...degs);
  const peakIndex = degs.indexOf(hi);
  const intervals = intervalsOf(degs);

  const base = {
    startDeg: degs[0],
    endDeg: degs[degs.length - 1],
    range: [lo, hi],
    span: hi - lo,
    peakDeg: hi,
    peakBeat: list[peakIndex].beat,
    peakCount: degs.filter((d) => d === hi).length,
    density: round2(list.length / 8),
    intervals,
    contour: detectContour(degs),
  };

  base.tags = detectTags(list, base);
  base.tension = tensionOf(base);
  return base;
}
