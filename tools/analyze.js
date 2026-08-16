// メロディー断片（2小節 = 8拍）の形状分析。
// 音高は通しスケール度数（1 = トニック, 8 = 1オクターブ上, 15 = 2オクターブ上）だけを扱い、
// コード名・音名には一切依存しない。
//
// 音符: { deg: number, beat: number, dur: number, vel: number }
// 音符配列は beat 昇順で渡される前提。

const BAR = 4; // 1小節 = 4拍

// ペンタトニック（五音音階）。J-POP・アニメ・童謡・世界中の民謡を貫く
// 「口ずさめる／耳に残る」の核心。断片は mode 非依存なので両方を別々に判定する。
export const PENTA_MAJOR = [1, 2, 3, 5, 6]; // 4 と 7 を使わない
export const PENTA_MINOR = [1, 3, 4, 5, 7]; // 2 と 6 を使わない
const PENTA_MAJOR_SET = new Set(PENTA_MAJOR);
const PENTA_MINOR_SET = new Set(PENTA_MINOR);
// 歌い出し・着地として安定する度数（主和音の構成音）
const STABLE_SET = new Set([1, 3, 5]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;
// beat/dur の浮動小数誤差を吸収してからキー化する
const q = (v) => Math.round(v * 1e4) / 1e4;

// ---------------------------------------------------------------------------
// リズムの多様性
// ---------------------------------------------------------------------------
// 音価が均一な断片は、音程が何であろうと「童謡」にしか聴こえない。
// 長い音と短い音の落差・拍のずれ・休符の3つが、断片を「曲の一節」に変える。

/** 断片に含まれる異なる音価の種類数 */
export function distinctDurations(notes) {
  const list = Array.isArray(notes) ? notes : [];
  return new Set(list.map((n) => q(n.dur))).size;
}

/** 最長音価 ÷ 最短音価。音が無いときは1 */
export function durationRatio(notes) {
  const list = Array.isArray(notes) ? notes : [];
  if (list.length === 0) return 1;
  const durs = list.map((n) => q(n.dur)).filter((d) => d > 0);
  if (durs.length === 0) return 1;
  return Math.max(...durs) / Math.min(...durs);
}

/**
 * シンコペーション。拍の裏(beat が整数でない)から始まり、
 * 次の拍をまたいで伸びる音(dur >= 1)があるか。
 */
export function hasSyncopation(notes) {
  const list = Array.isArray(notes) ? notes : [];
  return list.some((n) => q(n.beat) % 1 !== 0 && n.dur >= 1);
}

/**
 * 休符。音と音のあいだに 0.5拍以上の空きがあるか、最初の音が拍頭から遅れて入るか。
 * 息継ぎの無い断片は歌ではなく練習曲に聴こえる。
 */
export function hasRest(notes) {
  const list = Array.isArray(notes) ? notes : [];
  if (list.length === 0) return false;
  if (q(list[0].beat) > 0) return true;
  for (let i = 0; i + 1 < list.length; i++) {
    if (q(list[i + 1].beat - (list[i].beat + list[i].dur)) >= 0.5) return true;
  }
  return false;
}

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

/** 通しスケール度数(1〜15)を音階内の位置(1〜7)へ落とす */
export function scaleDegOf(deg) {
  return ((((deg - 1) % 7) + 7) % 7) + 1;
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

/**
 * 後半1小節が前半1小節の「平行移動（ゼクエンツ）」なら、その度数オフセットを返す。
 * リズムが一致しない・平行でないときは null。0 は完全反復。
 * 動機（モチーフ）が動機として聴こえるかどうかは、ほぼここで決まる。
 */
export function innerShift(notes) {
  if (!hasInnerMotif(notes)) return null;

  const a = notes.filter((n) => n.beat < BAR);
  const b = notes.filter((n) => n.beat >= BAR);
  const shift = b[0].deg - a[0].deg;
  for (let i = 1; i < a.length; i++) {
    if (b[i].deg - a[i].deg !== shift) return null;
  }
  return shift;
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
 * 'penta-major' / 'penta-minor' は大衆性（口ずさめること）の核心。
 * 'inner-sequence' / 'inner-repeat' は「動機として成立しているか」の核心。
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

  // 音数が増えると終止の長さも相対的に短くなるので、1.5拍から息継ぎとみなす。
  const last = list[list.length - 1];
  if (last && last.dur >= 1.5) tags.push('long-ending');

  const lastInt = intervals[intervals.length - 1];
  if (lastInt !== undefined && lastInt < 0 && lastInt >= -2) tags.push('resolve-down');

  if (intervals.length > 0 && intervals.every((d) => Math.abs(d) <= 2)) tags.push('stepwise');

  // リズム。音価が一定だと童謡になるので、拍からのずれと息継ぎを明示的に拾う。
  if (hasSyncopation(list)) tags.push('syncopation');
  if (hasRest(list)) tags.push('has-rest');

  if (hasInnerMotif(list)) tags.push('inner-motif');

  // 後半が前半の平行移動（ゼクエンツ）／完全反復。
  // inner-repeat は inner-sequence のオフセット0の特殊形なので両方付ける。
  const shift = innerShift(list);
  if (shift !== null) {
    tags.push('inner-sequence');
    if (shift === 0) tags.push('inner-repeat');
  }

  // ペンタトニック判定。音が1つも無い断片には付けない。
  if (list.length > 0) {
    const scaleDegs = list.map((n) => scaleDegOf(n.deg));
    if (scaleDegs.every((s) => PENTA_MAJOR_SET.has(s))) tags.push('penta-major');
    if (scaleDegs.every((s) => PENTA_MINOR_SET.has(s))) tags.push('penta-minor');
    if (STABLE_SET.has(scaleDegs[0])) tags.push('stable-start');
    if (STABLE_SET.has(scaleDegs[scaleDegs.length - 1])) tags.push('stable-end');
  }

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
      density: 0, distinctDurations: 0, durationRatio: 1,
      intervals: [], contour: 'question', tags: [], tension: 1,
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
    // リズムの単調さの主指標。1種類しか音価が無い断片は童謡の正体。
    distinctDurations: distinctDurations(list),
    durationRatio: round2(durationRatio(list)),
    intervals,
    contour: detectContour(degs),
  };

  base.tags = detectTags(list, base);
  base.tension = tensionOf(base);
  return base;
}
