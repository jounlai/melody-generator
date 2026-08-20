#!/usr/bin/env node
// 手元の MIDI から「旋律の語法の統計」だけを取り出す。
//
//   node tools/extractFromMidi.js            # midi/ を読んで統計を表示
//   node tools/extractFromMidi.js --write    # tools/data/midiPatterns.json へ書く
//
// ■ 著作権について（最重要）
//   読む MIDI は著作権の生きている作品でよい。著作権法30条の4は「情報解析の
//   ための利用」を権利者の許諾なしに認めている。ただしそれが許すのは**解析**で
//   あって、複製物を公衆へ送信することではない。
//
//   したがってこの道具の約束は1つだけ:
//     入力（midi/ 以下）は git 管理外。出力に残すのは統計だけ。
//
//   出力に入るのは「音程の並びの出現頻度」「リズム細胞の出現頻度」「楽節の長さの
//   分布」といった数字で、どの曲のどこかは復元できない。3〜6音の音程差の並び
//   （[0,-1,-2] のような形）は、ありふれた音型であって創作的表現ではない。
//   逆に、特定の曲と分かる長さの旋律は絶対に出力しない（MAX_NGRAM で縛る）。
//
// ■ 抽出のしかた
//   これらの MIDI は伴奏込みが1トラックに潰れていて、和音が98%重なっている。
//   最上声を機械的に拾うと伴奏の和音の頂点へ飛び移る（実測: 順次20.7% /
//   跳躍60.4% / 音域16度＝旋律の体をなさない）。そこで「前の音に近い・高い・
//   長い」で1本の線を選ぶ追い方にした（順次43.3% / 跳躍11.9% / 音域4.0度）。
//   そのうえで、きれいな楽節だけを残す。

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMidi } from './readMidi.js';
import { detectKey, toDegrees, splitPhrases } from './melodyFromMidi.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIDI_DIR = resolve(HERE, '../midi');
const OUT_PATH = resolve(HERE, 'data/midiPatterns.json');

// 音程の並びとして残してよい長さの上限。
// これ以上を残すと「その曲のあの部分」が復元できてしまう。
const MAX_NGRAM = 6;
const MIN_NGRAM = 3;

// 線の追い方。実測で決めた（上のコメント参照）。
const STREAM = { jump: 3.0, high: 0.3, long: 1.0, maxLeap: 9, floorPct: 0.7 };

// 「きれいな旋律」の条件。ここを通ったものだけを統計に入れる。
const CLEAN = {
  minNotes: 5,
  maxNotes: 20,
  minStep: 0.55,   // 順次進行がこれ以上
  maxLeap: 0.15,   // 4度以上の跳躍がこれ以下
  minSpan: 2,      // 音域が狭すぎる（同音ばかり）ものは旋律ではない
  maxSpan: 12,
  maxChromatic: 0.12, // 音階外が多い＝調の判定か抽出が外れている
};

/** 打点ごとに候補を並べ、「前の音に近い・高い・長い」で1本の線を選ぶ。 */
export function streamMelody(notes, division, opts = STREAM) {
  const grid = division / 4;
  const byTick = new Map();
  for (const n of notes) {
    if (n.dur <= 0) continue;
    const t = Math.round(n.tick / grid) * grid;
    if (!byTick.has(t)) byTick.set(t, []);
    byTick.get(t).push(n);
  }
  const ticks = [...byTick.keys()].sort((a, b) => a - b);
  const all = notes.map((n) => n.midi).sort((a, b) => a - b);
  const floor = all[Math.floor(all.length * opts.floorPct)];

  const out = [];
  let prev = null;
  for (const t of ticks) {
    const cand = byTick.get(t).filter((n) => n.midi >= floor);
    if (cand.length === 0) continue;
    let best = null;
    let bestScore = -Infinity;
    for (const n of cand) {
      const jump = prev === null ? 0 : Math.abs(n.midi - prev);
      const score = -opts.jump * jump
        + opts.high * (n.midi - floor)
        + opts.long * Math.log2(n.dur / grid + 1);
      if (score > bestScore) { bestScore = score; best = n; }
    }
    // 大きく跳ぶなら旋律が切れたとみなし、そこで線を切る
    if (prev !== null && Math.abs(best.midi - prev) > opts.maxLeap) { prev = null; continue; }
    out.push({ midi: best.midi, tick: t, dur: Math.max(grid, Math.round(best.dur / grid) * grid) });
    prev = best.midi;
  }
  return out;
}

function phraseStats(ph) {
  const iv = ph.slice(1).map((n, i) => n.deg - ph[i].deg);
  const abs = iv.map(Math.abs);
  return {
    step: abs.filter((v) => v === 1).length / abs.length,
    leap: abs.filter((v) => v >= 3).length / abs.length,
    span: Math.max(...ph.map((n) => n.deg)) - Math.min(...ph.map((n) => n.deg)),
    iv,
  };
}

function isClean(ph, chromatic) {
  if (ph.length < CLEAN.minNotes || ph.length > CLEAN.maxNotes) return false;
  if (chromatic > CLEAN.maxChromatic) return false;
  const s = phraseStats(ph);
  return s.step >= CLEAN.minStep && s.leap <= CLEAN.maxLeap
    && s.span >= CLEAN.minSpan && s.span <= CLEAN.maxSpan;
}

export function collectFromDir(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const f of readdirSync(resolve(dir, entry.name))) {
        files.push(resolve(dir, entry.name, f));
      }
    } else files.push(resolve(dir, entry.name));
  }

  const formulas = new Map();  // 音程差の並び -> 回数
  const cells = new Map();     // リズム細胞（音価の並び）-> 回数
  const lengths = new Map();   // 楽節の音数 -> 回数
  const cadences = new Map();  // 終わりの3音の音程差 -> 回数
  const modes = { major: 0, minor: 0 };
  let songs = 0;
  let phrasesSeen = 0;
  let phrasesKept = 0;
  const profile = [];

  for (const path of files) {
    if (!/\.midi?$/i.test(path)) continue;
    let m;
    try { m = readMidi(readFileSync(path)); } catch { continue; }
    const notes = m.tracks.flatMap((t) => t.notes).filter((n) => n.dur > 0);
    if (notes.length < 50) continue;
    songs += 1;

    const line = streamMelody(notes, m.division);
    if (line.length < 30) continue;
    const key = detectKey(line);
    modes[key.mode] += 1;
    const { degs, chromaticRatio } = toDegrees(line, key.tonic + 60, key.mode);

    for (const ph of splitPhrases(degs, m.division)) {
      phrasesSeen += 1;
      if (!isClean(ph, chromaticRatio)) continue;
      phrasesKept += 1;
      const s = phraseStats(ph);
      profile.push(s);
      lengths.set(ph.length, (lengths.get(ph.length) || 0) + 1);

      // 音程差の n-gram。先頭を0に正規化して「形」だけにする。
      for (let n = MIN_NGRAM; n <= MAX_NGRAM; n += 1) {
        for (let i = 0; i + n <= ph.length; i += 1) {
          const steps = [0];
          for (let k = 1; k < n; k += 1) steps.push(ph[i + k].deg - ph[i].deg);
          if (steps.some((v) => Math.abs(v) > 7)) continue;
          const id = steps.join(',');
          formulas.set(id, (formulas.get(id) || 0) + 1);
        }
      }
      // 終止形。最後の4音の形
      if (ph.length >= 4) {
        const tail = ph.slice(-4);
        const steps = tail.map((n) => n.deg - tail[0].deg);
        cadences.set(steps.join(','), (cadences.get(steps.join(',')) || 0) + 1);
      }
      // リズム細胞。4分音符を1.0とした音価の並び（3〜5音）
      const durs = ph.map((n) => Math.round((n.dur / (m.division)) * 4) / 4);
      for (let n = 2; n <= 4; n += 1) {
        for (let i = 0; i + n <= durs.length; i += 1) {
          const d = durs.slice(i, i + n);
          if (d.some((v) => v <= 0 || v > 4)) continue;
          cells.set(d.join(','), (cells.get(d.join(',')) || 0) + 1);
        }
      }
    }
  }

  const avg = (f) => (profile.length ? profile.reduce((a, b) => a + f(b), 0) / profile.length : 0);
  return {
    source: {
      songs,
      phrasesSeen,
      phrasesKept,
      note: '入力の MIDI は git 管理外。ここにあるのは統計だけで、曲は復元できない。',
      maxNgram: MAX_NGRAM,
    },
    stats: {
      modeCount: modes,
      stepRatio: Number(avg((s) => s.step).toFixed(4)),
      leapRatio: Number(avg((s) => s.leap).toFixed(4)),
      span: Number(avg((s) => s.span).toFixed(2)),
      lengthHistogram: Object.fromEntries([...lengths.entries()].sort((a, b) => a[0] - b[0])),
    },
    formulas: [...formulas.entries()]
      .filter(([, w]) => w >= 5)
      .sort((a, b) => b[1] - a[1])
      .map(([id, weight]) => ({ steps: id.split(',').map(Number), weight })),
    cadences: [...cadences.entries()]
      .filter(([, w]) => w >= 5)
      .sort((a, b) => b[1] - a[1])
      .map(([id, weight]) => ({ steps: id.split(',').map(Number), weight })),
    rhythmCells: [...cells.entries()]
      .filter(([, w]) => w >= 10)
      .sort((a, b) => b[1] - a[1])
      .map(([id, weight]) => ({ durs: id.split(',').map(Number), weight })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = collectFromDir(MIDI_DIR);
  const s = out.stats;
  console.log(`曲 ${out.source.songs} / 楽節 ${out.source.phrasesSeen} → きれいなもの ${out.source.phrasesKept}`);
  console.log(`調: 長調 ${s.modeCount.major} / 短調 ${s.modeCount.minor}`);
  console.log(`順次 ${(s.stepRatio * 100).toFixed(1)}% / 跳躍 ${(s.leapRatio * 100).toFixed(1)}% / 音域 ${s.span} 度`);
  console.log(`旋律型 ${out.formulas.length} 種 / 終止形 ${out.cadences.length} 種 / リズム細胞 ${out.rhythmCells.length} 種`);
  console.log(`上位の旋律型: ${out.formulas.slice(0, 8).map((f) => `[${f.steps}]=${f.weight}`).join(' ')}`);
  console.log(`上位のリズム細胞: ${out.rhythmCells.slice(0, 8).map((c) => `[${c.durs}]=${c.weight}`).join(' ')}`);
  if (process.argv.includes('--write')) {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 1)}\n`);
    console.log(`\n${OUT_PATH} へ書き出した（統計のみ）`);
  }
}
