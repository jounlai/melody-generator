// 事前データ（メロディー断片999個・コード進行99個）から1曲を組み立てる中核モジュール。
//
// 断片をただランダムに並べても「綺麗な断片の羅列」にしかならず、絶対に泣けない。
// ここでやるのは次の4つだけで、その4つが「断片の列」を「曲」に変える。
//
//   1. 楽節構造     — セクションの中を a - a' - b - a'' にする（下記）
//   2. 接続の滑らかさ — 前の断片の終わりと次の断片の始まりを近い音でつなぐ
//   3. 曲全体の起伏   — A→A'→B→A'' の中で緊張を積み上げ、B で一度だけ頂点を作る
//   4. モチーフの再登場 — A で鳴った旋律を、変形した進行の上へ帰ってこさせる
//
// 1 が最も効く。無関係な断片を4つ並べても「ランダムな音程の列」にしか聴こえない。
// 旋律が旋律に聴こえるのは、同じ形が少しずつ姿を変えて戻ってくるからで、
// セクション内の a' と a'' は a のリズムと音形をそのまま保ったまま
// スケール度数を平行移動（ゼクエンツ）して、次のコードの上へ乗せ直したものにする。
//
// 乱数は composeSong の中で作る1本だけを使う。Math.random() は使わない。
// 消費順を変えると同じシードでも同じ曲にならなくなるので、処理順は固定。
import { makeRng, seedFromString, randInt, pick } from './rng.js';
import {
  degToMidi, chordVoicing, bassMidi, nearestChordToneDeg, chordIndex,
  splitBars, fitsBar, hasSuspension, CHORD_VOCAB,
} from './theory.js';
import { normalizeSettings } from './settings.js';

/**
 * @typedef {{ deg: number, beat: number, dur: number, vel: number }} FragNote
 * @typedef {{ id: string, notes: FragNote[], startDeg: number, endDeg: number,
 *             contour: string, peakDeg: number, peakCount: number, tension: number,
 *             fit: Record<string, number[][]>, sus: Record<string, number[][]> }} Fragment
 * @typedef {{ id: string, mode: string, bars: {chord: string}[] }} Progression
 */

export const SECTION_NAMES = ['A', "A'", 'B', "A''"];

// どのセクションがどちらの進行を、どれだけ崩して使うか。
// A / A' / A'' を同じ進行の変形で通すことで統一感が出て、B だけが「よそへ行く」。
const SECTION_PLAN = [
  { source: 0, level: 0 }, // A
  { source: 0, level: 1 }, // A'   2小節目を転回形に
  { source: 1, level: 0 }, // B    別の進行
  { source: 0, level: 2 }, // A''  転回形＋終止をサブドミナントマイナーへ
];

// 伴奏のアルペジオ位置。8分音符で途切れさせない。
// 4点だけだと左手が止まって聴こえ、曲全体が停滞する（実際のピアノの左手は流れ続ける）。
const ACCOMP_OFFSETS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
// 8分の長さ(0.5)より少し伸ばして、ペダルのように隣同士を重ねる。
const ACCOMP_DUR = 0.75;
// 音数が倍になるぶん、1音あたりは弱くする。
const ACCOMP_VEL = 0.3;
const ACCOMP_LOWEST = 48;
const PAD_VEL = 0.3;
const PAD_LOWEST = 55;
const BASS_VEL = 0.5;
const BASS_LOWEST = 36;

// 断片が1件も適合しなかったときに鳴らす音の強さ。
const FALLBACK_VEL = [0.55, 0.5];
// 断片が小節を空けていたときに埋める音の強さ。
const FILL_VEL = 0.5;

// 進行データが空、あるいはそのモードの進行が1つも無いときの最終手段。
// データ不備で曲が生成できないより、平凡でも鳴るほうがましという判断。
const DEFAULT_PROGRESSION = {
  major: {
    id: 'default-major',
    mode: 'major',
    bars: [{ chord: 'I' }, { chord: 'V' }, { chord: 'vi' }, { chord: 'IV' }],
    cadence: 'open',
    tension: [1, 4, 2, 2],
  },
  minor: {
    id: 'default-minor',
    mode: 'minor',
    bars: [{ chord: 'i' }, { chord: 'VII' }, { chord: 'VI' }, { chord: 'V' }],
    cadence: 'open',
    tension: [1, 3, 2, 4],
  },
};

// level 2 で終止に差し込む「翳り」のコード。長調でも短調の色を1つ混ぜると泣ける。
const SUBDOMINANT_MINOR = { major: 'iv', minor: 'VI' };

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * 分散和音の何番目の構成音を鳴らすか。上行して下行する三角波で巡回する。
 * 構成音3つなら 0,1,2,1,0,1,2,1、4つなら 0,1,2,3,2,1,0,1。
 * 単純な i % v の繰り返しは折り返しが無く、機械的に聴こえる。
 */
export function arpeggioIndex(i, voices) {
  if (voices <= 1) return 0;
  const period = 2 * (voices - 1);
  const t = ((i % period) + period) % period;
  return t < voices ? t : period - t;
}

/**
 * クライマックスを置くスロット番号。
 * 最後のスロットに置くと余韻が無いので、1つ手前を頂点にして着地を残す。
 */
export function climaxSlot(slots) {
  return slots >= 3 ? slots - 2 : slots - 1;
}

// カーブを掛ける前の理想の緊張度（1〜5の連続値）。
function rawTension(sectionIdx, slotIdx, slots) {
  if (sectionIdx === 2) {
    // B は頂点へ向かって登り、頂点を過ぎたら少しだけ緩める。
    const cs = climaxSlot(slots);
    if (slotIdx < cs) return 3 + (2 * slotIdx) / Math.max(1, cs);
    if (slotIdx === cs) return 5;
    return 4;
  }
  const t = slots === 1 ? 0 : slotIdx / (slots - 1);
  // A: 1→2（提示）、A': 2→3（高まり）、A'': 3→1（着地）
  const [from, to] = sectionIdx === 0 ? [1, 2] : sectionIdx === 1 ? [2, 3] : [3, 1];
  return from + (to - from) * t;
}

/**
 * スロットに要求する緊張度と音高帯を決める。
 *
 * 非クライマックスの maxPeak を 11 に抑え、クライマックスだけ minPeak 12 を要求する。
 * これで「曲中の最高音が、ただ一度だけ鳴る」が構造的に保証される。
 * 涙腺に効くのは高い音そのものではなく、"そこで初めて届いた" という一回性のほう。
 *
 * @param {number} strength 0〜1に正規化した起伏の強さ。0なら制約なし。
 */
export function curveFor(sectionIdx, slotIdx, slots, strength) {
  const st = clamp(Number.isFinite(strength) ? strength : 1, 0, 1);
  const raw = rawTension(sectionIdx, slotIdx, slots);
  const tension = clamp(Math.round(3 + (raw - 3) * st), 1, 5);
  const isClimax = sectionIdx === 2 && slotIdx === climaxSlot(slots);
  return {
    tension,
    maxPeak: st === 0 ? 15 : isClimax ? 15 : sectionIdx === 3 ? 10 : 11,
    minPeak: st === 0 ? 1 : isClimax ? 12 : 1,
  };
}

/**
 * 進行を段階的に崩す。同じ4小節でも、崩し方でセクションの表情が変わる。
 * 変形後の記号が CHORD_VOCAB に無ければ、その変形は諦めて原形を残す
 * （語彙外のコードは断片の fit に載っていないので、選択が全滅する）。
 */
export function varyProgression(prog, level) {
  const bars = prog.bars.map((b) => ({ ...b }));
  const out = { ...prog, bars };
  if (Array.isArray(prog.tension)) out.tension = prog.tension.slice();
  const mode = prog.mode;

  if (level >= 1 && bars.length >= 2) {
    // 2小節目を第1転回形に。ベースが動くだけで進行が滑り出す。
    const sym = bars[1].chord;
    if (!sym.includes('/')) {
      const inv = `${sym}/3`;
      if (chordIndex(mode, inv) >= 0) bars[1].chord = inv;
    }
  }
  if (level >= 2 && bars.length >= 1) {
    const sub = SUBDOMINANT_MINOR[mode];
    if (sub && chordIndex(mode, sub) >= 0) bars[bars.length - 1].chord = sub;
  }
  return out;
}

function fitsChords(m, ctx) {
  const fit = m?.fit?.[ctx.mode];
  if (!Array.isArray(fit) || !Array.isArray(fit[0]) || !Array.isArray(fit[1])) return false;
  return fit[0].includes(ctx.chordAIdx) && fit[1].includes(ctx.chordBIdx);
}

/**
 * 断片フィルタ。level が高いほど厳しい。
 *
 * どのレベルでも譲らないのが「コード適合」と「音高の窓」の2つ。候補が枯れたときに
 * 緩めてよいのは接続と緊張度だけで、音高の窓を緩めた瞬間に非クライマックスの
 * スロットが12度以上を引けてしまい、"最高音は一度だけ" が壊れる。
 *
 *   1: コード適合 ＋ 音高の窓（上限・下限・頂点の一回性）
 *   2: ＋前の断片との接続の滑らかさ
 *   3: ＋緊張度の一致
 */
export function passesFilters(m, ctx, level) {
  if (!fitsChords(m, ctx)) return false;

  if (m.peakDeg > (ctx.maxPeak ?? 15)) return false;
  if (m.peakDeg < (ctx.minPeak ?? 1)) return false;
  // 頂点のスロットでは、断片の中で最高音が2回以上鳴るものを弾く。
  // 他のスロットは天井(11)で頂点に届かないので、曲全体の最高音の一回性は
  // ここだけで守られる。届いた瞬間が2回あると、その1回性が消える。
  if (ctx.soloPeak && (m.peakCount ?? 1) > 1) return false;

  if (level >= 2 && ctx.prevEndDeg !== null && ctx.prevEndDeg !== undefined) {
    if (Math.abs(m.startDeg - ctx.prevEndDeg) > ctx.maxLeap) return false;
  }

  if (level >= 3) {
    if (Math.abs(m.tension - ctx.tension) > 1) return false;
  }
  return true;
}

// 適合する断片が1件も無いときの保険。2小節を全音符2つで埋める。
// 退屈でも構わない。無音の小節を作ること＝音楽が止まることだけは許さない。
function fallbackFragment(ctx) {
  const around = ctx.prevEndDeg ?? 5;
  const degA = nearestChordToneDeg(ctx.chordA, ctx.mode, around);
  const degB = nearestChordToneDeg(ctx.chordB, ctx.mode, degA);
  const lo = Math.min(degA, degB);
  const hi = Math.max(degA, degB);
  return {
    id: 'fallback',
    notes: [
      { deg: degA, beat: 0, dur: 4, vel: FALLBACK_VEL[0] },
      { deg: degB, beat: 4, dur: 4, vel: FALLBACK_VEL[1] },
    ],
    startDeg: degA,
    endDeg: degB,
    contour: 'answer',
    range: [lo, hi],
    span: 0,
    peakDeg: hi,
    peakBeat: degB > degA ? 4 : 0,
    peakCount: 1,
    tension: 1,
    density: 0.25,
    tags: [],
    score: 0,
  };
}

function hasSus(m, ctx) {
  const sus = m?.sus?.[ctx.mode];
  if (!Array.isArray(sus)) return false;
  const [a = [], b = []] = sus;
  return a.includes(ctx.chordAIdx) || b.includes(ctx.chordBIdx);
}

// 断片が「口ずさめる」かどうかは、ほぼペンタトニックかどうかで決まる。
// タグは makeMelodies 側が付ける（major は度数4と7、minor は度数2と6を使わない断片）。
const PENTATONIC_TAG = { major: 'penta-major', minor: 'penta-minor' };

function hasPentatonic(m, mode) {
  const tags = m?.tags;
  return Array.isArray(tags) && tags.includes(PENTATONIC_TAG[mode]);
}

/**
 * ctx が要求するフィルタを通った候補。厳しいレベルから試し、
 * 候補が見つかった時点で打ち切る（妥協は最小限に留める）。
 */
export function fragmentCandidates(melodies, ctx) {
  const pool = Array.isArray(melodies) ? melodies : [];
  for (const level of [3, 2, 1]) {
    const candidates = pool.filter((m) => passesFilters(m, ctx, level));
    if (candidates.length > 0) return candidates;
  }
  return [];
}

/**
 * 候補を好みの順に絞り込む。どの絞り込みも「該当が無ければ絞らない」。
 * データにタグが無い環境でも安全に動くのが条件。
 *
 *   1. 対比      — 楽節の b は a と違う輪郭にする
 *   2. ペンタトニック — 大衆的で口ずさめる旋律の最大の要因
 *   3. 掛留      — 頂点の直前。泣けるかどうかはここで決まる
 */
function narrowCandidates(candidates, ctx) {
  let out = candidates;
  if (ctx.avoidContour) {
    const contrast = out.filter((m) => m.contour !== ctx.avoidContour);
    if (contrast.length > 0) out = contrast;
  }
  if (ctx.preferPenta) {
    const penta = out.filter((m) => hasPentatonic(m, ctx.mode));
    if (penta.length > 0) out = penta;
  }
  if (ctx.preferSus) {
    const sus = out.filter((m) => hasSus(m, ctx));
    if (sus.length > 0) out = sus;
  }
  return out;
}

/** スロットを埋める断片を1つ引く。 */
export function selectFragment(rng, melodies, ctx) {
  const candidates = fragmentCandidates(melodies, ctx);
  if (candidates.length === 0) return fallbackFragment(ctx);
  return pick(rng, narrowCandidates(candidates, ctx));
}

// ---------------------------------------------------------------------------
// 楽節構造（セクションの中身）
//
// セクションを a - a' - b - a'' の楽節にする。a' と a'' は a のゼクエンツ
// （リズムと音形をそのまま保ったままスケール度数を平行移動したもの）で、
// これが「同じ歌が続いている」という感覚を作る。b だけは通常選択で、
// a と違う輪郭を要求して対比を置く。
// ---------------------------------------------------------------------------

const DEG_MIN = 1;
const DEG_MAX = 15;

// 平行移動量の試行順。0（＝そのまま繰り返す）を最初に試すのが重要で、
// コードが変わっていれば同じ旋律でも響きが変わり、変奏として成立する。
// 近い順に ±3 まで試し、そこまでで乗らなければ最後に ±7（オクターブ＝音名は同じまま
// 音域だけ移す）、±4、±5 まで広げる。ここまで広げると9割方は乗る。
const PHRASE_OFFSETS = [0, -1, 1, -2, 2, -3, 3, -7, 7, -4, 4, -5, 5];
// 2周目（64小節のセクション後半）は上下を入れ替えて、同じ場所で同じ動きをさせない。
const PHRASE_OFFSETS_ALT = [0, 1, -1, 2, -2, 3, -3, 7, -7, 4, -4, 5, -5];
// 終止感のある着地音（主和音の構成音）。
const CADENTIAL_DEGREES = [1, 3, 5];

const PHRASE_ROLES = ['a', "a'", 'b', "a''"];

/**
 * セクション内のスロットの役割。
 * slots は 2 / 4 / 8。4以上なら a - a' - b - a'' を1周として繰り返す。
 *
 * anchor はその楽節の a のスロット番号（a 自身は null）。
 * derive が真なら a から導出する（a' と a''）。b は anchor の輪郭との対比に使うだけ。
 */
export function phraseRoles(slots) {
  const roles = [];
  if (slots < 4) {
    // 16小節（スロット2）は a - a' だけ。
    for (let k = 0; k < slots; k++) {
      roles.push(k === 0
        ? { name: 'a', anchor: null, derive: false, cycle: 0 }
        : { name: "a'", anchor: 0, derive: true, cycle: 0 });
    }
    return roles;
  }
  for (let k = 0; k < slots; k++) {
    const cycle = Math.floor(k / 4);
    const idx = k % 4;
    roles.push({
      name: PHRASE_ROLES[idx],
      anchor: idx === 0 ? null : cycle * 4,
      derive: idx === 1 || idx === 3,
      cycle,
    });
  }
  return roles;
}

/** notes のリズム型（拍と長さの並び）。ゼクエンツが作れないときの代替探しに使う。 */
export function rhythmKey(fragment) {
  return (fragment?.notes ?? []).map((n) => `${n.beat}:${n.dur}`).join(',');
}

// 打点の位置だけを見た、ゆるいリズム型。長さが違っても打点が同じなら
// 「同じリズムの続き」には聴こえる。
function onsetKey(fragment) {
  return (fragment?.notes ?? []).map((n) => n.beat).join(',');
}

function scaleDegreeOf(deg) {
  return ((((deg - 1) % 7) + 7) % 7) + 1;
}

/**
 * 断片のスケール度数を平行移動する。リズム（beat / dur / vel）はそのまま。
 * 1〜15 に収まらない音が出る offset は「音形が潰れる」ので不採用（null を返す）。
 *
 * fit / sus は移調後には使えないので捨てる（必要なら attachFitSus で作り直す）。
 */
export function transposeFragment(fragment, offset) {
  const src = Array.isArray(fragment?.notes) ? fragment.notes : [];
  if (src.length === 0) return null;
  const notes = [];
  for (const n of src) {
    const deg = n.deg + offset;
    if (deg < DEG_MIN || deg > DEG_MAX) return null;
    notes.push({ ...n, deg });
  }
  const degs = notes.map((n) => n.deg);
  const peakDeg = Math.max(...degs);
  const lo = Math.min(...degs);
  const peakNote = notes.find((n) => n.deg === peakDeg);
  // ペンタトニックのタグは移調で成り立たなくなることがある（度数3→4 など）。
  // 実際の音で確かめて、成り立たなくなったタグだけ落とす（付け足しはしない）。
  const tags = (fragment.tags ?? []).filter((t) => {
    if (t === PENTATONIC_TAG.major) return degs.every((d) => ![4, 7].includes(scaleDegreeOf(d)));
    if (t === PENTATONIC_TAG.minor) return degs.every((d) => ![2, 6].includes(scaleDegreeOf(d)));
    return true;
  });
  return {
    ...fragment,
    id: `${fragment.id}+${offset}`,
    notes,
    startDeg: notes[0].deg,
    endDeg: notes[notes.length - 1].deg,
    range: [lo, peakDeg],
    span: peakDeg - lo,
    peakDeg,
    peakBeat: peakNote ? peakNote.beat : 0,
    peakCount: degs.filter((d) => d === peakDeg).length,
    tags,
    fit: { major: [[], []], minor: [[], []] },
    sus: { major: [[], []], minor: [[], []] },
  };
}

// 移調後の断片に fit / sus を作り直して付ける。曲中で要るのは今のモードだけ。
function attachFitSus(fragment, mode) {
  const [b0, b1] = splitBars(fragment.notes);
  const f0 = []; const f1 = []; const s0 = []; const s1 = [];
  CHORD_VOCAB[mode].forEach((sym, i) => {
    if (fitsBar(b0, mode, sym)) {
      f0.push(i);
      if (hasSuspension(b0, mode, sym)) s0.push(i);
    }
    if (fitsBar(b1, mode, sym)) {
      f1.push(i);
      if (hasSuspension(b1, mode, sym)) s1.push(i);
    }
  });
  const fit = { major: [[], []], minor: [[], []] };
  const sus = { major: [[], []], minor: [[], []] };
  fit[mode] = [f0, f1];
  sus[mode] = [s0, s1];
  return { ...fragment, fit, sus };
}

// 移調後は fit の添字が当てにならないので、実際に小節へ乗るかを計算し直す。
function fitsSlotChords(fragment, ctx) {
  const [b0, b1] = splitBars(fragment.notes);
  return fitsBar(b0, ctx.mode, ctx.chordA) && fitsBar(b1, ctx.mode, ctx.chordB);
}

/**
 * a から a'（a''）を導出する。
 * 平行移動量を順に試し、そのスロットの2つのコードに実際に乗るものを採る。
 * 音高の窓（maxPeak / minPeak）は選択と同じ条件で守る。ここを緩めると
 * 非クライマックスのスロットが頂点に並んで「最高音は一度だけ」が壊れる。
 *
 * @returns {{offset:number, fragment:object}|null}
 */
export function deriveFragment(anchor, ctx, opts = {}) {
  if (!anchor || !Array.isArray(anchor.notes) || anchor.notes.length === 0) return null;
  const offsets = opts.offsets ?? PHRASE_OFFSETS;
  const accepted = [];
  for (const offset of offsets) {
    if (opts.exclude !== null && opts.exclude !== undefined && offset === opts.exclude) continue;
    const moved = transposeFragment(anchor, offset);
    if (!moved) continue;
    if (moved.peakDeg > (ctx.maxPeak ?? 15)) continue;
    if (moved.peakDeg < (ctx.minPeak ?? 1)) continue;
    if (!fitsSlotChords(moved, ctx)) continue;
    accepted.push({ offset, fragment: moved });
  }
  if (accepted.length === 0) return null;
  // a'' は着地感を優先する。主和音の構成音で終われるならそちらを選ぶ。
  const chosen = (opts.cadential
    && accepted.find((a) => CADENTIAL_DEGREES.includes(scaleDegreeOf(a.fragment.endDeg))))
    || accepted[0];
  return { offset: chosen.offset, fragment: attachFitSus(chosen.fragment, ctx.mode) };
}

/**
 * ゼクエンツが作れないときの代替。a と同じリズム型の別の断片なら、
 * 音形は違っても「同じ歌の続き」に聴こえる。
 *
 * 拍と長さの完全一致を先に、無ければ打点だけの一致を探す。
 * フィルタは厳しい順に緩めていく（リズムが揃うことのほうが、緊張度の一致より効く）。
 */
export function phraseTwin(anchor, melodies, ctx) {
  const key = rhythmKey(anchor);
  if (!key) return null;
  const onsets = onsetKey(anchor);
  const pool = Array.isArray(melodies) ? melodies : [];
  for (const level of [3, 2, 1]) {
    const candidates = pool.filter((m) => m.id !== anchor.id && passesFilters(m, ctx, level));
    if (candidates.length === 0) continue;
    for (const matcher of [(m) => rhythmKey(m) === key, (m) => onsetKey(m) === onsets]) {
      const matches = candidates.filter(matcher);
      if (matches.length > 0) return narrowCandidates(matches, ctx)[0];
    }
  }
  return null;
}

// モチーフを再登場させるスロット。値は A（セクション0）のスロット番号。
//
// コピー元とコピー先はスロット番号を一致させる。スロット k は進行の (2k mod 4) 小節目
// から始まるので、番号がずれるとコードの位置までずれて適合しなくなる。
// 同じ番号なら、level 1 の転回形化（構成音は同じ）でも level 2 の終止差し替え
// （偶数スロットは進行の0,1小節目なので当たらない）でもコードが一致する。
function recallSource(sectionIdx, slotIdx, slots) {
  if (sectionIdx === 1 && slotIdx === 0) return 0;
  if (sectionIdx === 3) {
    if (slotIdx === 0) return 0;
    // slots は 2 / 4 / 8。slots-2 は 0 / 2 / 6 で必ず偶数。
    // slots===2 のときは 0 と衝突するので、A'' の再登場は頭の1回だけにする。
    if (slots >= 3 && slotIdx === slots - 2) return slots - 2;
  }
  return null;
}

// 再登場する断片は接続・起伏のフィルタを免除する（もう決まった旋律なので選び直さない）。
// ただしコード適合だけは検査する。移動先の和音とぶつかったままでは「再会」にならない。
function resolveRecall(src, melodies, ctx) {
  if (!src) return null;
  if (fitsChords(src, ctx)) return src;
  // 輪郭と歌い出しが同じ断片なら、聴感上は「同じモチーフ」として通る。
  // ただし代替は「選び直し」なので音高の天井だけは守らせる。
  // ここを免除すると代替がクライマックスの最高音に並び、頂点の一回性が壊れる。
  const pool = Array.isArray(melodies) ? melodies : [];
  for (const m of pool) {
    if (m.contour !== src.contour || m.startDeg !== src.startDeg) continue;
    if (m.peakDeg > ctx.maxPeak) continue;
    if (fitsChords(m, ctx)) return m;
  }
  return null;
}

function chooseTonic(rng, musicKey) {
  if (musicKey !== 'random') {
    const pc = Number(musicKey);
    // 高すぎるキーはメロディーが上ずるので、上半分は1オクターブ下げる。
    if (Number.isFinite(pc)) return 60 + (pc > 6 ? pc - 12 : pc);
  }
  return 60 + randInt(rng, -4, 3);
}

/**
 * 進行の重み。人気度そのものではなく2乗を使う。
 * 一様に引くと有名進行もマニアックな変形も同じ確率で出て、全体が「よくある感じ」に
 * ならない。2乗なら定番(5)と色物(1)で25倍の差がつき、差が体感できる。
 * popularity を持たないデータは 3（真ん中）として扱う。
 */
export function progressionWeight(prog) {
  const raw = Number(prog?.popularity);
  const pop = Number.isFinite(raw) ? clamp(Math.round(raw), 1, 5) : 3;
  return pop * pop;
}

// 重み付き抽選。rng の消費は pick と同じ1回だけなので決定論性は変わらない。
function pickWeighted(rng, items, weightOf) {
  let total = 0;
  for (const it of items) total += weightOf(it);
  if (!(total > 0)) return pick(rng, items);
  let r = rng() * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r < 0) return it;
  }
  return items[items.length - 1];
}

function chooseProgressions(rng, progressions, mode) {
  const pool = (Array.isArray(progressions) ? progressions : []).filter(
    (p) => p?.mode === mode
      && Array.isArray(p.bars) && p.bars.length === 4
      && p.bars.every((b) => chordIndex(mode, b?.chord) >= 0),
  );
  if (pool.length === 0) {
    const d = DEFAULT_PROGRESSION[mode];
    return [d, d];
  }
  const first = pickWeighted(rng, pool, progressionWeight);
  let second = pickWeighted(rng, pool, progressionWeight);
  // A系とBが同じ進行では「よそへ行った」感が出ない。ただしプールが1件なら諦める。
  for (let i = 0; i < 8 && pool.length > 1 && second.id === first.id; i++) {
    second = pickWeighted(rng, pool, progressionWeight);
  }
  return [first, second];
}

// 断片をスロットの拍位置へ写す。片方の小節が空なら和声音で埋める。
function slotMelodyNotes(fragment, ctx, slotStartBeat, tonicMidi) {
  const { mode, chordA, chordB } = ctx;
  const notes = [];
  const filled = [false, false];
  for (const n of fragment.notes ?? []) {
    const beat = Number(n.beat) || 0;
    filled[beat < 4 ? 0 : 1] = true;
    notes.push({
      midi: degToMidi(n.deg, mode, tonicMidi),
      beat: slotStartBeat + beat,
      dur: n.dur,
      vel: n.vel,
    });
  }
  const chords = [chordA, chordB];
  const around = [fragment.startDeg ?? 5, fragment.endDeg ?? 5];
  for (let b = 0; b < 2; b++) {
    if (filled[b]) continue;
    const deg = nearestChordToneDeg(chords[b], mode, around[b]);
    notes.push({
      midi: degToMidi(deg, mode, tonicMidi),
      beat: slotStartBeat + b * 4,
      dur: 4,
      vel: FILL_VEL,
    });
  }
  notes.sort((a, b) => a.beat - b.beat);
  return notes;
}

/**
 * シードと事前データから1曲を組み立てる。
 * 同じ seed・同じ作曲パラメータなら、何度呼んでも完全に同じ曲になる。
 *
 * @param {string} seed
 * @param {{ melodies: Fragment[], progressions: Progression[] }} data
 * @param {object} settings 作曲系の設定（欠けたキーは settings.js の既定値で埋まる）
 */
export function composeSong(seed, data, settings) {
  const cfg = normalizeSettings(settings);
  const rng = makeRng(seedFromString(String(seed)));

  const bars = Number(cfg.songBars);
  const barsPerSection = bars / 4;
  const repeats = barsPerSection / 4;
  const slotCount = barsPerSection / 2;
  const cs = climaxSlot(slotCount);
  const roles = phraseRoles(slotCount);
  const strength = clamp(cfg.curveStrength / 100, 0, 1);

  // ここから下の乱数の消費順は変えない：mode → tempo → tonic → P1 → P2 → 各スロット。
  const mode = rng() * 100 < cfg.majorRatio ? 'major' : 'minor';
  const tempo = randInt(rng, cfg.tempoMin, cfg.tempoMax);
  const tonicMidi = chooseTonic(rng, cfg.musicKey);

  const melodies = Array.isArray(data?.melodies) ? data.melodies : [];
  const sources = chooseProgressions(rng, data?.progressions, mode);

  const sections = [];
  const melody = [];
  const accomp = [];
  const bass = [];
  const pad = [];
  const motif = [];        // A で選ばれた断片（再登場のコピー元）
  let prevEndDeg = null;   // 直前の断片の終わりの音。曲の最初だけ null

  for (let s = 0; s < SECTION_PLAN.length; s++) {
    const plan = SECTION_PLAN[s];
    const prog = varyProgression(sources[plan.source], plan.level);
    const startBar = s * barsPerSection;

    // 4小節の進行を repeats 回まわしてセクションの長さにする。
    const barChords = [];
    for (let r = 0; r < repeats; r++) for (const b of prog.bars) barChords.push(b.chord);

    const slotRecords = [];
    const slotFragments = [];   // このセクションで実際に使った断片（導出のコピー元）
    const phraseOffset = [];    // 楽節ごとに a' が使った平行移動量（a'' で避ける）
    for (let k = 0; k < slotCount; k++) {
      const chordA = barChords[2 * k];
      const chordB = barChords[2 * k + 1];
      const curve = curveFor(s, k, slotCount, strength);
      const isClimax = s === 2 && k === cs;
      const role = roles[k];
      const anchor = role.anchor === null ? null : slotFragments[role.anchor];
      // セクションの頭と頂点だけは跳躍を許す（新しい息継ぎ、あるいは意図した飛翔）。
      const allowLeap = k === 0 || isClimax;
      const ctx = {
        mode,
        chordA,
        chordB,
        chordAIdx: chordIndex(mode, chordA),
        chordBIdx: chordIndex(mode, chordB),
        prevEndDeg,
        tension: curve.tension,
        maxPeak: curve.maxPeak,
        minPeak: curve.minPeak,
        maxLeap: allowLeap ? cfg.maxLeap + 4 : cfg.maxLeap,
        preferSus: s === 2 && k === cs - 1,
        soloPeak: isClimax && strength > 0,
        // 頂点は「そこで初めて届いた音」が最優先。ペンタトニックに寄せると
        // かえって頂点が埋もれるので、ここだけは絞らない。
        preferPenta: !isClimax,
        // b は a と違う輪郭にして対比を作る。
        avoidContour: role.name === 'b' && anchor ? anchor.contour : null,
      };

      let fragment = null;
      let reusedFrom = null;
      let derivedFrom = null;
      let offset = null;
      let source = 'select';

      // 1. セクションをまたぐモチーフの再登場（最優先）
      const srcIdx = cfg.motifRecall ? recallSource(s, k, slotCount) : null;
      if (srcIdx !== null) {
        const resolved = resolveRecall(motif[srcIdx], melodies, ctx);
        if (resolved) {
          fragment = resolved;
          reusedFrom = `${SECTION_NAMES[0]}:${srcIdx}`;
          source = 'recall';
        }
      }

      // 2. 楽節内のゼクエンツ（a' / a''）。
      //    クライマックスだけは楽節構造より音高の条件を優先して通常選択に回す。
      if (!fragment && role.derive && anchor && !isClimax) {
        const offsets = role.cycle % 2 === 0 ? PHRASE_OFFSETS : PHRASE_OFFSETS_ALT;
        const cadential = role.name === "a''";
        // a'' が a' と同じ移動量では、同じコードの上に同じものが並ぶ。
        const exclude = cadential ? phraseOffset[role.anchor] : null;
        let derived = deriveFragment(anchor, ctx, { offsets, exclude, cadential });
        // 3. 移調では乗らないとき。同じリズム型の別の断片で「続き」に聴かせる。
        const twin = derived ? null : phraseTwin(anchor, melodies, ctx);
        // 4. それも無ければ、避けていた移動量まで戻して使う。
        //    a' の繰り返しになるが、無関係な断片を挟むよりは歌が途切れない。
        if (!derived && !twin && exclude !== null && exclude !== undefined) {
          derived = deriveFragment(anchor, ctx, { offsets, cadential });
        }
        if (derived) {
          fragment = derived.fragment;
          derivedFrom = role.anchor;
          offset = derived.offset;
          source = 'transpose';
          if (role.name === "a'") phraseOffset[role.anchor] = derived.offset;
        } else if (twin) {
          fragment = twin;
          derivedFrom = role.anchor;
          source = 'rhythm';
        }
      }

      // 5. 通常選択
      if (!fragment) {
        fragment = selectFragment(rng, melodies, ctx);
        source = fragment.id === 'fallback' ? 'fallback' : 'select';
      }
      slotFragments[k] = fragment;
      if (s === 0) motif[k] = fragment;

      const slotStartBeat = (startBar + 2 * k) * 4;
      for (const n of slotMelodyNotes(fragment, ctx, slotStartBeat, tonicMidi)) melody.push(n);

      slotRecords.push({
        fragmentId: fragment.id,
        reusedFrom,
        role: role.name,
        derivedFrom,
        offset,
        source,
      });
      prevEndDeg = fragment.endDeg;
    }

    for (let b = 0; b < barChords.length; b++) {
      const chord = barChords[b];
      const beat = (startBar + b) * 4;
      pad.push({ midis: chordVoicing(chord, mode, tonicMidi, PAD_LOWEST), beat, dur: 4, vel: PAD_VEL });
      bass.push({ midi: bassMidi(chord, mode, tonicMidi, BASS_LOWEST), beat, dur: 4, vel: BASS_VEL });
      const voicing = chordVoicing(chord, mode, tonicMidi, ACCOMP_LOWEST);
      for (let i = 0; i < ACCOMP_OFFSETS.length; i++) {
        accomp.push({
          midi: voicing[arpeggioIndex(i, voicing.length)],
          beat: beat + ACCOMP_OFFSETS[i],
          dur: ACCOMP_DUR,
          vel: ACCOMP_VEL,
        });
      }
    }

    sections.push({
      name: SECTION_NAMES[s],
      progressionId: prog.id,
      startBar,
      slots: slotRecords,
    });
  }

  // 頂点の拍。演奏側はここだけテヌートを掛けるので、同点なら最初の1つを指す。
  let climaxBeat = 0;
  let highest = -Infinity;
  for (const n of melody) {
    if (n.midi > highest) {
      highest = n.midi;
      climaxBeat = n.beat;
    }
  }

  return {
    seed,
    mode,
    tonicMidi,
    tempo,
    bars,
    totalBeats: bars * 4,
    climaxBeat,
    sections,
    melody,
    accomp,
    bass,
    pad,
  };
}
