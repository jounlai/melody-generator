#!/usr/bin/env node
// src/data/melodies.json を生成する。
//
// 「涙を流すほど美しい」ヒーリングBGMの中核データ、2小節メロディー断片999個のカタログ。
// 固定シードで大量の候補を作り、美しさスコアで評価し、層化抽出で999件を選ぶ。
// Math.random() は使わない(再実行すれば必ず同じ JSON になる)。
//
// 断片1件は「どのコードに乗るか」を事前計算して持つ。組み立て側(compose.js)は
// 進行のコードから逆引きで断片を選ぶので、この事前計算がないと実時間で組めない。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../src/rng.js';
import { CHORD_VOCAB, splitBars, fitsBar, hasSuspension } from '../src/theory.js';
import { analyzeFragment } from './analyze.js';
import { scoreFragment } from './score.js';
import { generateCandidate } from './generate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, '../src/data/melodies.json');

const SEED = 20260816;
// 候補数。仕様の初期値は 60000 だったが、それでは緊張度1の断片が
// 全候補中46件しか現れず(各50件以上という多様性条件に届かない)、
// また sigh タグも16件しか残らなかったため 300000 に引き上げてある。
// 詳細は末尾の統計出力を参照。
const CANDIDATES = 300000;
const TARGET = 999;
const BUCKET_QUOTA = 17;
const MODES = ['major', 'minor'];

// 輪郭6種 × 緊張度5段階 × 終止クラス2種 = 60バケット。
const CONTOURS = ['arch', 'wave', 'descend', 'ascend', 'answer', 'question'];
const TENSIONS = [1, 2, 3, 4, 5];
const END_CLASSES = ['rest', 'open'];

// 1, 8, 15 …(トニック)で終われば着地感がある = 'rest'。
function endClassOf(endDeg) {
  return ((((endDeg - 1) % 7) + 7) % 7) === 0 ? 'rest' : 'open';
}

function bucketKey(meta) {
  return `${meta.contour}|${meta.tension}|${endClassOf(meta.endDeg)}`;
}

// ---------------------------------------------------------------------------
// コード適合の事前計算
// ---------------------------------------------------------------------------

// 同じ断片がメジャー進行では明るく、マイナー進行では切なく響く。
// そのため両モードについて計算する。
// fit[mode][0] = 1小節目が乗るコードの CHORD_VOCAB[mode] における添字の配列
// fit[mode][1] = 2小節目のもの。sus は同じ形で「掛留が成立する」コードの添字。
function chordMaps(notes) {
  const bars = splitBars(notes);
  const fit = {};
  const sus = {};
  for (const mode of MODES) {
    fit[mode] = [[], []];
    sus[mode] = [[], []];
    const vocab = CHORD_VOCAB[mode];
    for (let bar = 0; bar < 2; bar++) {
      for (let i = 0; i < vocab.length; i++) {
        if (fitsBar(bars[bar], mode, vocab[i])) fit[mode][bar].push(i);
        if (hasSuspension(bars[bar], mode, vocab[i])) sus[mode][bar].push(i);
      }
    }
  }
  return { fit, sus };
}

// 足切り用。全モード・全小節で1つでも乗るコードがあるかだけを見る。
// 候補30万件ぶんの添字配列を作らずに済むよう some() で打ち切る。
function fitsSomeChord(notes) {
  const bars = splitBars(notes);
  for (const mode of MODES) {
    for (const bar of bars) {
      if (!CHORD_VOCAB[mode].some((sym) => fitsBar(bar, mode, sym))) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// 候補生成と足切り
// ---------------------------------------------------------------------------

function collect() {
  const rng = makeRng(SEED);
  const kept = [];
  const rejected = { short: 0, noChord: 0 };

  for (let i = 0; i < CANDIDATES; i++) {
    const { notes } = generateCandidate(rng);

    // 音が2個以下では旋律の体をなさない。
    if (notes.length < 3) {
      rejected.short++;
      continue;
    }
    // どのコードにも乗らない断片は使い道がない。
    if (!fitsSomeChord(notes)) {
      rejected.noChord++;
      continue;
    }

    const meta = analyzeFragment(notes);
    // contour は生成時のテンプレート名ではなく、出来上がった度数列を
    // analyzeFragment が判定した実際の輪郭を採用する。
    kept.push({ index: i, notes, meta, score: scoreFragment(notes, meta) });
  }

  return { kept, rejected };
}

// ---------------------------------------------------------------------------
// 層化抽出
// ---------------------------------------------------------------------------

// スコア降順。同点は生成順(index 昇順)で決める = 完全に決定論的。
function byScoreDesc(a, b) {
  return b.score - a.score || a.index - b.index;
}

// 単純なスコア上位999件にはしない。上位だけを採ると似た優等生ばかりが並び、
// 無限に聴いたとき必ず飽きるうえ、組み立て側のフィルタが候補切れを起こす。
function select(kept) {
  const buckets = new Map();
  for (const key of bucketKeys()) buckets.set(key, []);
  for (const cand of kept) buckets.get(bucketKey(cand.meta)).push(cand);

  const picked = [];
  const leftover = [];
  for (const arr of buckets.values()) {
    arr.sort(byScoreDesc);
    picked.push(...arr.slice(0, BUCKET_QUOTA));
    leftover.push(...arr.slice(BUCKET_QUOTA));
  }

  let chosen;
  if (picked.length >= TARGET) {
    // 定員どおり埋まった場合は下位から削って999件ちょうどにする。
    chosen = picked.sort(byScoreDesc).slice(0, TARGET);
  } else {
    // 空バケット・定員割れがある場合は未採用の候補全体から補充する。
    leftover.sort(byScoreDesc);
    chosen = picked.concat(leftover.slice(0, TARGET - picked.length));
  }

  return { chosen, buckets, poolSize: picked.length };
}

function bucketKeys() {
  const keys = [];
  for (const c of CONTOURS) {
    for (const t of TENSIONS) {
      for (const e of END_CLASSES) keys.push(`${c}|${t}|${e}`);
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// 出力
// ---------------------------------------------------------------------------

function toRecord(cand, i) {
  const m = cand.meta;
  const { fit, sus } = chordMaps(cand.notes);
  return {
    id: `m${String(i + 1).padStart(4, '0')}`,
    notes: cand.notes,
    startDeg: m.startDeg,
    endDeg: m.endDeg,
    contour: m.contour,
    range: m.range,
    span: m.span,
    peakDeg: m.peakDeg,
    peakBeat: m.peakBeat,
    peakCount: m.peakCount,
    tension: m.tension,
    density: m.density,
    tags: m.tags,
    fit,
    sus,
    score: cand.score,
  };
}

// 1断片1行。詰めた形のままでも差分が読める。
function serialize(items) {
  return `[\n${items.map((it) => `  ${JSON.stringify(it)}`).join(',\n')}\n]\n`;
}

// ---------------------------------------------------------------------------
// 統計
// ---------------------------------------------------------------------------

function tally(list, keyOf) {
  const out = {};
  for (const item of list) {
    const k = keyOf(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function ordered(counts, keys) {
  const out = {};
  for (const k of keys) out[k] = counts[k] ?? 0;
  return out;
}

function report(melodies, kept, rejected, buckets, poolSize) {
  const scores = melodies.map((m) => m.score).sort((a, b) => a - b);
  const median = scores[Math.floor(scores.length / 2)];

  const tags = {};
  for (const m of melodies) {
    for (const t of m.tags) tags[t] = (tags[t] ?? 0) + 1;
  }
  const tagList = Object.entries(tags).sort((a, b) => b[1] - a[1]);

  const climax = melodies.filter((m) => m.peakDeg >= 12).length;
  const cut = rejected.short + rejected.noChord;

  console.log(`wrote ${OUT_PATH}`);
  console.log(`  候補生成       : ${CANDIDATES}`);
  console.log(`  足切り後       : ${kept.length}  (捨てた ${cut} = 音数不足 ${rejected.short} / コード不適合 ${rejected.noChord})`);
  console.log(`  バケット採用   : ${poolSize}  (60バケット × 定員 ${BUCKET_QUOTA})`);
  console.log(`  最終件数       : ${melodies.length}`);
  console.log(`  輪郭ごと       : ${JSON.stringify(ordered(tally(melodies, (m) => m.contour), CONTOURS))}`);
  console.log(`  緊張度ごと     : ${JSON.stringify(ordered(tally(melodies, (m) => m.tension), TENSIONS))}`);
  console.log(`  終止クラスごと : ${JSON.stringify(ordered(tally(melodies, (m) => endClassOf(m.endDeg)), END_CLASSES))}`);
  console.log('  タグごと       :');
  for (const [tag, n] of tagList) console.log(`      ${tag.padEnd(12)} ${n}`);
  console.log(`      (sigh=${tags.sigh ?? 0} / inner-motif=${tags['inner-motif'] ?? 0})`);
  console.log(`  スコア         : min ${scores[0]} / median ${median} / max ${scores[scores.length - 1]}`);
  console.log(`  peakDeg>=12    : ${climax}  (クライマックス用。50件未満だと曲の頂点が作れない)`);

  // 層化抽出の健全性。空・定員割れバケットはそのまま多様性の欠落になる。
  const empty = [];
  const thin = [];
  for (const [key, arr] of buckets) {
    if (arr.length === 0) empty.push(key);
    else if (arr.length < BUCKET_QUOTA) thin.push(`${key}=${arr.length}`);
  }
  console.log(`  空バケット     : ${empty.length}/60${empty.length ? ` -> ${empty.join(' ')}` : ''}`);
  console.log(`  定員割れ       : ${thin.length}${thin.length ? ` -> ${thin.join(' ')}` : ''}`);
}

// ---------------------------------------------------------------------------

const { kept, rejected } = collect();
const { chosen, buckets, poolSize } = select(kept);

if (chosen.length !== TARGET) {
  throw new Error(`${chosen.length} 件しか選べません(必要 ${TARGET} 件)`);
}

// score 降順ではなく生成順に並べてから id を振る。
chosen.sort((a, b) => a.index - b.index);
const melodies = chosen.map(toRecord);

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, serialize(melodies), 'utf8');

report(melodies, kept, rejected, buckets, poolSize);
