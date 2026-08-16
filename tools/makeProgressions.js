#!/usr/bin/env node
// src/data/progressions.json を生成する。
//
// 方針は「大衆的に人気のある進行を軸に組む」。
// 基礎カタログの先頭に小室進行・アクシス進行・王道進行といった定番中の定番を置き
// (popularity 5)、そこから素直な変形 — 2小節目の転回形化 / 終止のテンション付加 /
// 偽終止化 / サブドミナントマイナー化 — の4種類だけを広げる。
// 変形は原形より popularity を1下げるので、カタログ上位がそのまま出現頻度の上位になる。
//
// メジャー55件・マイナー44件(計99件)。Math.random() は使わない(完全に決定論的)。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHORD_VOCAB, parseChord } from '../src/theory.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, '../src/data/progressions.json');

const MAJOR_COUNT = 55;
const MINOR_COUNT = 44;

// popularity >= 4 の最低件数。これを割るなら「よくある感じ」にならないので生成を失敗させる。
const MIN_POPULAR = 50;

// ---------------------------------------------------------------------------
// 基礎カタログ
//
// popularity は 1〜5。5 は「誰でもどこかで聴いたことがある」定番、
// 3 以下は色物・陰り担当で、数を絞って混ぜる。
// 並び順は選抜の優先順でもあるので、人気の高いものから書く。
// ---------------------------------------------------------------------------

const CATALOG = [
  // --- major: 名曲で実際に使われている定番 ---
  { mode: 'major', pop: 5, name: '小室進行', bars: ['vi', 'IV', 'V', 'I'] },
  { mode: 'major', pop: 5, name: 'アクシス進行', bars: ['I', 'V', 'vi', 'IV'] },
  { mode: 'major', pop: 5, name: 'アクシス進行の回転形', bars: ['vi', 'IV', 'I', 'V'] },
  { mode: 'major', pop: 5, name: '王道進行', bars: ['IV', 'V', 'iii', 'vi'] },
  { mode: 'major', pop: 5, name: '50年代進行', bars: ['I', 'vi', 'IV', 'V'] },
  { mode: 'major', pop: 5, name: '循環コード', bars: ['I', 'vi', 'ii', 'V'] },
  { mode: 'major', pop: 5, name: 'カノン進行 前半', bars: ['I', 'V/3', 'vi', 'iii'] },
  { mode: 'major', pop: 5, name: 'カノン進行 後半', bars: ['IV', 'I/3', 'IV', 'V'] },
  { mode: 'major', pop: 5, name: '偽終止', bars: ['IV', 'V', 'I', 'vi'] },
  { mode: 'major', pop: 5, name: '下降ベースのバラード常套句', bars: ['vi', 'V', 'IV', 'V'] },
  { mode: 'major', pop: 5, name: 'ツーファイブワン', bars: ['ii7', 'V7', 'IM7', 'IM7'] },
  { mode: 'major', pop: 5, name: '全終止の基本形', bars: ['I', 'IV', 'V', 'I'] },
  // --- major: よく使われる ---
  { mode: 'major', pop: 4, name: '王道進行のテンション形', bars: ['IVM7', 'V', 'iii', 'vi'] },
  { mode: 'major', pop: 4, name: '順次上行', bars: ['I', 'iii', 'IV', 'V'] },
  { mode: 'major', pop: 4, name: 'サブドミナントマイナー', bars: ['IV', 'iv', 'I', 'I'] },
  { mode: 'major', pop: 4, name: '3度堆積', bars: ['IM7', 'iii7', 'vi7', 'IV'] },
  { mode: 'major', pop: 4, name: 'IV-iv 挟み', bars: ['I', 'IVM7', 'iv', 'I'] },
  // --- major: 色物・陰り担当(数は控えめに) ---
  { mode: 'major', pop: 3, name: 'bVI 借用', bars: ['I', 'V', 'vi', 'bVI'] },
  { mode: 'major', pop: 3, name: 'ミクソリディアン借用', bars: ['I', 'bVII', 'IV', 'I'] },
  { mode: 'major', pop: 2, name: 'bVI-bVII 上行', bars: ['I', 'bVI', 'bVII', 'I'] },

  // --- minor: 名曲で実際に使われている定番 ---
  { mode: 'minor', pop: 5, name: 'マイナーのアクシス進行', bars: ['i', 'VI', 'III', 'VII'] },
  { mode: 'minor', pop: 5, name: '下降と回帰', bars: ['i', 'VII', 'VI', 'VII'] },
  { mode: 'minor', pop: 5, name: '短調の全終止', bars: ['i', 'iv', 'v', 'i'] },
  { mode: 'minor', pop: 5, name: '短調の王道', bars: ['i', 'VI', 'iv', 'V7'] },
  { mode: 'minor', pop: 5, name: '盛り上がりの定番', bars: ['VI', 'VII', 'i', 'i'] },
  { mode: 'minor', pop: 5, name: '短調の循環', bars: ['i', 'iv', 'VII', 'III'] },
  { mode: 'minor', pop: 5, name: '下行バス', bars: ['i', 'VII', 'VI', 'V'] },
  { mode: 'minor', pop: 5, name: 'VI-VII-i', bars: ['i', 'VI', 'VII', 'i'] },
  // --- minor: よく使われる ---
  { mode: 'minor', pop: 4, name: '平行長調へ', bars: ['i', 'v', 'VI', 'III'] },
  { mode: 'minor', pop: 4, name: '3度上行', bars: ['i', 'III', 'VII', 'iv'] },
  { mode: 'minor', pop: 4, name: 'マイナーバラード', bars: ['i', 'iv', 'VI', 'V'] },
  { mode: 'minor', pop: 4, name: 'サブドミナント始まり', bars: ['iv', 'i', 'v', 'i'] },
  // --- minor: 色物・陰り担当 ---
  { mode: 'minor', pop: 3, name: '転回バス', bars: ['i', 'i/3', 'iv', 'v'] },
  { mode: 'minor', pop: 3, name: '平行長調始まり', bars: ['III', 'VII', 'i', 'VI'] },
  { mode: 'minor', pop: 3, name: '下行3度', bars: ['i', 'VII', 'III', 'VI'] },
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

// ---------------------------------------------------------------------------
// 変形テーブル(4種類だけ。原形と素直な変形で99件を埋める)
// ---------------------------------------------------------------------------

// テンション付加(記号が完全一致したときだけ適用)。
const TENSION_FORM = {
  I: 'IM7', ii: 'ii7', iii: 'iii7', IV: 'IVM7', V: 'V7', vi: 'vi7',
  i: 'i7', III: 'IIIM7', iv: 'iv7', v: 'v7', VI: 'VIM7',
};

// サブドミナントマイナー系(最も泣ける差し替え先)。
const SDM = { major: 'iv', minor: 'VI' };

// 偽終止の着地先。
const DECEPTIVE_TARGET = { major: 'vi', minor: 'VI' };

const VARIANTS = [
  // 原形。penalty 0。
  { id: 'orig', penalty: 0, label: null, apply: (bars) => bars.slice() },

  // 2小節目を第1転回形に(すでに転回しているならスキップ)。ベースが動いて進行が滑り出す。
  {
    id: 'inv',
    penalty: 1,
    label: 'の変形(転回形)',
    apply: (bars) => (bars[1].includes('/')
      ? null
      : [bars[0], `${bars[1]}/3`, bars[2], bars[3]]),
  },

  // 最終小節にテンションを付加。響きだけが変わって進行の骨格は残る。
  {
    id: 'ten',
    penalty: 1,
    label: 'の変形(テンション)',
    apply: (bars) => (TENSION_FORM[bars[3]]
      ? [bars[0], bars[1], bars[2], TENSION_FORM[bars[3]]]
      : null),
  },

  // 偽終止化。V で終わる進行を [a, b, V, vi/VI] に組み替える。
  // V の連続([a, V, V, vi])になる形は間延びするので作らない。
  {
    id: 'dec',
    penalty: 1,
    label: 'の変形(偽終止)',
    apply: (bars, mode) => (baseForm(bars[3]) === 'V' && baseForm(bars[1]) !== 'V'
      ? [bars[0], bars[1], bars[3], DECEPTIVE_TARGET[mode]]
      : null),
  },

  // 最終小節をサブドミナントマイナー系へ。
  // 直前が V の長調(V -> iv)と、同じ和音が隣り合う形は避ける。
  {
    id: 'sdm',
    penalty: 1,
    label: 'の変形(サブドミナントマイナー)',
    apply: (bars, mode) => {
      const sub = SDM[mode];
      if (baseForm(bars[2]) === sub || baseForm(bars[3]) === sub) return null;
      if (mode === 'major' && baseForm(bars[2]) === 'V') return null;
      return [bars[0], bars[1], bars[2], sub];
    },
  },
];

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

function clampPop(pop) {
  return Math.min(5, Math.max(1, Math.round(pop)));
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

// 変形の優先順(VARIANTS の並び)ごとに、カタログの順(=人気の順)で走査する。
// 原形が最初に来るので、定番32個は必ず全部残る。そのあと転回形 → テンション →
// 偽終止 → サブドミナントマイナー の順に埋まっていき、件数に達したところで打ち切る。
// 選抜は完全に決定論的。
function generate() {
  const candidates = [];
  for (const variant of VARIANTS) {
    CATALOG.forEach((base, baseIndex) => {
      const bars = variant.apply(base.bars, base.mode);
      if (!bars || bars.length !== 4) return;
      if (!inVocab(bars, base.mode)) return;
      candidates.push({
        mode: base.mode,
        bars,
        baseIndex,
        variant: variant.id,
        name: variant.label ? `${base.name}${variant.label}` : base.name,
        popularity: clampPop(base.pop - variant.penalty),
      });
    });
  }

  // 重複排除。先に来たほう(＝原形、あるいは人気の高い原形から派生したほう)が勝つ。
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
    name: c.name,
    bars: c.bars.map((chord) => ({ chord })),
    cadence: cadenceOf(c.bars),
    tension: tensionOf(c.bars),
    popularity: c.popularity,
  }));
}

// 生成物が「大衆的」であることの自己検査。ここを通らないデータは書き出さない。
function verify(items) {
  const key = (mode, bars) => `${mode}|${bars.join(' ')}`;
  const have = new Set(items.map((p) => key(p.mode, p.bars.map((b) => b.chord))));
  const byKey = new Map(items.map((p) => [key(p.mode, p.bars.map((b) => b.chord)), p]));

  for (const base of CATALOG) {
    const k = key(base.mode, base.bars);
    if (!have.has(k)) throw new Error(`定番が落ちている: ${base.name} (${k})`);
    const got = byKey.get(k).popularity;
    if (got !== base.pop) throw new Error(`${base.name}: popularity が ${got}(期待 ${base.pop})`);
    if (byKey.get(k).name !== base.name) throw new Error(`${base.name}: name が付いていない`);
  }
  for (const p of items) {
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new Error(`${p.id}: name が空`);
    }
  }

  const popular = items.filter((p) => p.popularity >= 4).length;
  if (popular < MIN_POPULAR) {
    throw new Error(`popularity>=4 が ${popular} 件しかありません(必要 ${MIN_POPULAR} 件)`);
  }
  for (const p of items) {
    if (!Number.isInteger(p.popularity) || p.popularity < 1 || p.popularity > 5) {
      throw new Error(`${p.id}: popularity が範囲外 (${p.popularity})`);
    }
  }
}

// 1進行1行の JSON。差分が読みやすい。
function serialize(items) {
  const lines = items.map((it) => `  ${JSON.stringify(it)}`);
  return `[\n${lines.join(',\n')}\n]\n`;
}

const progressions = generate();
verify(progressions);
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, serialize(progressions), 'utf8');

const cadences = {};
for (const p of progressions) cadences[p.cadence] = (cadences[p.cadence] ?? 0) + 1;
const pops = {};
for (const p of progressions) pops[p.popularity] = (pops[p.popularity] ?? 0) + 1;
const sdmCount = progressions.filter(
  (p) => p.mode === 'major' && p.bars.some((b) => baseForm(b.chord) === 'iv'),
).length;
const histogram = [5, 4, 3, 2, 1]
  .map((n) => `${n}:${pops[n] ?? 0}`)
  .join(' / ');

console.log(`wrote ${OUT_PATH}`);
console.log(`  total   : ${progressions.length}`);
console.log(`  major   : ${progressions.filter((p) => p.mode === 'major').length}`);
console.log(`  minor   : ${progressions.filter((p) => p.mode === 'minor').length}`);
console.log(`  cadence : ${JSON.stringify(cadences)}`);
console.log(`  popularity (5→1) : ${histogram}`);
console.log(`  popularity >= 4  : ${progressions.filter((p) => p.popularity >= 4).length} 件`);
console.log(`  major with subdominant-minor (iv): ${sdmCount}`);
console.log('  定番の収録状況:');
for (const base of CATALOG) {
  const bars = base.bars.join(' - ');
  const hit = progressions.find(
    (p) => p.mode === base.mode && p.bars.map((b) => b.chord).join(' ') === base.bars.join(' '),
  );
  console.log(`    [${base.mode === 'major' ? 'M' : 'm'}] pop${hit.popularity} ${hit.id}  ${bars}  (${base.name})`);
}
