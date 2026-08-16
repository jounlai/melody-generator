#!/usr/bin/env node
// src/data/progressions.json を生成する。
//
// 「涙を流すほど美しい」ヒーリングBGMのための泣けるコード進行カタログ。
// 26個の定石進行(メジャー14 / マイナー12)を土台に、決定論的な変形を適用して
// メジャー55件・マイナー44件(計99件)を選抜する。Math.random() は使わない。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHORD_VOCAB, parseChord } from '../src/theory.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, '../src/data/progressions.json');

const MAJOR_COUNT = 55;
const MINOR_COUNT = 44;

// ---------------------------------------------------------------------------
// 定石カタログ(泣ける進行の核心)
// ---------------------------------------------------------------------------

const CATALOG = [
  // --- major ---
  { mode: 'major', bars: ['I', 'V/3', 'vi', 'iii'] },      // カノン進行前半(ベース順次下降)
  { mode: 'major', bars: ['IV', 'I/3', 'IV', 'V'] },       // カノン進行後半
  { mode: 'major', bars: ['I', 'V', 'vi', 'IV'] },
  { mode: 'major', bars: ['vi', 'IV', 'I', 'V'] },
  { mode: 'major', bars: ['IV', 'V', 'iii', 'vi'] },       // 王道進行
  { mode: 'major', bars: ['I', 'vi', 'IV', 'V'] },
  { mode: 'major', bars: ['IV', 'iv', 'I', 'I'] },         // サブドミナントマイナー
  { mode: 'major', bars: ['I', 'IVM7', 'iv', 'I'] },       // サブドミナントマイナー
  { mode: 'major', bars: ['I', 'V', 'vi', 'bVI'] },        // 借用和音
  { mode: 'major', bars: ['IV', 'V', 'I', 'vi'] },         // 偽終止的
  { mode: 'major', bars: ['IM7', 'iii7', 'vi7', 'IV'] },
  { mode: 'major', bars: ['I', 'bVII', 'IV', 'I'] },       // ミクソリディアン借用
  { mode: 'major', bars: ['ii7', 'V7', 'IM7', 'IM7'] },
  { mode: 'major', bars: ['I', 'iii', 'IV', 'V'] },
  // --- minor ---
  { mode: 'minor', bars: ['i', 'VI', 'III', 'VII'] },
  { mode: 'minor', bars: ['i', 'iv', 'v', 'i'] },
  { mode: 'minor', bars: ['i', 'VII', 'VI', 'V'] },
  { mode: 'minor', bars: ['i', 'v', 'VI', 'III'] },
  { mode: 'minor', bars: ['iv', 'i', 'v', 'i'] },
  { mode: 'minor', bars: ['i', 'VI', 'iv', 'V7'] },
  { mode: 'minor', bars: ['i', 'III', 'VII', 'iv'] },
  { mode: 'minor', bars: ['VI', 'VII', 'i', 'i'] },
  { mode: 'minor', bars: ['i', 'iv', 'VII', 'III'] },
  { mode: 'minor', bars: ['i', 'i/3', 'iv', 'v'] },
  { mode: 'minor', bars: ['III', 'VII', 'i', 'VI'] },
  { mode: 'minor', bars: ['i', 'VI', 'VII', 'i'] },
];

// ---------------------------------------------------------------------------
// 変形テーブル
// ---------------------------------------------------------------------------

// テンション付加(記号が完全一致したときだけ適用)。
const TENSION_FORM = {
  I: 'IM7', IV: 'IVM7', V: 'V7', vi: 'vi7',
  i: 'i7', III: 'IIIM7', iv: 'iv7', VI: 'VIM7', v: 'v7',
};

// 代理コード。
const SUBSTITUTE = {
  major: { I: 'vi', IV: 'ii', V: 'iii' },
  minor: { i: 'III', iv: 'VI', v: 'VII' },
};

// サブドミナントマイナー系(最も泣ける差し替え先)。
const SDM = { major: 'iv', minor: 'VI' };

// 偽終止の着地先。
const DECEPTIVE_TARGET = { major: 'vi', minor: 'VI' };

const VARIANTS = [
  // v0 は原形。以降は bars(長さ4)と mode を受け取り、新しい bars か null を返す。
  { id: 'v0', apply: (bars) => bars.slice() },

  // v4: 最終小節をサブドミナントマイナー系へ。一番「泣ける」変形なので最優先で採用する。
  { id: 'v4', apply: (bars, mode) => [bars[0], bars[1], bars[2], SDM[mode]] },

  // v6: 終止形が V で終わる進行を偽終止化する([a,b,c,V] -> [a,b,V,vi/VI])。
  {
    id: 'v6',
    apply: (bars, mode) => (baseForm(bars[3]) === 'V'
      ? [bars[0], bars[1], bars[3], DECEPTIVE_TARGET[mode]]
      : null),
  },

  // v1: 2小節目を第1転回形に(すでに転回しているならスキップ)。
  {
    id: 'v1',
    apply: (bars) => (bars[1].includes('/')
      ? null
      : [bars[0], `${bars[1]}/3`, bars[2], bars[3]]),
  },

  // v2: 最終小節にテンションを付加。
  {
    id: 'v2',
    apply: (bars) => (TENSION_FORM[bars[3]]
      ? [bars[0], bars[1], bars[2], TENSION_FORM[bars[3]]]
      : null),
  },

  // v3: 3小節目を代理コードへ。
  {
    id: 'v3',
    apply: (bars, mode) => (SUBSTITUTE[mode][bars[2]]
      ? [bars[0], bars[1], SUBSTITUTE[mode][bars[2]], bars[3]]
      : null),
  },

  // v5: 1小節目にテンションを付加(件数を99に届かせるための補助変形)。
  {
    id: 'v5',
    apply: (bars) => (TENSION_FORM[bars[0]]
      ? [TENSION_FORM[bars[0]], bars[1], bars[2], bars[3]]
      : null),
  },
];

// ---------------------------------------------------------------------------
// 解析ヘルパ
// ---------------------------------------------------------------------------

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// 転回形・テンションを取り除いた基本形。'IVM7' -> 'IV', 'i/3' -> 'i', 'bVII' -> 'bVII'
function baseForm(symbol) {
  const c = parseChord(symbol);
  const roman = ROMAN_NUMERALS[c.rootDeg - 1];
  return (c.flat ? 'b' : '') + (c.minor ? roman.toLowerCase() : roman);
}

const TENSION_TABLE = {
  I: 1, i: 1,
  IV: 2, ii: 2, vi: 2, VI: 2, III: 2,
  iv: 3, iii: 3, v: 3, VII: 3, bVII: 3,
  V: 4, bVI: 4,
};

function tensionOf(bars) {
  return bars.map((sym) => TENSION_TABLE[baseForm(sym)] ?? 2);
}

function cadenceOf(bars) {
  const a = baseForm(bars[2]);
  const b = baseForm(bars[3]);
  if (a === 'V' && (b === 'vi' || b === 'VI')) return 'deceptive';
  if (a === 'V' && (b === 'I' || b === 'i')) return 'authentic';
  if ((a === 'IV' && b === 'I') || (a === 'iv' && (b === 'I' || b === 'i'))) return 'plagal';
  return 'open';
}

function inVocab(bars, mode) {
  return bars.every((sym) => CHORD_VOCAB[mode].includes(sym));
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

// 変形の優先順(VARIANTS の並び)ごとに、定石カタログの順で走査する。
// こうすることで「26個の原形すべて」と「v4(サブドミナントマイナー)すべて」が
// 必ず選抜に残る。選抜は完全に決定論的。
function generate() {
  const candidates = [];
  for (const variant of VARIANTS) {
    CATALOG.forEach((base, baseIndex) => {
      const bars = variant.apply(base.bars, base.mode);
      if (!bars) return;
      if (bars.length !== 4) return;
      if (!inVocab(bars, base.mode)) return;
      candidates.push({ mode: base.mode, bars, baseIndex, variant: variant.id });
    });
  }

  const seen = new Set();
  const picked = { major: [], minor: [] };
  for (const c of candidates) {
    const key = `${c.mode}|${c.bars.join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked[c.mode].push(c);
  }

  const need = { major: MAJOR_COUNT, minor: MINOR_COUNT };
  for (const mode of ['major', 'minor']) {
    if (picked[mode].length < need[mode]) {
      throw new Error(`${mode}: ${picked[mode].length} 件しか生成できません(必要 ${need[mode]} 件)`);
    }
  }

  const chosen = [
    ...picked.major.slice(0, MAJOR_COUNT),
    ...picked.minor.slice(0, MINOR_COUNT),
  ];

  return chosen.map((c, i) => ({
    id: `p${String(i + 1).padStart(2, '0')}`,
    mode: c.mode,
    bars: c.bars.map((chord) => ({ chord })),
    cadence: cadenceOf(c.bars),
    tension: tensionOf(c.bars),
  }));
}

// 1進行1行の JSON。差分が読みやすい。
function serialize(items) {
  const lines = items.map((it) => `  ${JSON.stringify(it)}`);
  return `[\n${lines.join(',\n')}\n]\n`;
}

const progressions = generate();
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, serialize(progressions), 'utf8');

const cadences = {};
for (const p of progressions) cadences[p.cadence] = (cadences[p.cadence] ?? 0) + 1;
const sdmCount = progressions.filter(
  (p) => p.mode === 'major' && p.bars.some((b) => baseForm(b.chord) === 'iv'),
).length;

console.log(`wrote ${OUT_PATH}`);
console.log(`  total   : ${progressions.length}`);
console.log(`  major   : ${progressions.filter((p) => p.mode === 'major').length}`);
console.log(`  minor   : ${progressions.filter((p) => p.mode === 'minor').length}`);
console.log(`  cadence : ${JSON.stringify(cadences)}`);
console.log(`  major with subdominant-minor (iv): ${sdmCount}`);
