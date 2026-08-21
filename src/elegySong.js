// 曲を組む。主題を育てる階層型。
//
//   1. 2小節の主動機をひとつ作る
//   2. 変奏はリズム・方向・終止音のいずれか**ひとつだけ**を変える
//   3. 8小節をひとつのフレーズにする
//   4. 4セクションに 提示 → 喪失 → クライマックス → 回想 の役割を与える
//   5. 全小節を独立生成しない。新しい音型を足す前に、既存の動機を変奏できないか見る
//
// 生成後に機械で検査し、違反があれば別の種で作り直す。

import { makeRng } from './rng.js';
import { HARMONY, chordAt, chordAtBeat, isChordTone, RANGE, degToMidi } from './elegy.js';
import { makeMotif, varyMotif, fragmentMotif, augmentMotif } from './elegyMotif.js';
import {
  placeMotif, resolveNonChordTones, fixLeaps, offsetBarHeads, ensureRests, nearestChordTone,
} from './elegyMelody.js';

const { MEL_LO, MEL_HI, LH_LO, LH_HI, BEATS_PER_BAR } = RANGE;

const BARS = 32;
const TEMPO = 68;
const PEAK_MIDI = MEL_HI;          // Ab5
const PEAK_BAR_RANGE = [20, 23];   // 第21〜24小節（0始まり）

// セクションの役割。anchor はそのセクションで旋律を置きたいおおよその高さ。
const SECTIONS = [
  { name: '提示', from: 0, anchor: 68, plan: ['motif', 'ending', 'rhythm', 'cadence'] },
  { name: '喪失', from: 8, anchor: 67, plan: ['augment', 'mirror', 'motif', 'cadence'] },
  { name: 'クライマックス', from: 16, anchor: 74, plan: ['motif', 'rhythm', 'peak', 'cadence'] },
  { name: '回想', from: 24, anchor: 66, plan: ['fragment', 'motif', 'fragment', 'cadence'] },
];

/** 2小節ぶんの動機を、役割に応じて選ぶ。新しい音型は足さない。 */
function variantFor(kind, motif, rng) {
  if (kind === 'motif') return motif;
  if (kind === 'mirror') return varyMotif(motif, 'mirror', rng);
  if (kind === 'rhythm') return varyMotif(motif, 'rhythm', rng);
  if (kind === 'ending' || kind === 'cadence') return varyMotif(motif, 'ending', rng);
  if (kind === 'fragment') {
    // 断片は1小節ぶんしか無いので、そのままだと2小節目が丸ごと空く
    // （第26・30小節が休みになっていた）。後半へ、終止を変えた形をもう一度置く。
    const head = fragmentMotif(motif);
    if (!head) return motif;
    const tail = varyMotif(motif, 'ending', rng);
    const tailNotes = tail.rhythm
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.b >= 4);
    return {
      rhythm: [...head.rhythm, ...tailNotes.map(({ r }) => ({ ...r }))],
      shape: [...head.shape, ...tailNotes.map(({ i }) => tail.shape[i] ?? 0)],
      tag: 'var:fragment',
    };
  }
  if (kind === 'augment') return augmentMotif(motif) ?? motif;
  if (kind === 'peak') return varyMotif(motif, 'ending', rng);
  return motif;
}

/** 旋律を作る。 */
function buildMelody(motif, rng) {
  const notes = [];
  const phraseHeads = new Set();
  let prev = null;

  for (const sec of SECTIONS) {
    for (let p = 0; p < 4; p += 1) {
      const bar = sec.from + p * 2;
      const kind = sec.plan[p];
      const shaped = variantFor(kind, motif, rng);
      phraseHeads.add(bar);
      // フレーズの中で高さを動かす。頂点のスロットだけ高く狙う。
      const anchor = kind === 'peak' ? PEAK_MIDI - 2 : sec.anchor + (p === 1 ? 2 : 0);
      const placed = placeMotif(shaped, bar, anchor, prev);
      for (const n of placed) {
        n.role = kind;
        notes.push(n);
      }
      prev = placed.length ? placed[placed.length - 1].midi : prev;
    }
  }
  notes.sort((a, b) => a.beat - b.beat);
  return { notes, phraseHeads };
}

/**
 * 最高音 Ab5 を1回だけ置く。
 *
 * 第23小節は G7。Ab はその b9 にあたるので、掛留として鳴らして半音下の G へ
 * 下行解決させる。仕様の「掛留音または9thとして鳴らし、直後に下行解決」を
 * この1点で満たす。
 */
function placePeak(notes) {
  const peakBar = 22;   // 第23小節（0始まり）= G7
  const inBar = notes
    .filter((n) => Math.floor(n.beat / BEATS_PER_BAR) === peakBar)
    .sort((a, b) => a.beat - b.beat);
  if (inBar.length < 2) return null;
  // その小節でいちばん長い音を頂点にする（短い装飾では頂点にならない）
  let peak = inBar[0];
  for (const n of inBar) if (n.dur > peak.dur) peak = n;
  peak.midi = PEAK_MIDI;
  peak.isPeak = true;
  peak.keepDissonance = true;   // b9 なので和声音へ寄せさせない
  // 直後を半音下（G5）へ。下行解決。
  const idx = notes.indexOf(peak);
  const after = notes[idx + 1];
  if (after) {
    after.midi = PEAK_MIDI - 1;
    after.resolvesPeak = true;
  }
  return peak;
}

/** 頂点以外が Ab5 に届かないよう、天井を1つ下げる。 */
function capBelowPeak(notes) {
  for (const n of notes) {
    if (n.isPeak || n.resolvesPeak) continue;
    if (n.midi >= PEAK_MIDI) {
      const bar = Math.floor(n.beat / BEATS_PER_BAR);
      const inBar = n.beat - bar * BEATS_PER_BAR;
      n.midi = nearestChordTone(PEAK_MIDI - 3, chordAtBeat(bar, inBar), MEL_LO, PEAK_MIDI - 2);
    }
  }
  return notes;
}

/** 完全に同じ小節が出ないよう、2つ目を1音ずらす。 */
function breakExactCopies(notes) {
  const sig = (bar) => notes
    .filter((n) => Math.floor(n.beat / BEATS_PER_BAR) === bar)
    .sort((a, b) => a.beat - b.beat)
    .map((n) => `${(n.beat % BEATS_PER_BAR).toFixed(2)}:${n.dur}:${n.midi}`)
    .join(',');
  const seen = new Map();
  for (let bar = 0; bar < BARS; bar += 1) {
    const s = sig(bar);
    if (!s) continue;
    if (!seen.has(s)) { seen.set(s, bar); continue; }
    // 完全一致。この小節の最後の音を隣の和声音へずらす
    const list = notes
      .filter((n) => Math.floor(n.beat / BEATS_PER_BAR) === bar)
      .sort((a, b) => a.beat - b.beat);
    const last = list[list.length - 1];
    if (!last || last.isPeak) continue;
    const inBar = last.beat - bar * BEATS_PER_BAR;
    const chord = chordAtBeat(bar, inBar);
    const alt = nearestChordTone(last.midi - 2, chord, MEL_LO, PEAK_MIDI - 2);
    if (alt !== last.midi) last.midi = alt;
  }
  return notes;
}

// ---------------------------------------------------------------------------
// 伴奏。左手は C2〜C4、旋律より上に出ない。
// セクションごとに厚みを変える（疎ら → 内声 → 広げる → 減らす）。
// ---------------------------------------------------------------------------

/** その和音を左手の音域に積む。lowest から上へ、旋律の天井を越えない範囲で。 */
function voice(chord, ceiling) {
  const out = [];
  const bassPc = chord.bass;
  let bass = LH_LO;
  while (((bass % 12) + 12) % 12 !== bassPc) bass += 1;
  while (bass + 12 <= LH_LO + 7) bass += 12;
  out.push(bass);
  // 上声は根音より上、天井の下に積む
  for (const pc of chord.pcs) {
    let m = bass + 1;
    while (((m % 12) + 12) % 12 !== pc) m += 1;
    while (m < bass + 7) m += 12;
    if (m <= Math.min(LH_HI, ceiling - 1)) out.push(m);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

const PATTERNS = {
  // 提示: 疎らな分散和音。根音と上声だけ
  sparse: [{ b: 0, v: 'low', d: 2 }, { b: 2, v: 'upper', d: 2 }],
  // 喪失: 内声を足す
  inner: [{ b: 0, v: 'low', d: 1.5 }, { b: 1.5, v: 'mid', d: 0.5 },
    { b: 2, v: 'upper', d: 1 }, { b: 3, v: 'mid', d: 1 }],
  // クライマックス: 音域と密度を広げる
  wide: [{ b: 0, v: 'low', d: 1 }, { b: 1, v: 'mid', d: 0.5 }, { b: 1.5, v: 'upper', d: 0.5 },
    { b: 2, v: 'low', d: 1 }, { b: 3, v: 'mid', d: 0.5 }, { b: 3.5, v: 'upper', d: 0.5 }],
  // 回想: 再び減らす
  thin: [{ b: 0, v: 'low', d: 3 }, { b: 3, v: 'upper', d: 1 }],
};
const SECTION_PATTERN = ['sparse', 'inner', 'wide', 'thin'];

function buildAccomp(melody) {
  const accomp = [];
  const bass = [];
  const pedal = [];
  for (let bar = 0; bar < BARS; bar += 1) {
    // その小節で旋律がいちばん低いところ。伴奏はこれを越えない。
    const inBar = melody.filter((n) => n.beat < (bar + 1) * BEATS_PER_BAR
      && n.beat + n.dur > bar * BEATS_PER_BAR);
    const ceiling = inBar.length ? Math.min(...inBar.map((n) => n.midi)) : LH_HI + 1;

    const half = Array.isArray(HARMONY[bar]);
    const spans = half ? [[0, 2], [2, 2]] : [[0, 4]];
    for (const [from, len] of spans) {
      const chord = chordAtBeat(bar, from);
      const v = voice(chord, ceiling);
      const low = v[0];
      const mid = v.length > 2 ? v[1] : v[0];
      const upper = v.slice(1);
      const pat = PATTERNS[SECTION_PATTERN[Math.floor(bar / 8)]];
      bass.push({ midi: low, beat: bar * BEATS_PER_BAR + from, dur: len, vel: 0.42 });
      for (const step of pat) {
        if (step.b >= len) continue;
        const beat = bar * BEATS_PER_BAR + from + step.b;
        const dur = Math.min(step.d, len - step.b);
        if (step.v === 'low') continue;   // 根音はベースが持つ
        const midis = step.v === 'mid' ? [mid] : upper;
        const kept = midis.filter((m) => m < ceiling);
        if (kept.length === 0) continue;
        accomp.push({ midi: kept[0], midis: kept, beat, dur, vel: 0.28 });
      }
      // ペダルは和音が変わる位置で必ず切る
      pedal.push({ beat: bar * BEATS_PER_BAR + from, dur: len });
    }
  }
  return { accomp, bass, pedal };
}

// ---------------------------------------------------------------------------
// 検査
// ---------------------------------------------------------------------------

export function inspect(song) {
  const issues = [];
  const mel = song.melody.slice().sort((a, b) => a.beat - b.beat);

  const peaks = mel.filter((n) => n.midi >= PEAK_MIDI);
  if (peaks.length !== 1) issues.push(`最高音が ${peaks.length} 回（1回であること）`);
  else {
    const bar = Math.floor(peaks[0].beat / BEATS_PER_BAR);
    if (bar < PEAK_BAR_RANGE[0] || bar > PEAK_BAR_RANGE[1]) {
      issues.push(`最高音が第${bar + 1}小節（21〜24小節であること）`);
    }
    const idx = mel.indexOf(peaks[0]);
    const after = mel[idx + 1];
    if (!after || after.midi >= peaks[0].midi) issues.push('最高音が下行解決していない');
  }

  if (mel.some((n) => n.midi < MEL_LO || n.midi > MEL_HI)) issues.push('旋律が音域外');

  const sigs = new Map();
  for (let bar = 0; bar < BARS; bar += 1) {
    const s = mel.filter((n) => Math.floor(n.beat / BEATS_PER_BAR) === bar)
      .map((n) => `${(n.beat % BEATS_PER_BAR).toFixed(2)}:${n.dur}:${n.midi}`).join(',');
    if (!s) continue;
    if (sigs.has(s)) issues.push(`第${sigs.get(s) + 1}と第${bar + 1}小節が完全一致`);
    else sigs.set(s, bar);
  }

  // 伴奏が旋律を越えていないか
  for (const e of [...song.accomp, ...song.bass]) {
    const over = mel.filter((n) => n.beat < e.beat + e.dur && n.beat + n.dur > e.beat);
    if (over.length === 0) continue;
    const top = Math.max(...(e.midis ?? [e.midi]));
    if (top >= Math.min(...over.map((n) => n.midi))) {
      issues.push(`拍${e.beat}で伴奏が旋律を越えた`);
      break;
    }
  }

  // 非和声音が解決されているか（頂点は別扱い）
  let unresolved = 0;
  for (let i = 0; i < mel.length; i += 1) {
    const n = mel[i];
    if (n.isPeak) continue;
    const bar = Math.floor(n.beat / BEATS_PER_BAR);
    const chord = chordAtBeat(bar, n.beat - bar * BEATS_PER_BAR);
    if (isChordTone(n.midi, chord)) continue;
    const nx = mel[i + 1];
    if (!nx || Math.abs(nx.midi - n.midi) > 2) unresolved += 1;
  }
  if (unresolved > 0) issues.push(`解決しない非和声音が ${unresolved} 音`);

  // 最終4小節が終止として成立しているか
  const last = mel[mel.length - 1];
  const tonicPcs = [0, 3, 7];
  if (!last || !tonicPcs.includes(((last.midi % 12) + 12) % 12)) {
    issues.push('最後の音が主和音の構成音でない');
  }
  if (last && last.beat + last.dur < BARS * BEATS_PER_BAR - 1) {
    issues.push('最後の音が終わりまで伸びていない');
  }

  // すべての小節が小節頭から始まっていないか
  let heads = 0;
  let played = 0;
  for (let bar = 0; bar < BARS; bar += 1) {
    const list = mel.filter((n) => Math.floor(n.beat / BEATS_PER_BAR) === bar);
    if (list.length === 0) continue;
    played += 1;
    if (list.some((n) => n.beat === bar * BEATS_PER_BAR)) heads += 1;
  }
  if (played > 0 && heads === played) issues.push('すべての小節が小節頭から始まっている');

  return issues;
}

// ---------------------------------------------------------------------------

/** 種をひとつ与えて1曲作る（検査はしない）。 */
export function composeOnce(seed) {
  const rng = makeRng(seed);
  const motif = makeMotif(rng);
  const { notes, phraseHeads } = buildMelody(motif, rng);

  placePeak(notes);
  capBelowPeak(notes);
  fixLeaps(notes);
  resolveNonChordTones(notes);
  offsetBarHeads(notes, rng, phraseHeads);
  ensureRests(notes);
  breakExactCopies(notes);
  notes.sort((a, b) => a.beat - b.beat);

  // 最後の音は主音を最終小節の終わりまで伸ばす
  const last = notes[notes.length - 1];
  if (last) {
    last.midi = nearestChordTone(66, chordAt(BARS - 1), MEL_LO, MEL_HI);
    last.dur = Math.max(2, BARS * BEATS_PER_BAR - last.beat);
  }

  const { accomp, bass, pedal } = buildAccomp(notes);
  const melody = notes.map((n) => ({
    midi: n.midi, beat: n.beat, dur: n.dur, vel: n.isPeak ? 0.78 : 0.62,
  }));
  const peak = notes.find((n) => n.isPeak);

  return {
    seed: String(seed),
    mode: 'minor',
    instrument: 'piano',
    tonicMidi: 60,
    tempo: TEMPO,
    bars: BARS,
    totalBeats: BARS * BEATS_PER_BAR,
    climaxBeat: peak ? peak.beat : 0,
    breathBar: null,
    modulation: null,
    sections: SECTIONS.map((s, i) => ({
      name: s.name, startBar: s.from, tonicMidi: 60, slots: [], progressionId: `elegy-${i}`,
    })),
    chords: HARMONY.map((h, bar) => {
      const c = chordAt(bar);
      return { bar, symbol: c.name, rootPc: c.pcs[0], bassPc: c.bass, pcs: [...c.pcs].sort((a, b) => a - b) };
    }),
    melody,
    accomp,
    bass,
    pad: [],
    pedal,
    motifTag: motif.tag,
  };
}

/** 検査を通るまで種を替えて作り直す。 */
export function compose(startSeed = 1, attempts = 200) {
  let best = null;
  let bestIssues = null;
  for (let i = 0; i < attempts; i += 1) {
    const song = composeOnce(startSeed + i);
    const issues = inspect(song);
    if (issues.length === 0) return { song, issues, seed: startSeed + i, tries: i + 1 };
    if (bestIssues === null || issues.length < bestIssues.length) {
      best = song; bestIssues = issues;
    }
  }
  return { song: best, issues: bestIssues, seed: null, tries: attempts };
}
