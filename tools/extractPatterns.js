#!/usr/bin/env node
// tools/data/patterns.json を生成する。
//
// corpus.js の名旋律から「言い回し」だけを剥ぎ取る。
// 抜き出すのは音程の並び・終止形・リズムのセルであって、音そのものではない。
// 各断片は最初の音を0とした相対オフセットに正規化されるので、
// 出力を見ても元がどの曲かは分からない ＝ BGM に使っても「あの曲だ」とはならない。
//
// Math.random() は使わない。同じ CORPUS からは必ずバイト一致する JSON が出る。
//
//   node tools/extractPatterns.js            # tools/data/patterns.json に書く
//   node tools/extractPatterns.js --out X    # 任意の場所に書く(テストの決定性検証用)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS } from './corpus.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, 'data/patterns.json');

// 旋律型として取り出す n-gram の長さ。3未満は情報がなく、6を超えると
// 「その曲そのもの」に近づくうえ、2回以上出現しなくなる。
export const FORMULA_MIN_LEN = 3;
export const FORMULA_MAX_LEN = 6;
// 1回しか出ない並びは「その曲固有の事情」であって語法ではないので捨てる。
export const FORMULA_MIN_WEIGHT = 2;

export const CADENCE_LEN = 4;
export const RHYTHM_MIN_LEN = 2;
export const RHYTHM_MAX_LEN = 4;

// 「舞い上がり」= 頂点へ大きく跳び上がって、そこから順次で降りてくる形。
// 名バラードの山場はほぼこの形をしている。滅多に出ない貴重な型なので
// 出現1回でも捨てない(閾値2にすると全部消える)。
export const SOAR_MIN_LEN = 4;
export const SOAR_MAX_LEN = 6;
export const SOAR_MIN_WEIGHT = 1;
// 舞い上がりと認める上行跳躍の最小の度数差。3 = 4度以上の跳躍。
// ポップバラードが頂点へ飛び込むときの跳躍は4度・5度・6度が中心なので、
// ここを4(=5度以上)にすると4度の跳躍を丸ごと取りこぼす。
export const SOAR_MIN_LEAP = 3;
// 跳んだあと順次で降り続ける音の最小数。
export const SOAR_MIN_DESCENT = 2;
// 「順次」として許す下降幅(度数差)。1 = 2度、2 = 3度。
export const SOAR_STEP_MAX = 2;

// フレーズ末を「伸ばした」と見なす、その曲の平均音価に対する倍率。
export const PHRASE_END_LONG_FACTOR = 1.5;

// 度数の差がいくつなら「順次進行(2度)」か。度数表記なので隣り合う度数の差は1。
const STEP = 1;
// 3度以上 = 度数差2以上を跳躍とみなす。
const LEAP = 2;

const round = (v, digits = 4) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

const ratio = (hit, total) => (total === 0 ? 0 : round(hit / total));

const degsOf = (entry) => entry.notes.map((note) => note.deg);
const dursOf = (entry) => entry.notes.map((note) => note.dur);

// 最初の音を0にそろえる。これで「どの高さで歌われたか」が消え、
// 「どう動いたか」だけが残る。
const toSteps = (window) => window.map((deg) => deg - window[0]);

const intervalsOf = (degs) => degs.slice(1).map((deg, i) => deg - degs[i]);

// 数値配列の辞書順比較。重みが同じときの並びを一意に決めるために使う。
function compareNumArrays(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// key -> { value, weight } を数え上げる小さなカウンタ。
function makeCounter() {
  const map = new Map();
  return {
    add(value) {
      const key = value.join(',');
      const found = map.get(key);
      if (found) found.weight += 1;
      else map.set(key, { value, weight: 1 });
    },
    entries: () => [...map.values()],
  };
}

// (a) 旋律型。長さ3〜6の連続部分列を相対オフセットにして数える。
export function extractFormulas(corpus) {
  const counter = makeCounter();
  for (const entry of corpus) {
    const degs = degsOf(entry);
    for (let len = FORMULA_MIN_LEN; len <= FORMULA_MAX_LEN; len += 1) {
      for (let i = 0; i + len <= degs.length; i += 1) {
        counter.add(toSteps(degs.slice(i, i + len)));
      }
    }
  }
  return counter.entries()
    .filter((e) => e.weight >= FORMULA_MIN_WEIGHT)
    .map((e) => ({ steps: e.value, weight: e.weight, len: e.value.length }))
    .sort((a, b) => (
      b.weight - a.weight
      || a.len - b.len
      || compareNumArrays(a.steps, b.steps)
    ));
}

// (b) 終止形。曲の最後の4音だけを集める。母数が曲数しかないので
// 出現1回のものも捨てない(捨てると語彙が数種類になってしまう)。
export function extractCadences(corpus) {
  const counter = makeCounter();
  for (const entry of corpus) {
    const degs = degsOf(entry);
    if (degs.length < CADENCE_LEN) continue;
    counter.add(toSteps(degs.slice(-CADENCE_LEN)));
  }
  return counter.entries()
    .map((e) => ({ steps: e.value, weight: e.weight }))
    .sort((a, b) => b.weight - a.weight || compareNumArrays(a.steps, b.steps));
}

// (c) リズムのセル。音価の並びだけを長さ2〜4で取り出す。
export function extractRhythmCells(corpus) {
  const counter = makeCounter();
  for (const entry of corpus) {
    const durs = dursOf(entry);
    for (let len = RHYTHM_MIN_LEN; len <= RHYTHM_MAX_LEN; len += 1) {
      for (let i = 0; i + len <= durs.length; i += 1) {
        counter.add(durs.slice(i, i + len));
      }
    }
  }
  return counter.entries()
    .map((e) => ({ durs: e.value, weight: e.weight }))
    .sort((a, b) => (
      b.weight - a.weight
      || a.durs.length - b.durs.length
      || compareNumArrays(a.durs, b.durs)
    ));
}

// (d) 「舞い上がり」。ある窓が次を全部満たすときだけ採る。
//   1. 度数差 SOAR_MIN_LEAP 以上の上行跳躍を含む
//   2. その跳躍の到達点が、その窓の最高音である
//   3. 到達点のあと、順次(度数差1〜2)の下降が SOAR_MIN_DESCENT 音以上続く
// 条件を満たす跳躍が1つでもあれば、その窓は舞い上がりとする。
export function isSoarWindow(window) {
  const peak = Math.max(...window);
  for (let j = 0; j + 1 < window.length; j += 1) {
    if (window[j + 1] - window[j] < SOAR_MIN_LEAP) continue;
    if (window[j + 1] !== peak) continue;
    let descent = 0;
    for (let k = j + 1; k + 1 < window.length; k += 1) {
      const move = window[k + 1] - window[k];
      if (move <= -1 && move >= -SOAR_STEP_MAX) descent += 1;
      else break;
    }
    if (descent >= SOAR_MIN_DESCENT) return true;
  }
  return false;
}

// 1曲の中で条件を満たす窓の数。stats 側の集計にも使う。
function countSoarWindows(degs) {
  let count = 0;
  for (let len = SOAR_MIN_LEN; len <= SOAR_MAX_LEN; len += 1) {
    for (let i = 0; i + len <= degs.length; i += 1) {
      if (isSoarWindow(degs.slice(i, i + len))) count += 1;
    }
  }
  return count;
}

export function extractSoars(corpus) {
  const counter = makeCounter();
  for (const entry of corpus) {
    const degs = degsOf(entry);
    for (let len = SOAR_MIN_LEN; len <= SOAR_MAX_LEN; len += 1) {
      for (let i = 0; i + len <= degs.length; i += 1) {
        const window = degs.slice(i, i + len);
        if (isSoarWindow(window)) counter.add(toSteps(window));
      }
    }
  }
  return counter.entries()
    .filter((e) => e.weight >= SOAR_MIN_WEIGHT)
    .map((e) => ({ steps: e.value, weight: e.weight }))
    .sort((a, b) => (
      b.weight - a.weight
      || a.steps.length - b.steps.length
      || compareNumArrays(a.steps, b.steps)
    ));
}

// 度数1, 8, 15 …(および 0 の下、-6 など)はすべて主音。
const isTonicDeg = (deg) => ((((deg - 1) % 7) + 7) % 7) === 0;

const sum = (values) => values.reduce((a, b) => a + b, 0);

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return round((sorted[mid - 1] + sorted[mid]) / 2, 3);
}

// 地域ごとの語法差を測るための小さな集計器。
// 1曲ずつ「音程の総数 / 順次の数 / 音域 / 舞い上がりの数」を足し込む。
function makeRegionAccumulator() {
  return {
    count: 0, intervals: 0, steps: 0, rangeSum: 0, soars: 0,
  };
}

// (e) 統計サマリ。生成側のスコアリングは、この数字を根拠に閾値を決める。
export function extractStats(corpus) {
  const intervalHistogram = {};
  let intervalCount = 0;
  let stepCount = 0;
  let leapCount = 0;
  let leapThenStep = 0;
  let tonicEnd = 0;
  let soarCount = 0;
  let phraseEndLong = 0;
  let openingRepeat = 0;
  const modeCount = { major: 0, minor: 0 };
  const beatsHistogram = {};
  const beatsList = [];
  const byRegionRaw = new Map();

  for (const entry of corpus) {
    const degs = degsOf(entry);
    const durs = dursOf(entry);
    const intervals = intervalsOf(degs);

    const soars = countSoarWindows(degs);
    soarCount += soars;

    // フレーズ末で伸ばしたか。名バラードは必ず最後の音を置きにいく。
    const meanDur = sum(durs) / durs.length;
    if (durs[durs.length - 1] >= meanDur * PHRASE_END_LONG_FACTOR) phraseEndLong += 1;
    // 冒頭2音が同音か(Hey Jude 型の語りかけ)。
    if (degs.length >= 2 && degs[0] === degs[1]) openingRepeat += 1;

    const region = entry.region ?? 'other';
    if (!byRegionRaw.has(region)) byRegionRaw.set(region, makeRegionAccumulator());
    const acc = byRegionRaw.get(region);
    acc.count += 1;
    acc.intervals += intervals.length;
    acc.steps += intervals.filter((d) => Math.abs(d) === STEP).length;
    acc.rangeSum += Math.max(...degs) - Math.min(...degs);
    acc.soars += soars;

    for (let i = 0; i < intervals.length; i += 1) {
      const size = Math.abs(intervals[i]);
      intervalHistogram[size] = (intervalHistogram[size] ?? 0) + 1;
      intervalCount += 1;
      if (size === STEP) stepCount += 1;
      // 跳躍の直後に順次で埋め戻したか。最後の音程は「直後」が無いので数えない。
      if (size >= LEAP && i + 1 < intervals.length) {
        leapCount += 1;
        if (Math.abs(intervals[i + 1]) === STEP) leapThenStep += 1;
      }
    }

    if (isTonicDeg(degs[degs.length - 1])) tonicEnd += 1;
    modeCount[entry.mode] += 1;

    const beats = round(sum(dursOf(entry)), 3);
    beatsList.push(beats);
    beatsHistogram[beats] = (beatsHistogram[beats] ?? 0) + 1;
  }

  // キーを数値順にそろえる(オブジェクトの列挙順＝JSONのバイト列を固定するため)。
  const sortedNumKeys = (obj) => Object.fromEntries(
    Object.keys(obj)
      .map(Number)
      .sort((a, b) => a - b)
      .map((k) => [String(k), obj[k]]),
  );

  // 地域名でソートしてから書き出す(JSONのバイト列を固定するため)。
  const byRegion = Object.fromEntries(
    [...byRegionRaw.keys()].sort().map((key) => {
      const acc = byRegionRaw.get(key);
      return [key, {
        count: acc.count,
        stepwiseRatio: ratio(acc.steps, acc.intervals),
        meanRange: round(acc.rangeSum / acc.count, 3),
        soarCount: acc.soars,
      }];
    }),
  );

  return {
    pieces: corpus.length,
    notes: sum(corpus.map((e) => e.notes.length)),
    intervals: intervalCount,
    stepwiseRatio: ratio(stepCount, intervalCount),
    intervalHistogram: sortedNumKeys(intervalHistogram),
    leapCount,
    leapThenStepRatio: ratio(leapThenStep, leapCount),
    cadenceOnTonicRatio: ratio(tonicEnd, corpus.length),
    soarCount,
    phraseEndLongRatio: ratio(phraseEndLong, corpus.length),
    openingRepeatRatio: ratio(openingRepeat, corpus.length),
    phraseLengthBeats: {
      min: Math.min(...beatsList),
      max: Math.max(...beatsList),
      mean: round(sum(beatsList) / beatsList.length, 3),
      median: median(beatsList),
      histogram: sortedNumKeys(beatsHistogram),
    },
    modeCount,
    byRegion,
  };
}

export function buildPatterns(corpus = CORPUS) {
  return {
    // 由来を出力にも残しておく。監査はテストがやるが、
    // patterns.json 単体を見た人にも根拠が見えるようにする。
    source: {
      pieces: corpus.length,
      publicDomainRule: 'composer died <= 1955, or traditional (died: null)',
      newestDeathYear: Math.max(...corpus.filter((e) => e.died !== null).map((e) => e.died)),
      traditionalCount: corpus.filter((e) => e.died === null).length,
    },
    formulas: extractFormulas(corpus),
    cadences: extractCadences(corpus),
    rhythmCells: extractRhythmCells(corpus),
    soars: extractSoars(corpus),
    stats: extractStats(corpus),
  };
}

export function serializePatterns(patterns) {
  return `${JSON.stringify(patterns, null, 2)}\n`;
}

function outPathFromArgv(argv) {
  const i = argv.indexOf('--out');
  if (i === -1) return OUT_PATH;
  const value = argv[i + 1];
  if (!value) throw new Error('--out には出力先パスが必要');
  return resolve(process.cwd(), value);
}

function main() {
  const out = outPathFromArgv(process.argv.slice(2));
  const patterns = buildPatterns(CORPUS);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, serializePatterns(patterns));

  const { stats } = patterns;
  process.stdout.write([
    `wrote ${out}`,
    `  pieces      : ${stats.pieces} (notes ${stats.notes}, intervals ${stats.intervals})`,
    `  formulas    : ${patterns.formulas.length}`,
    `  cadences    : ${patterns.cadences.length}`,
    `  rhythmCells : ${patterns.rhythmCells.length}`,
    `  soars       : ${patterns.soars.length} kinds / ${stats.soarCount} hits`,
    `  stepwise    : ${stats.stepwiseRatio}`,
    `  leapThenStep: ${stats.leapThenStepRatio}`,
    `  tonicEnd    : ${stats.cadenceOnTonicRatio}`,
    `  phraseEndLong: ${stats.phraseEndLongRatio}`,
    `  openingRepeat: ${stats.openingRepeatRatio}`,
    '',
  ].join('\n'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
