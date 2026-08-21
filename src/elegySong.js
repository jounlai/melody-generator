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
import {
  HARMONY, chordAt, chordAtBeat, isChordTone, chordTones, RANGE,
} from './elegy.js';
import {
  makeMotif, varyMotif, fragmentMotif, augmentMotif, CLOSING_RHYTHMS, fitShape,
} from './elegyMotif.js';
import {
  placeMotif, resolveNonChordTones, fixLeaps, offsetBarHeads, ensureRests,
  settlePhraseEnds, endOnTonic, nearestChordTone,
} from './elegyMelody.js';

const { MEL_LO, MEL_HI, LH_LO, LH_HI, BEATS_PER_BAR } = RANGE;

const BARS = 32;
const TEMPO = 68;
const PEAK_MIDI = MEL_HI;          // Ab5
const PEAK_BAR_RANGE = [20, 23];   // 第21〜24小節（0始まり）

// セクションの役割。anchor はそのセクションで旋律を置きたいおおよその高さ。
const SECTIONS = [
  // anchor は「そのセクションで旋律を置きたいおおよその高さ」。
  // 提示は低く静かに、喪失で少し翳り、クライマックスで初めて登り、回想で戻る。
  // 全体に低めに取る——「静かに受け入れる」曲なので、高いところで歌い続けない。
  { name: '提示', from: 0, anchor: 64, plan: ['motif', 'ending', 'rhythm', 'cadence'] },
  { name: '喪失', from: 8, anchor: 64, plan: ['augment', 'mirror', 'motif', 'cadence'] },
  { name: 'クライマックス', from: 16, anchor: 72, plan: ['motif', 'rhythm', 'peak', 'cadence'] },
  { name: '回想', from: 24, anchor: 63, plan: ['fragment', 'motif', 'fragment', 'cadence'] },
];

// セクションごとの天井。
//
// !!! 提示をクライマックスと同じ高さまで許してはいけない !!!
// 天井を最高音の1つ下に置いただけでは、提示が第8小節で G5 まで登り、
// 頂点の Ab5 との差が全音1つしか無くなった。それでは山にならないし、
// 「抑制された親密な曲」という前提から外れる。
// 登れるのはクライマックスだけ、と高さで決めておく。
// クライマックスも1つ下まで。Ab5 そのものは頂点の1音だけに残す。
// 回想はいちばん低く。思い出す場面なので、提示より上へ出さない。
const SECTION_CEIL = [74, 75, PEAK_MIDI - 1, 72];   // D5 / Eb5 / G5 / C5

function capBySection(notes) {
  return capTo(notes, (bar) => SECTION_CEIL[Math.min(3, Math.floor(bar / 8))]);
}

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
      let shaped = variantFor(kind, motif, rng);
      // フレーズの4区画のうち、最後だけを「長い音で閉じる」型にする。
      // 途中で閉じると、8小節の一文が2小節のため息4つに割れる。
      if (p === 3) {
        const close = CLOSING_RHYTHMS[Math.floor(rng() * CLOSING_RHYTHMS.length)];
        shaped = {
          rhythm: close.map((r) => ({ ...r })),
          shape: fitShape(shaped.shape, close.length),
          tag: 'var:close',
        };
      }
      phraseHeads.add(bar);
      // フレーズの中で高さを動かす。
      //
      // !!! anchor を据え置きにすると音域が上がり続ける !!!
      // 起点は「前の音から続くこと」を最優先に選ぶので、形が上行するたびに
      // 少しずつ高い位置から始まり、梯子を上がる（実測で第1小節 G4 から
      // 第11小節 G5 まで登りっぱなしになった）。
      // フレーズごとに目標の高さを明示して、上って下りる山を作る。
      const shape = [0, 2, 1, -2];           // 8小節の中での上下（五音の歩数）
      const anchor = kind === 'peak'
        ? PEAK_MIDI - 2
        : sec.anchor + shape[p] * 2;
      // セクションの頭では、前の音との連続を切って高さを取り直す。
      //
      // 起点は「前の音から続くこと」を最優先に選ぶので、そのままだと
      // クライマックスの高さが回想へそのまま引き継がれ、いちばん低く収まる
      // べき回想が提示より高くなっていた。役割の変わり目は、線を切ってよい
      // ——というより、切るのが自然（そこが段落の境目だから）。
      const atSectionHead = p === 0 && sec.from > 0;
      const ceil = kind === 'peak' ? PEAK_MIDI : SECTION_CEIL[Math.floor(bar / 8)];
      const placed = placeMotif(shaped, bar, anchor, atSectionHead ? null : prev, ceil);
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


/**
 * 天井を超える音を、その和音の構成音へ下ろす。
 *
 * !!! 寄せ先を一律にしてはいけない !!!
 * 同じ音へ集めると前後と重なり、同音が3つ続く（実測で3箇所出た）。
 * 隣と重ならない構成音のうち、天井の少し下にいちばん近いものを採る。
 */
function capTo(notes, ceilingFor) {
  const sorted = notes.slice().sort((a, b) => a.beat - b.beat);
  for (let i = 0; i < sorted.length; i += 1) {
    const n = sorted[i];
    if (n.isPeak || n.resolvesPeak) continue;
    const bar = Math.floor(n.beat / BEATS_PER_BAR);
    const ceil = ceilingFor(bar);
    if (n.midi <= ceil) continue;
    const chord = chordAtBeat(bar, n.beat - bar * BEATS_PER_BAR);
    const near = [sorted[i - 1]?.midi, sorted[i + 1]?.midi];
    const tones = chordTones(chord, MEL_LO, ceil).filter((t) => !near.includes(t));
    const pool = tones.length > 0 ? tones : chordTones(chord, MEL_LO, ceil);
    if (pool.length === 0) { n.midi = ceil; continue; }
    const aim = ceil - 2;
    let best = pool[0];
    for (const t of pool) if (Math.abs(t - aim) < Math.abs(best - aim)) best = t;
    n.midi = best;
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

  // 同じ音が3つ以上続いていないか。動きの無い線は旋律に聴こえない。
  let runs = 0;
  for (let i = 2; i < mel.length; i += 1) {
    if (mel[i].midi === mel[i - 1].midi && mel[i - 1].midi === mel[i - 2].midi) runs += 1;
  }
  if (runs > 0) issues.push(`同じ音が3つ続く箇所が ${runs}`);

  // 「行って戻る」だけの往復。
  //
  // 一歩出て戻るのは音楽的に自然な収め方（刺繍音・フレーズの結び）なので、
  // それ自体は排除しない。問題なのは**4音以上にわたって同じ2音を往復し続ける**
  // 形で、そこは線が完全に止まる。長い往復だけを数える。
  let stuck = 0;
  for (let i = 3; i < mel.length; i += 1) {
    const a = mel[i - 3].midi;
    const b = mel[i - 2].midi;
    if (a === b) continue;
    if (mel[i - 1].midi === a && mel[i].midi === b) stuck += 1;
  }
  if (stuck > 1) issues.push(`同じ2音の往復が続く箇所が ${stuck}（1以下であること）`);

  // 線が前へ進んでいるか。フレーズ（8小節）の始点と終点が同じ高さばかりだと、
  // どれだけ音が動いても曲として進んでいない。
  let moved = 0;
  for (let sec = 0; sec < 4; sec += 1) {
    const l = mel.filter((n) => n.beat >= sec * 8 * BEATS_PER_BAR
      && n.beat < (sec + 1) * 8 * BEATS_PER_BAR);
    if (l.length < 2) continue;
    if (Math.abs(l[l.length - 1].midi - l[0].midi) >= 3) moved += 1;
  }
  if (moved < 2) issues.push(`線が動いているセクションが ${moved}（2つ以上であること）`);

  // セクションの音域が役割どおりか。
  // 提示は静かに、喪失は少し翳り、クライマックスで登り、回想はいちばん低く収まる。
  const secAvg = SECTIONS.map((sec) => {
    const l = mel.filter((n) => n.beat >= sec.from * BEATS_PER_BAR
      && n.beat < (sec.from + 8) * BEATS_PER_BAR);
    return l.length ? l.reduce((a, b) => a + b.midi, 0) / l.length : 0;
  });
  if (!(secAvg[2] > secAvg[0] + 2)) issues.push('クライマックスが提示より高くなっていない');
  if (!(secAvg[3] < secAvg[0] + 1)) issues.push('回想が提示より低く収まっていない');
  if (secAvg[0] > 71) issues.push(`提示の音域が高い（平均 ${secAvg[0].toFixed(1)} / 71以下）`);

  // リズムが単調になっていないか。
  //
  // 音の高さの検査だけ通しても、刻みが同じなら「同じ曲が16回鳴る」ように
  // 聴こえる。実測で、32小節が2つのリズム型（9回と8回）で半分埋まっていた。
  // 主題である以上ある程度の反復は要るので、禁止ではなく上限で抑える。
  const rhythmCount = new Map();
  for (let bar = 0; bar < BARS; bar += 1) {
    const k = mel.filter((n) => Math.floor(n.beat / BEATS_PER_BAR) === bar)
      .map((n) => `${(n.beat % BEATS_PER_BAR).toFixed(2)}:${n.dur}`).join(',');
    if (!k) continue;
    rhythmCount.set(k, (rhythmCount.get(k) ?? 0) + 1);
  }
  const counts = [...rhythmCount.values()].sort((a, b) => b - a);
  if (rhythmCount.size < 13) {
    issues.push(`小節のリズムが ${rhythmCount.size} 種類（13種以上であること）`);
  }
  if (counts[0] > 8) issues.push(`同じリズムの小節が ${counts[0]} 回（8回以下であること）`);
  if ((counts[0] ?? 0) + (counts[1] ?? 0) > 14) {
    issues.push(`上位2つのリズムで ${counts[0] + counts[1]} 小節（14小節以下であること）`);
  }

  // 大きすぎる跳躍が残っていないか。
  // fixLeaps は句末を直す工程より前に走るので、そのあとの書き換えは拾えない。
  for (let i = 1; i < mel.length; i += 1) {
    const d = Math.abs(mel[i].midi - mel[i - 1].midi);
    if (d > 9) {
      issues.push(`第${Math.floor(mel[i].beat / BEATS_PER_BAR) + 1}小節に ${d} 半音の跳躍`);
      break;
    }
  }

  // 句の終わりが寄りかかれる音か（7th・9th・sus4 では句が閉じない）。
  for (const bar of [7, 15, 23, 31]) {
    const inBar = mel.filter((n) => Math.floor(n.beat / BEATS_PER_BAR) === bar);
    if (inBar.length === 0) continue;
    const n = inBar[inBar.length - 1];
    const from = n.beat - bar * BEATS_PER_BAR;
    let stable = true;
    for (let t = from; t < Math.min(BEATS_PER_BAR, from + n.dur); t += 0.5) {
      const chord = chordAtBeat(bar, t);
      const rel = ((((n.midi % 12) + 12) % 12) - chord.pcs[0] + 12) % 12;
      if (![0, 3, 4, 7].includes(rel)) { stable = false; break; }
    }
    if (!stable) issues.push(`第${bar + 1}小節の句末が寄りかかれない音`);
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
  capBySection(notes);
  fixLeaps(notes);
  resolveNonChordTones(notes);
  offsetBarHeads(notes, rng, phraseHeads);
  ensureRests(notes);
  breakExactCopies(notes);
  // !!! 天井は最後にもう一度掛ける !!!
  // 跳躍の修正・和声の整え・完全一致の解消は、いずれも音の高さを書き換える。
  // 先に天井を下げても、そのあとの工程が上へ戻してしまい、最高音が
  // 3回出ていた。頂点の一回性は、すべての書き換えが済んだあとで保証する。
  capBySection(notes);
  // 句末を寄りかかれる音に直すのは、高さの書き換えがすべて済んだあと。
  settlePhraseEnds(notes, [7, 15, 23, 31],
    (bar) => SECTION_CEIL[Math.min(3, Math.floor(bar / 8))]);
  notes.sort((a, b) => a.beat - b.beat);

  // 最後の音は主音を最終小節の終わりまで伸ばす
  endOnTonic(notes, 0);
  const last = notes[notes.length - 1];
  if (last) last.dur = Math.max(2, BARS * BEATS_PER_BAR - last.beat);

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
// 検査は7項目すべてを同時に満たすことを求めるので、通る種はまばらにしか無い。
// 実測で 1443 回目。400 回で打ち切ると違反を抱えたまま出力してしまう。
export const DEFAULT_ATTEMPTS = 4000;

export function compose(startSeed = 1, attempts = DEFAULT_ATTEMPTS) {
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
