// 事前データ（メロディー断片999個・コード進行99個）から1曲を組み立てる中核モジュール。
//
// 断片をただランダムに並べても「綺麗な断片の羅列」にしかならず、絶対に泣けない。
// ここでやるのは次の3つだけで、その3つが「断片の列」を「曲」に変える。
//
//   1. 接続の滑らかさ — 前の断片の終わりと次の断片の始まりを近い音でつなぐ
//   2. 曲全体の起伏   — A→A'→B→A'' の中で緊張を積み上げ、B で一度だけ頂点を作る
//   3. モチーフの再登場 — A で鳴った旋律を、変形した進行の上へ帰ってこさせる
//
// 乱数は composeSong の中で作る1本だけを使う。Math.random() は使わない。
// 消費順を変えると同じシードでも同じ曲にならなくなるので、処理順は固定。
import { makeRng, seedFromString, randInt, pick } from './rng.js';
import {
  degToMidi, chordVoicing, bassMidi, nearestChordToneDeg, chordIndex,
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

// 伴奏のアルペジオ位置。3拍目の裏まで動かすと歌が埋まるので4点だけ。
const ACCOMP_OFFSETS = [0, 1.5, 2, 3.5];
const ACCOMP_DUR = 1.5;
const ACCOMP_VEL = 0.35;
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

/**
 * スロットを埋める断片を1つ引く。
 * 厳しいフィルタから順に試し、候補が見つかった時点で打ち切る（妥協は最小限に留める）。
 */
export function selectFragment(rng, melodies, ctx) {
  const pool = Array.isArray(melodies) ? melodies : [];
  let candidates = [];
  for (const level of [3, 2, 1]) {
    candidates = pool.filter((m) => passesFilters(m, ctx, level));
    if (candidates.length > 0) break;
  }
  if (candidates.length === 0) return fallbackFragment(ctx);

  // 頂点の直前は掛留（非和声音の解決）を優先する。泣けるかどうかはここで決まる。
  if (ctx.preferSus) {
    const sus = candidates.filter((m) => hasSus(m, ctx));
    if (sus.length > 0) candidates = sus;
  }
  return pick(rng, candidates);
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
  const first = pick(rng, pool);
  let second = pick(rng, pool);
  // A系とBが同じ進行では「よそへ行った」感が出ない。ただしプールが1件なら諦める。
  for (let i = 0; i < 8 && pool.length > 1 && second.id === first.id; i++) {
    second = pick(rng, pool);
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
    for (let k = 0; k < slotCount; k++) {
      const chordA = barChords[2 * k];
      const chordB = barChords[2 * k + 1];
      const curve = curveFor(s, k, slotCount, strength);
      const isClimax = s === 2 && k === cs;
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
      };

      let fragment = null;
      let reusedFrom = null;
      const srcIdx = cfg.motifRecall ? recallSource(s, k, slotCount) : null;
      if (srcIdx !== null) {
        const resolved = resolveRecall(motif[srcIdx], melodies, ctx);
        if (resolved) {
          fragment = resolved;
          reusedFrom = `${SECTION_NAMES[0]}:${srcIdx}`;
        }
      }
      if (!fragment) fragment = selectFragment(rng, melodies, ctx);
      if (s === 0) motif[k] = fragment;

      const slotStartBeat = (startBar + 2 * k) * 4;
      for (const n of slotMelodyNotes(fragment, ctx, slotStartBeat, tonicMidi)) melody.push(n);

      slotRecords.push({ fragmentId: fragment.id, reusedFrom });
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
          midi: voicing[i % voicing.length],
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
