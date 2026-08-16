#!/usr/bin/env node
// src/data/progressions.json を生成する。
//
// 方針は「大衆的に人気のある進行を軸に組む」。
// 基礎カタログの先頭に小室進行・アクシス進行・王道進行といった定番中の定番を置き
// (popularity 5)、そこから素直な変形 — 2小節目の転回形化 / 終止のテンション付加 /
// 偽終止化 / セカンダリードミナント化 / サブドミナントマイナー化 — の5種類だけを広げる。
// 変形は原形より popularity を1下げるので、カタログ上位がそのまま出現頻度の上位になる。
//
// バラードの背骨は3つ。カタログにはこれを明示的に入れてある。
//   - セカンダリードミナント (V/vi=III7, V/ii=VI7, V/V=II7, V/IV=I7, V/iii=VII7)
//   - 転回形を連ねた下降ベース (V/7, IM7/3, iii/3, vi/3, i/7, III/3 …)
//   - ii-V の連鎖
//
// メジャー55件・マイナー44件(計99件)。Math.random() は使わない(完全に決定論的)。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHORD_VOCAB, parseChord, bassMidi } from '../src/theory.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, '../src/data/progressions.json');

const MAJOR_COUNT = 55;
const MINOR_COUNT = 44;

// popularity >= 4 の最低件数。これを割るなら「よくある感じ」にならないので生成を失敗させる。
const MIN_POPULAR = 50;

// バラードの背骨の最低件数。ここを割ると「名曲のあの感じ」が出ない。
const MIN_SECONDARY = 15;   // セカンダリードミナントを含む進行
const MIN_DESCENDING = 10;  // ベースが3小節以上つづけて下がる進行

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
  // --- major: セカンダリードミナント(V/vi・V/ii・V/V・V/IV) ---
  // 音階外の音を1つだけ含む借用和音。バラードで胸が締めつけられる瞬間はたいていこれ。
  { mode: 'major', pop: 5, name: 'イエスタデイ型', bars: ['I', 'iii7', 'III7', 'vi'] },
  { mode: 'major', pop: 5, name: 'V/IV からサブドミナントマイナー', bars: ['I', 'I7', 'IV', 'iv'] },
  { mode: 'major', pop: 5, name: 'V/V 経由のツーファイブ', bars: ['vi', 'II7', 'ii7', 'V7'] },
  { mode: 'major', pop: 5, name: '循環コードの豪華版', bars: ['IM7', 'VI7', 'ii7', 'V7'] },
  { mode: 'major', pop: 5, name: '丸の内進行に近い形', bars: ['IV', 'III7', 'vi', 'I7'] },
  // --- major: 下降ベース ---
  // 転回形を連ねてベースを順次下降させる。愛の賛歌型の常套句。
  // ベースが C-B-A-G と順次下降する。バラードの下降ベースの原型。
  // V/7（7thがベース）だと C-F-A-G になって下降しないので V/3 が正しい。
  { mode: 'major', pop: 5, name: '下降ベースの定番', bars: ['I', 'V/3', 'vi', 'I/5'] },
  { mode: 'major', pop: 5, name: '下降ベースからサブドミナントマイナー', bars: ['IM7', 'IM7/3', 'IV', 'iv'] },
  { mode: 'major', pop: 5, name: 'ゆるやかな下降', bars: ['I', 'iii/3', 'IV', 'IV/3'] },
  { mode: 'major', pop: 5, name: 'vi からの下降ベース', bars: ['vi', 'vi/3', 'IV', 'V'] },
  // --- major: よく使われる ---
  { mode: 'major', pop: 4, name: '王道進行のテンション形', bars: ['IVM7', 'V', 'iii', 'vi'] },
  { mode: 'major', pop: 4, name: '順次上行', bars: ['I', 'iii', 'IV', 'V'] },
  { mode: 'major', pop: 4, name: 'サブドミナントマイナー', bars: ['IV', 'iv', 'I', 'I'] },
  { mode: 'major', pop: 4, name: '3度堆積', bars: ['IM7', 'iii7', 'vi7', 'IV'] },
  { mode: 'major', pop: 4, name: 'IV-iv 挟み', bars: ['I', 'IVM7', 'iv', 'I'] },
  // --- major: ii-V の連鎖(バカラック系の色) ---
  { mode: 'major', pop: 4, name: 'ツーファイブのテンション形', bars: ['ii9', 'V9', 'IM7', 'IM7'] },
  { mode: 'major', pop: 4, name: 'ツーファイブの連鎖', bars: ['ii7', 'V7', 'iii7', 'VI7'] },
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
  // --- minor: 下降ベースとセカンダリードミナント ---
  { mode: 'minor', pop: 5, name: '短調の下降ベース', bars: ['i', 'i/7', 'VI', 'III'] },
  { mode: 'minor', pop: 5, name: 'V/v を経由する短調', bars: ['i', 'II7', 'v', 'i'] },
  { mode: 'minor', pop: 5, name: 'V/III を経由する短調', bars: ['i', 'VII7', 'III', 'iv'] },
  { mode: 'minor', pop: 5, name: '転回形で着地する短調', bars: ['VI', 'VII', 'III/3', 'i'] },
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
// 変形テーブル(5種類だけ。原形と素直な変形で99件を埋める)
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

// 3小節目の和音へ向かうセカンダリードミナント(その和音を一時的な主和音とみなした V7)。
// 2小節目をこれに差し替えると、音階外の音が1つ入って進行に陰りが差す。
// 主和音(I / i)自身の V は「セカンダリー」ではないので入れない。
const SECONDARY_DOMINANT = {
  major: {
    ii: 'VI7', iii: 'VII7', IV: 'I7', V: 'II7', vi: 'III7',
  },
  minor: {
    III: 'VII7', v: 'II7', VII: 'IV7',
  },
};

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

  // 2小節目を「3小節目へ向かうセカンダリードミナント」へ差し替える。
  // I - vi - IV - V が I - I7 - IV - V に、vi - IV - V - I が vi - II7 - V - I になる。
  // 骨格(1・3・4小節目)は原形のまま残り、2小節目だけが借用和音になる。
  {
    id: 'sec',
    penalty: 1,
    label: 'の変形(セカンダリードミナント)',
    apply: (bars, mode) => {
      const sd = SECONDARY_DOMINANT[mode][baseForm(bars[2])];
      return sd ? [bars[0], sd, bars[2], bars[3]] : null;
    },
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

// 大文字ローマ数字 + 短7度。V7 だけは本来のドミナントなので除く。
// 借用の緊張があるので、基本形の緊張度ではなく V と同じ 4 を与える。
function isSecondaryDominant(symbol) {
  const c = parseChord(symbol);
  return c.quality === '7' && !c.minor && !c.flat && c.rootDeg !== 5;
}

function tensionOf(bars) {
  return bars.map((sym) => (
    isSecondaryDominant(sym) ? 4 : TENSION_TABLE[baseForm(sym)] ?? 2
  ));
}

function cadenceOf(bars) {
  const a = baseForm(bars[2]);
  const b = baseForm(bars[3]);
  if (a === 'V' && (b === 'vi' || b === 'VI')) return 'deceptive';
  if (a === 'V' && (b === 'I' || b === 'i')) return 'authentic';
  if ((a === 'IV' && b === 'I') || (a === 'iv' && (b === 'I' || b === 'i'))) return 'plagal';
  return 'open';
}

// ベースが3小節以上つづけて単調非増加か。転回形を連ねた下降ベースはここに出る。
// bassMidi は1オクターブの窓に丸めるので、値は主音を下端とした相対音高。
function descendingBarCount(bars, mode) {
  const line = bars.map((sym) => bassMidi(sym, mode, 60, 36));
  let best = 1;
  let run = 1;
  for (let i = 1; i < line.length; i++) {
    run = line[i] <= line[i - 1] ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
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

// 候補の並び＝選抜の優先順。
//
//   1. 原形(カタログ順)を全部。カタログは51件で定員99件より少ないので、
//      popularity 5 の定番も新しく足したバラード進行も、押し出されることはない。
//   2. そのあと変形。変形は「種類ごとにカタログ順」で並べたうえで種類を輪番に取る
//      (転回形 → テンション → 偽終止 → セカンダリードミナント → サブドミナント
//      マイナー → 転回形 → …)。1種類がカタログ全部ぶんの枠を独占すると、
//      後ろの種類が1件も残らない(偽終止もセカンダリードミナントも消える)。
//
// 選抜は完全に決定論的。
function generate() {
  const [origins, ...variantGroups] = VARIANTS.map((variant) => {
    const group = [];
    CATALOG.forEach((base, baseIndex) => {
      const bars = variant.apply(base.bars, base.mode);
      if (!bars || bars.length !== 4) return;
      if (!inVocab(bars, base.mode)) return;
      group.push({
        mode: base.mode,
        bars,
        baseIndex,
        variant: variant.id,
        name: variant.label ? `${base.name}${variant.label}` : base.name,
        popularity: clampPop(base.pop - variant.penalty),
      });
    });
    return group;
  });

  const candidates = [...origins];
  const deepest = Math.max(0, ...variantGroups.map((g) => g.length));
  for (let i = 0; i < deepest; i++) {
    for (const group of variantGroups) {
      if (group[i]) candidates.push(group[i]);
    }
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

  const secondary = items.filter(
    (p) => p.bars.some((b) => isSecondaryDominant(b.chord)),
  ).length;
  if (secondary < MIN_SECONDARY) {
    throw new Error(`セカンダリードミナントが ${secondary} 件しかありません(必要 ${MIN_SECONDARY} 件)`);
  }

  const descending = items.filter(
    (p) => descendingBarCount(p.bars.map((b) => b.chord), p.mode) >= 3,
  ).length;
  if (descending < MIN_DESCENDING) {
    throw new Error(`下降ベースが ${descending} 件しかありません(必要 ${MIN_DESCENDING} 件)`);
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
const secondaryCount = progressions.filter(
  (p) => p.bars.some((b) => isSecondaryDominant(b.chord)),
).length;
const descendingCount = progressions.filter(
  (p) => descendingBarCount(p.bars.map((b) => b.chord), p.mode) >= 3,
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
console.log(`  secondary dominant : ${secondaryCount} 件`);
console.log(`  descending bass    : ${descendingCount} 件`);
console.log('  定番の収録状況:');
for (const base of CATALOG) {
  const bars = base.bars.join(' - ');
  const hit = progressions.find(
    (p) => p.mode === base.mode && p.bars.map((b) => b.chord).join(' ') === base.bars.join(' '),
  );
  console.log(`    [${base.mode === 'major' ? 'M' : 'm'}] pop${hit.popularity} ${hit.id}  ${bars}  (${base.name})`);
}
