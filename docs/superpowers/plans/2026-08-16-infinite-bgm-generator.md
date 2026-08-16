# 無限BGM生成器 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 999個のメロディー断片と99個のコード進行を事前データ化し、ブラウザ上で「涙を流すほど美しい」BGMを無限に生成し続けるページを作る。

**Architecture:** メロディー断片はキーに対するスケール度数（1〜15の通し番号）で保持し、mode によって度数→半音の変換表を切り替えることでメジャー／マイナー両方の進行に乗せる。事前生成スクリプトが候補を大量に作り、美しさスコア（減点＋加点）で評価し、輪郭×緊張度×終止度数のバケットごとの層化抽出で999個を選ぶ。ランタイムは A-A'-B-A'' の32小節構成に対し、コード適合・接続の滑らかさ・起伏カーブの3フィルタを通した候補からシード付きPRNGで断片を引く。

**Tech Stack:** 素の ESM + Web Audio API + Node 20 の `node:test`。ビルドツールなし、依存パッケージゼロ。

## Global Constraints

これらは全タスクの要件に暗黙に含まれる。

- **依存パッケージはゼロ。** `npm install` で何も入れない。ビルドツール・フレームワーク・トランスパイラを使わない
- 全ファイル素の ESM（`import` / `export`）。`package.json` に `"type": "module"`
- テストは `node:test` と `node:assert/strict` のみ。実行は `npm test`
- `src/` 配下はブラウザとNodeの両方で動くこと（`window` / `document` を参照するのは `ui.js` と `main.js` だけ）
- `tools/` 配下はNode専用。`src/` から `tools/` を import してはならない
- **`Math.random()` の使用は `src/synth.js` 内に限る**（リバーブIRとパッドのデチューン）。他の全モジュールはシード由来のPRNGを使う
- メロディー断片は 2小節 = 8拍。`beat` は 0.0〜8.0、`deg` は 1〜15 の通しスケール度数
- コード進行は 4小節ちょうど
- `src/data/melodies.json` は999件ちょうど、`src/data/progressions.json` は99件ちょうど
- 調整可能パラメータは `src/settings.js` の `PARAM_DEFS` にのみ定義する。他ファイルに数値をハードコードしない
- `compose.js` / `synth.js` / `player.js` は設定オブジェクトを引数で受け取る
- コミットメッセージは日本語。各タスクの最後に必ずコミットする

## ファイル構成

| ファイル | 責務 |
|---|---|
| `src/rng.js` | シード付きPRNG（mulberry32）と抽選ヘルパ |
| `src/theory.js` | 度数→MIDI、コード記号の解釈、コードトーン判定、適合判定 |
| `src/settings.js` | 調整可能パラメータの定義・既定値・検証・曲コードの符号化 |
| `src/compose.js` | 曲の組み立て（進行選択・断片選択・イベント列生成） |
| `src/perform.js` | 曲イベント列→演奏イベント列（揺らぎ適用）。純関数 |
| `src/synth.js` | Web Audio 音源3レイヤー＋リバーブ |
| `src/player.js` | 先読みスケジューラと曲の連結 |
| `src/ui.js` | `PARAM_DEFS` から設定パネルを自動生成 |
| `src/main.js` | 起動と配線 |
| `tools/analyze.js` | 断片のメタデータ算出（輪郭・タグ・緊張度） |
| `tools/score.js` | 美しさスコア |
| `tools/generate.js` | 候補断片の生成 |
| `tools/makeProgressions.js` | 定石カタログ→変形展開→`progressions.json` |
| `tools/makeMelodies.js` | 大量生成→スコア→層化抽出→`melodies.json` |

`perform.js` を `player.js` から切り出しているのは、揺らぎの適用がテスト可能な純関数だから。`player.js` に混ぜると Web Audio 依存でテストできなくなる。

---

### Task 1: プロジェクト土台とシード付きPRNG

**Files:**
- Create: `package.json`
- Create: `src/rng.js`
- Test: `test/rng.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `makeRng(seed: number) => () => number` — [0,1) を返す関数
  - `seedFromString(str: string) => number` — uint32
  - `randInt(rng, min: number, max: number) => number` — max を含む
  - `pick(rng, arr: T[]) => T`
  - `shuffle(rng, arr: T[]) => T[]` — 新しい配列を返す

- [ ] **Step 1: `package.json` を作る**

```json
{
  "name": "melody-generator",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "python3 -m http.server 8080",
    "test": "node --test test/",
    "data:progressions": "node tools/makeProgressions.js",
    "data:melodies": "node tools/makeMelodies.js",
    "data": "npm run data:progressions && npm run data:melodies"
  }
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/rng.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, seedFromString, randInt, pick, shuffle } from '../src/rng.js';

test('makeRng は同じシードで同じ列を返す', () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('makeRng は違うシードで違う列を返す', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  assert.notEqual(a(), b());
});

test('makeRng の出力は [0,1) に収まる', () => {
  const r = makeRng(999);
  for (let i = 0; i < 2000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `範囲外: ${v}`);
  }
});

test('seedFromString は同じ文字列で同じ値、違う文字列で違う値', () => {
  assert.equal(seedFromString('a3f91c'), seedFromString('a3f91c'));
  assert.notEqual(seedFromString('a3f91c'), seedFromString('a3f91d'));
  assert.ok(Number.isInteger(seedFromString('x')));
});

test('randInt は min と max を両端とも含む', () => {
  const r = makeRng(7);
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(randInt(r, 3, 6));
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
});

test('pick は配列の要素を返す', () => {
  const r = makeRng(42);
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) assert.ok(arr.includes(pick(r, arr)));
});

test('shuffle は元配列を壊さず、同じ要素を返す', () => {
  const r = makeRng(5);
  const src = [1, 2, 3, 4, 5, 6];
  const out = shuffle(r, src);
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...out].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6]);
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/rng.js'`

- [ ] **Step 4: `src/rng.js` を実装**

```js
// mulberry32: 32bit状態の高速PRNG。同じシードから常に同じ列を生む。
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32bit
export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（7テスト）

- [ ] **Step 6: コミット**

```bash
git add package.json src/rng.js test/rng.test.js
git commit -m "シード付きPRNGと抽選ヘルパを追加"
```

---

### Task 2: 音楽理論 — 度数とコード記号の解釈

**Files:**
- Create: `src/theory.js`
- Test: `test/theory.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `MAJOR_STEPS: number[]`, `MINOR_STEPS: number[]`
  - `degToSemitone(deg: number, mode: 'major'|'minor') => number`
  - `degToMidi(deg, mode, tonicMidi: number) => number`
  - `parseChord(symbol: string) => {flat: boolean, rootDeg: number, minor: boolean, quality: string, inversion: number}`
  - `chordSemitones(symbol, mode) => number[]` — トニックからの半音（根音位置）
  - `chordPitchClasses(symbol, mode) => number[]` — 0〜11 の昇順・重複なし
  - `isChordTone(deg, mode, symbol) => boolean`
  - `chordVoicing(symbol, mode, tonicMidi, lowestMidi) => number[]` — 転回形を反映したMIDI番号
  - `bassMidi(symbol, mode, tonicMidi, lowestMidi) => number`
  - `CHORD_VOCAB: {major: string[], minor: string[]}`

- [ ] **Step 1: 失敗するテストを書く**

`test/theory.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  degToSemitone, degToMidi, parseChord, chordPitchClasses,
  isChordTone, chordVoicing, bassMidi, CHORD_VOCAB,
} from '../src/theory.js';

test('degToSemitone: メジャースケール', () => {
  assert.equal(degToSemitone(1, 'major'), 0);
  assert.equal(degToSemitone(3, 'major'), 4);
  assert.equal(degToSemitone(7, 'major'), 11);
  assert.equal(degToSemitone(8, 'major'), 12);
  assert.equal(degToSemitone(15, 'major'), 24);
});

test('degToSemitone: 自然的短音階は3度・6度・7度が半音低い', () => {
  assert.equal(degToSemitone(3, 'minor'), 3);
  assert.equal(degToSemitone(6, 'minor'), 8);
  assert.equal(degToSemitone(7, 'minor'), 10);
  assert.equal(degToSemitone(8, 'minor'), 12);
});

test('degToMidi はトニックMIDIを起点にする', () => {
  assert.equal(degToMidi(1, 'major', 60), 60);
  assert.equal(degToMidi(5, 'major', 60), 67);
  assert.equal(degToMidi(8, 'minor', 57), 69);
});

test('parseChord: 転回形と品質を分解する', () => {
  assert.deepEqual(parseChord('I'), { flat: false, rootDeg: 1, minor: false, quality: '', inversion: 0 });
  assert.deepEqual(parseChord('vi'), { flat: false, rootDeg: 6, minor: true, quality: '', inversion: 0 });
  assert.deepEqual(parseChord('V/3'), { flat: false, rootDeg: 5, minor: false, quality: '', inversion: 3 });
  assert.deepEqual(parseChord('IVM7'), { flat: false, rootDeg: 4, minor: false, quality: 'M7', inversion: 0 });
  assert.deepEqual(parseChord('bVII'), { flat: true, rootDeg: 7, minor: false, quality: '', inversion: 0 });
  assert.deepEqual(parseChord('Vsus4'), { flat: false, rootDeg: 5, minor: false, quality: 'sus4', inversion: 0 });
});

test('parseChord: 解釈できない記号は例外', () => {
  assert.throws(() => parseChord('X'), /unparsable|unknown/);
});

test('chordPitchClasses: Cメジャーキーでの実音', () => {
  assert.deepEqual(chordPitchClasses('I', 'major'), [0, 4, 7]);       // C E G
  assert.deepEqual(chordPitchClasses('vi', 'major'), [0, 4, 9]);      // A C E
  assert.deepEqual(chordPitchClasses('iv', 'major'), [0, 5, 8]);      // F Ab C
  assert.deepEqual(chordPitchClasses('bVI', 'major'), [0, 3, 8]);     // Ab C Eb
  assert.deepEqual(chordPitchClasses('V7', 'major'), [2, 5, 7, 11]);  // G B D F
  assert.deepEqual(chordPitchClasses('Vsus4', 'major'), [0, 2, 7]);   // G C D
});

test('chordPitchClasses: マイナーキーの V は導音を含む', () => {
  // Aマイナー相当。V = E G# B
  assert.deepEqual(chordPitchClasses('V', 'minor'), [2, 7, 11]);
  assert.deepEqual(chordPitchClasses('VI', 'minor'), [0, 3, 8]);
});

test('isChordTone は非和声音を弾く', () => {
  assert.equal(isChordTone(3, 'major', 'I'), true);
  assert.equal(isChordTone(4, 'major', 'I'), false);
  assert.equal(isChordTone(10, 'major', 'I'), true);   // 1オクターブ上の3度
  assert.equal(isChordTone(7, 'minor', 'V'), false);   // 自然的短音階の7度はV(導音)に含まれない
});

test('chordVoicing は転回形の最低音を反映する', () => {
  assert.deepEqual(chordVoicing('I', 'major', 60, 48), [48, 52, 55]);
  // 第1転回形は3度が最低音になる
  const v = chordVoicing('I/3', 'major', 60, 48);
  assert.equal(v.length, 3);
  assert.equal(v[0] % 12, 4);
  assert.ok(v[0] >= 48 && v[0] < 60);
});

test('bassMidi は指定した最低音域に収まる', () => {
  const b = bassMidi('V/3', 'major', 60, 36);
  assert.ok(b >= 36 && b < 48, `範囲外: ${b}`);
});

test('CHORD_VOCAB の全記号が解釈できる', () => {
  for (const mode of ['major', 'minor']) {
    assert.ok(CHORD_VOCAB[mode].length >= 15);
    for (const sym of CHORD_VOCAB[mode]) {
      assert.doesNotThrow(() => chordPitchClasses(sym, mode), `解釈できない: ${sym}`);
    }
  }
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/theory.js'`

- [ ] **Step 3: `src/theory.js` を実装**

```js
export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

export function scaleSteps(mode) {
  return mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
}

// deg は1起点の通しスケール度数。1=トニック, 8=1オクターブ上, 15=2オクターブ上。
export function degToSemitone(deg, mode) {
  const idx = deg - 1;
  const oct = Math.floor(idx / 7);
  const step = scaleSteps(mode)[((idx % 7) + 7) % 7];
  return oct * 12 + step;
}

export function degToMidi(deg, mode, tonicMidi) {
  return tonicMidi + degToSemitone(deg, mode);
}

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
const CHORD_RE = /^(b?)([ivIV]+)(M7|7|sus4|add9)?(?:\/(3|5|7))?$/;

export function parseChord(symbol) {
  const m = CHORD_RE.exec(symbol);
  if (!m) throw new Error(`unparsable chord: ${symbol}`);
  const [, flat, roman, quality = '', inv] = m;
  const rootDeg = ROMAN[roman.toUpperCase()];
  if (!rootDeg) throw new Error(`unknown roman: ${symbol}`);
  return {
    flat: flat === 'b',
    rootDeg,
    minor: roman !== roman.toUpperCase(),
    quality,
    inversion: inv ? Number(inv) : 0,
  };
}

function intervalsFor({ minor, quality }) {
  const third = minor ? 3 : 4;
  switch (quality) {
    case '': return [0, third, 7];
    case 'M7': return [0, third, 7, 11];
    case '7': return [0, third, 7, 10];
    case 'sus4': return [0, 5, 7];
    case 'add9': return [0, third, 7, 14];
    default: throw new Error(`unknown quality: ${quality}`);
  }
}

export function chordSemitones(symbol, mode) {
  const c = parseChord(symbol);
  const root = degToSemitone(c.rootDeg, mode) - (c.flat ? 1 : 0);
  return intervalsFor(c).map((i) => root + i);
}

export function chordPitchClasses(symbol, mode) {
  const pcs = chordSemitones(symbol, mode).map((s) => ((s % 12) + 12) % 12);
  return [...new Set(pcs)].sort((a, b) => a - b);
}

export function isChordTone(deg, mode, symbol) {
  const pc = ((degToSemitone(deg, mode) % 12) + 12) % 12;
  return chordPitchClasses(symbol, mode).includes(pc);
}

const INV_ROTATION = { 0: 0, 3: 1, 5: 2, 7: 3 };

// 転回形を反映し、最低音が [lowestMidi, lowestMidi+12) に入るよう移動する。
export function chordVoicing(symbol, mode, tonicMidi, lowestMidi = 48) {
  const c = parseChord(symbol);
  const semis = chordSemitones(symbol, mode);
  const rot = Math.min(INV_ROTATION[c.inversion] ?? 0, semis.length - 1);
  const rotated = semis.slice(rot).concat(semis.slice(0, rot).map((s) => s + 12));
  let shift = 0;
  const base = tonicMidi + rotated[0];
  while (base + shift < lowestMidi) shift += 12;
  while (base + shift >= lowestMidi + 12) shift -= 12;
  return rotated.map((s) => tonicMidi + s + shift);
}

export function bassMidi(symbol, mode, tonicMidi, lowestMidi = 36) {
  return chordVoicing(symbol, mode, tonicMidi, lowestMidi)[0];
}

// 断片の適合判定を事前計算するための語彙。progressions.json はこの範囲だけを使う。
export const CHORD_VOCAB = {
  major: [
    'I', 'IM7', 'I/3', 'I/5', 'ii', 'ii7', 'iii', 'iii7',
    'IV', 'IVM7', 'IV/3', 'iv', 'V', 'V7', 'V/3', 'Vsus4',
    'vi', 'vi7', 'bVI', 'bVII',
  ],
  minor: [
    'i', 'i7', 'i/3', 'i/5', 'isus4', 'III', 'IIIM7', 'iv',
    'iv7', 'iv/3', 'v', 'v7', 'V', 'V7', 'VI', 'VIM7',
    'VI/3', 'VII',
  ],
};

export function chordIndex(mode, symbol) {
  return CHORD_VOCAB[mode].indexOf(symbol);
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（rng 7件 + theory 11件）

- [ ] **Step 5: コミット**

```bash
git add src/theory.js test/theory.test.js
git commit -m "度数→MIDI変換とコード記号の解釈を追加"
```

---

### Task 3: 音楽理論 — 断片とコードの適合判定

**Files:**
- Modify: `src/theory.js`（末尾に追記）
- Modify: `test/theory.test.js`（末尾に追記）

**Interfaces:**
- Consumes: `isChordTone`
- Produces:
  - `splitBars(notes) => [Note[], Note[]]` — 2小節を小節ごとに分け、`beat` を小節内ローカル（0〜4）に直す
  - `fitsBar(barNotes, mode, chord) => boolean`
  - `hasSuspension(barNotes, mode, chord) => boolean`
  - `nearestChordToneDeg(chord, mode, aroundDeg) => number`
  - Note の形: `{deg: number, beat: number, dur: number, vel: number}`

- [ ] **Step 1: 失敗するテストを追記**

`test/theory.test.js` の末尾に追記（import 行にも追加する）:

```js
import { splitBars, fitsBar, hasSuspension, nearestChordToneDeg } from '../src/theory.js';

const N = (deg, beat, dur, vel = 0.7) => ({ deg, beat, dur, vel });

test('splitBars は2小節に分け、beatを小節内ローカルに直す', () => {
  const [a, b] = splitBars([N(1, 0, 2), N(3, 2, 2), N(5, 4, 2), N(8, 6, 2)]);
  assert.deepEqual(a.map((n) => [n.deg, n.beat]), [[1, 0], [3, 2]]);
  assert.deepEqual(b.map((n) => [n.deg, n.beat]), [[5, 0], [8, 2]]);
});

test('fitsBar: 強拍がコードトーンなら適合', () => {
  assert.equal(fitsBar([N(1, 0, 2), N(5, 2, 2)], 'major', 'I'), true);
});

test('fitsBar: 強拍の非和声音が解決しなければ不適合', () => {
  assert.equal(fitsBar([N(4, 0, 2), N(6, 2, 2)], 'major', 'I'), false);
});

test('fitsBar: 強拍の非和声音でも順次下降で解決すれば適合', () => {
  assert.equal(fitsBar([N(4, 0, 1), N(3, 1, 1), N(1, 2, 2)], 'major', 'I'), true);
});

test('fitsBar: コードトーンが1つもなければ不適合', () => {
  assert.equal(fitsBar([N(2, 0, 0.5), N(4, 0.5, 0.5), N(6, 1, 0.5), N(2, 1.5, 0.5)], 'major', 'I'), false);
});

test('fitsBar: 空の小節は常に適合', () => {
  assert.equal(fitsBar([], 'major', 'V7'), true);
});

test('hasSuspension: 小節頭の非和声音が順次下降で解決すれば真', () => {
  // Iの上で4度→3度（4-3の掛留）
  assert.equal(hasSuspension([N(4, 0, 1.5), N(3, 1.5, 2.5)], 'major', 'I'), true);
});

test('hasSuspension: 小節頭がコードトーンなら偽', () => {
  assert.equal(hasSuspension([N(3, 0, 1.5), N(2, 1.5, 2.5)], 'major', 'I'), false);
});

test('hasSuspension: 上行で解決するものは掛留とみなさない', () => {
  assert.equal(hasSuspension([N(4, 0, 1.5), N(5, 1.5, 2.5)], 'major', 'I'), false);
});

test('nearestChordToneDeg は指定度数に最も近いコードトーンを返す', () => {
  assert.equal(nearestChordToneDeg('I', 'major', 4), 3);
  assert.equal(nearestChordToneDeg('I', 'major', 6), 5);
  assert.ok(isChordTone(nearestChordToneDeg('V7', 'major', 9), 'major', 'V7'));
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL — `splitBars is not a function` 系のエラー

- [ ] **Step 3: `src/theory.js` に追記**

```js
// 2小節(8拍)の断片を小節ごとに分け、beat を小節内ローカル(0〜4)へ直す。
export function splitBars(notes) {
  return [
    notes.filter((n) => n.beat < 4).map((n) => ({ ...n })),
    notes.filter((n) => n.beat >= 4).map((n) => ({ ...n, beat: n.beat - 4 })),
  ];
}

// 強拍(0拍目・2拍目)または長い音(1.5拍以上)が非和声音なら、
// 次の音へ順次進行で解決していることを要求する。
export function fitsBar(barNotes, mode, chord) {
  if (barNotes.length === 0) return true;
  let anyChordTone = false;
  for (let i = 0; i < barNotes.length; i++) {
    const n = barNotes[i];
    const isTone = isChordTone(n.deg, mode, chord);
    if (isTone) anyChordTone = true;
    const exposed = n.beat % 2 === 0 || n.dur >= 1.5;
    if (exposed && !isTone) {
      const next = barNotes[i + 1];
      const resolves =
        next && Math.abs(next.deg - n.deg) <= 1 && isChordTone(next.deg, mode, chord);
      if (!resolves) return false;
    }
  }
  return anyChordTone;
}

// 小節頭の非和声音が順次下降でコードトーンへ解決する形（4-3、9-8）を検出する。
export function hasSuspension(barNotes, mode, chord) {
  for (let i = 0; i < barNotes.length - 1; i++) {
    const n = barNotes[i];
    if (n.beat !== 0) continue;
    if (isChordTone(n.deg, mode, chord)) continue;
    const next = barNotes[i + 1];
    if (next.deg === n.deg - 1 && isChordTone(next.deg, mode, chord)) return true;
  }
  return false;
}

export function nearestChordToneDeg(chord, mode, aroundDeg) {
  let best = aroundDeg;
  let bestDist = Infinity;
  for (let d = 1; d <= 15; d++) {
    if (!isChordTone(d, mode, chord)) continue;
    const dist = Math.abs(d - aroundDeg);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（theory 21件）

- [ ] **Step 5: コミット**

```bash
git add src/theory.js test/theory.test.js
git commit -m "断片とコードの適合判定・掛留検出を追加"
```

---

### Task 4: 調整可能パラメータの定義と曲コード

**Files:**
- Create: `src/settings.js`
- Test: `test/settings.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `PARAM_DEFS: ParamDef[]` — `{key, group, label, type, min?, max?, step?, options?, def, unit?, apply, code?}`
    - `group`: `'sound' | 'humanize' | 'compose'`
    - `type`: `'range' | 'toggle' | 'choice'`
    - `apply`: `'live' | 'next'`
    - `code`: 曲コードに含めるパラメータのみ持つ短縮キー
  - `GROUP_LABELS: Record<string, string>`
  - `coerce(def, raw) => value`
  - `normalizeSettings(obj) => Settings`
  - `defaultSettings() => Settings`
  - `encodeSongCode(seed: string, settings) => string`
  - `decodeSongCode(str) => {seed: string|null, settings: Settings}`
  - `composeParamKeys() => string[]` — 曲の内容に影響するキーの一覧

- [ ] **Step 1: 失敗するテストを書く**

`test/settings.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARAM_DEFS, GROUP_LABELS, coerce, normalizeSettings, defaultSettings,
  encodeSongCode, decodeSongCode, composeParamKeys,
} from '../src/settings.js';

test('全パラメータが必須項目を持つ', () => {
  for (const d of PARAM_DEFS) {
    assert.ok(d.key, 'key がない');
    assert.ok(d.label, `${d.key}: label がない`);
    assert.ok(['sound', 'humanize', 'compose'].includes(d.group), `${d.key}: group が不正`);
    assert.ok(['range', 'toggle', 'choice'].includes(d.type), `${d.key}: type が不正`);
    assert.ok(['live', 'next'].includes(d.apply), `${d.key}: apply が不正`);
    assert.ok(d.def !== undefined, `${d.key}: def がない`);
    assert.ok(GROUP_LABELS[d.group], `${d.group}: 表示名がない`);
    if (d.type === 'range') {
      assert.ok(typeof d.min === 'number' && typeof d.max === 'number', `${d.key}: min/max がない`);
      assert.ok(d.def >= d.min && d.def <= d.max, `${d.key}: 既定値が範囲外`);
    }
    if (d.type === 'choice') {
      assert.ok(Array.isArray(d.options) && d.options.length >= 2, `${d.key}: options が不足`);
      assert.ok(d.options.some(([v]) => v === d.def), `${d.key}: 既定値が選択肢にない`);
    }
  }
});

test('key が重複していない', () => {
  const keys = PARAM_DEFS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('code が重複していない', () => {
  const codes = PARAM_DEFS.filter((d) => d.code).map((d) => d.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(!codes.includes('s'), '"s" はシード用に予約');
});

test('coerce は範囲外の数値を丸める', () => {
  const def = { type: 'range', min: 0, max: 100, def: 50 };
  assert.equal(coerce(def, 150), 100);
  assert.equal(coerce(def, -5), 0);
  assert.equal(coerce(def, 'abc'), 50);
  assert.equal(coerce(def, '30'), 30);
});

test('coerce は選択肢外の値を既定値に戻す', () => {
  const def = { type: 'choice', options: [['a', 'A'], ['b', 'B']], def: 'a' };
  assert.equal(coerce(def, 'b'), 'b');
  assert.equal(coerce(def, 'z'), 'a');
});

test('coerce は toggle を真偽値にする', () => {
  const def = { type: 'toggle', def: true };
  assert.equal(coerce(def, '1'), true);
  assert.equal(coerce(def, 0), false);
  assert.equal(coerce(def, false), false);
});

test('normalizeSettings は欠けたキーを既定値で埋める', () => {
  const s = normalizeSettings({ masterVolume: 20 });
  assert.equal(s.masterVolume, 20);
  for (const d of PARAM_DEFS) assert.ok(s[d.key] !== undefined, `${d.key} が埋まっていない`);
});

test('normalizeSettings はテンポの上下限が逆なら入れ替える', () => {
  const s = normalizeSettings({ tempoMin: 80, tempoMax: 60 });
  assert.equal(s.tempoMin, 60);
  assert.equal(s.tempoMax, 80);
});

test('defaultSettings は定義どおりの既定値を返す', () => {
  const s = defaultSettings();
  for (const d of PARAM_DEFS) assert.equal(s[d.key], d.def, `${d.key} の既定値が違う`);
});

test('曲コードは往復する', () => {
  const s = normalizeSettings({ tempoMin: 58, tempoMax: 70, majorRatio: 30, motifRecall: false });
  const code = encodeSongCode('a3f91c', s);
  const back = decodeSongCode(code);
  assert.equal(back.seed, 'a3f91c');
  for (const key of composeParamKeys()) {
    assert.equal(back.settings[key], s[key], `${key} が往復しない`);
  }
});

test('曲コードは先頭の # を許容する', () => {
  const code = encodeSongCode('zzz', defaultSettings());
  assert.equal(decodeSongCode('#' + code).seed, 'zzz');
});

test('壊れた曲コードでも既定値で復帰する', () => {
  const r = decodeSongCode('ゴミ&&=&tn=abc');
  assert.equal(r.seed, null);
  assert.equal(r.settings.tempoMin, defaultSettings().tempoMin);
});

test('曲コードにサウンド系は含まれない', () => {
  const code = encodeSongCode('x', defaultSettings());
  for (const d of PARAM_DEFS.filter((p) => p.group === 'sound')) {
    assert.ok(!d.code, `${d.key}: サウンド系に code がある`);
  }
  assert.ok(!code.includes('masterVolume'));
});

test('composeParamKeys は作曲系のキーだけを返す', () => {
  const keys = composeParamKeys();
  assert.ok(keys.includes('tempoMin'));
  assert.ok(keys.includes('motifRecall'));
  assert.ok(!keys.includes('masterVolume'));
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/settings.js'`

- [ ] **Step 3: `src/settings.js` を実装**

```js
export const GROUP_LABELS = {
  sound: 'サウンド（すぐ反映）',
  humanize: '演奏（次の曲から）',
  compose: '作曲（次の曲から）',
};

const KEY_OPTIONS = [
  ['random', 'ランダム'],
  ['0', 'C'], ['1', 'C#'], ['2', 'D'], ['3', 'D#'], ['4', 'E'], ['5', 'F'],
  ['6', 'F#'], ['7', 'G'], ['8', 'G#'], ['9', 'A'], ['10', 'A#'], ['11', 'B'],
];

// 調整可能パラメータの唯一の定義。UIパネルはこの配列から自動生成される。
export const PARAM_DEFS = [
  // サウンド：ゲイン値の書き換えだけなので即座に反映する
  { key: 'masterVolume', group: 'sound', label: '全体音量', type: 'range', min: 0, max: 100, step: 1, def: 70, unit: '%', apply: 'live' },
  { key: 'melodyVolume', group: 'sound', label: 'メロディー音量', type: 'range', min: 0, max: 100, step: 1, def: 100, unit: '%', apply: 'live' },
  { key: 'accompVolume', group: 'sound', label: '伴奏音量', type: 'range', min: 0, max: 100, step: 1, def: 45, unit: '%', apply: 'live' },
  { key: 'padVolume', group: 'sound', label: 'パッド音量', type: 'range', min: 0, max: 100, step: 1, def: 35, unit: '%', apply: 'live' },
  { key: 'reverbAmount', group: 'sound', label: 'リバーブ量', type: 'range', min: 0, max: 100, step: 1, def: 45, unit: '%', apply: 'live' },
  { key: 'brightness', group: 'sound', label: '音色の明るさ', type: 'range', min: 0, max: 100, step: 1, def: 50, unit: '%', apply: 'live' },

  // 演奏：曲の組み立て時に適用済みなので次の曲から
  { key: 'timingJitterMs', group: 'humanize', label: 'タイミングの揺らぎ', type: 'range', min: 0, max: 30, step: 1, def: 10, unit: 'ms', apply: 'next' },
  { key: 'velocityJitter', group: 'humanize', label: 'ベロシティの揺らぎ', type: 'range', min: 0, max: 25, step: 1, def: 8, unit: '%', apply: 'next' },
  { key: 'tenuto', group: 'humanize', label: '頂点音のテヌート', type: 'toggle', def: true, apply: 'next' },
  { key: 'ritardando', group: 'humanize', label: '終盤のリタルダンド', type: 'toggle', def: true, apply: 'next' },
  { key: 'gapSeconds', group: 'humanize', label: '曲間の余韻', type: 'range', min: 0, max: 10, step: 0.5, def: 3.5, unit: '秒', apply: 'live' },

  // 作曲：曲コードに含める
  { key: 'tempoMin', group: 'compose', label: 'テンポ下限', type: 'range', min: 52, max: 92, step: 1, def: 64, unit: 'BPM', apply: 'next', code: 'tn' },
  { key: 'tempoMax', group: 'compose', label: 'テンポ上限', type: 'range', min: 52, max: 92, step: 1, def: 76, unit: 'BPM', apply: 'next', code: 'tx' },
  { key: 'musicKey', group: 'compose', label: 'キー', type: 'choice', options: KEY_OPTIONS, def: 'random', apply: 'next', code: 'k' },
  { key: 'majorRatio', group: 'compose', label: '長調の比率', type: 'range', min: 0, max: 100, step: 5, def: 55, unit: '%', apply: 'next', code: 'mj' },
  { key: 'songBars', group: 'compose', label: '曲の長さ', type: 'choice', options: [['16', '16小節'], ['32', '32小節'], ['64', '64小節']], def: '32', apply: 'next', code: 'b' },
  { key: 'curveStrength', group: 'compose', label: '起伏カーブの強さ', type: 'range', min: 0, max: 100, step: 5, def: 100, unit: '%', apply: 'next', code: 'cv' },
  { key: 'maxLeap', group: 'compose', label: '接続の跳躍許容度', type: 'range', min: 2, max: 6, step: 1, def: 2, unit: '度', apply: 'next', code: 'lp' },
  { key: 'motifRecall', group: 'compose', label: 'モチーフ再登場', type: 'toggle', def: true, apply: 'next', code: 'mr' },
];

export function coerce(def, raw) {
  if (def.type === 'toggle') {
    return raw === true || raw === 1 || raw === '1' || raw === 'true';
  }
  if (def.type === 'choice') {
    const v = String(raw);
    return def.options.some(([o]) => o === v) ? v : def.def;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return def.def;
  return Math.min(def.max, Math.max(def.min, n));
}

export function normalizeSettings(obj) {
  const src = obj ?? {};
  const out = {};
  for (const d of PARAM_DEFS) {
    out[d.key] = d.key in src ? coerce(d, src[d.key]) : d.def;
  }
  if (out.tempoMax < out.tempoMin) {
    [out.tempoMin, out.tempoMax] = [out.tempoMax, out.tempoMin];
  }
  return out;
}

export function defaultSettings() {
  return normalizeSettings({});
}

export function composeParamKeys() {
  return PARAM_DEFS.filter((d) => d.code).map((d) => d.key);
}

export function encodeSongCode(seed, settings) {
  const parts = [`s=${seed}`];
  for (const d of PARAM_DEFS) {
    if (!d.code) continue;
    const v = settings[d.key];
    parts.push(`${d.code}=${d.type === 'toggle' ? (v ? 1 : 0) : v}`);
  }
  return parts.join('&');
}

export function decodeSongCode(str) {
  const map = new Map();
  for (const kv of String(str ?? '').replace(/^#/, '').split('&')) {
    const i = kv.indexOf('=');
    if (i <= 0) continue;
    map.set(kv.slice(0, i), kv.slice(i + 1));
  }
  const raw = {};
  for (const d of PARAM_DEFS) {
    if (d.code && map.has(d.code)) raw[d.key] = map.get(d.code);
  }
  const seed = map.get('s');
  return {
    seed: seed && /^[0-9a-z]+$/i.test(seed) ? seed : null,
    settings: normalizeSettings(raw),
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（settings 14件）

- [ ] **Step 5: コミット**

```bash
git add src/settings.js test/settings.test.js
git commit -m "調整可能パラメータの定義と曲コードの符号化を追加"
```

---

## Task 5 以降について

Task 1〜4 は逐次実行した。以降は**依存関係の許す限り並列に実行**したため、
1タスク＝1スレッドの単位で契約（インターフェース）を固定し、
各スレッドが自分の担当ファイルとテストだけを書く方式に切り替えている。

各スレッドは以下を厳守した:

- 担当ファイル以外に触れない（同時編集の衝突を避けるため）
- git コマンドを実行しない（コミットは統合側でまとめて行う）
- 実装だけでなく**テストを実際に実行し、その出力を報告する**

---

### Task 5: 断片の分析と美しさスコア

**Files:** `tools/analyze.js`, `tools/score.js`, `test/score.test.js`

**Produces:**
- `analyzeFragment(notes) => {startDeg, endDeg, range, span, peakDeg, peakBeat, peakCount, density, intervals, contour, tags, tension}`
- `detectContour(degs) => 'arch'|'descend'|'ascend'|'wave'|'question'|'answer'`
- `detectTags(notes, base) => string[]` — `sigh` / `single-peak` / `long-ending` / `resolve-down` / `stepwise` / `inner-motif`
- `tensionOf(base) => 1..5`
- `scoreFragment(notes, meta) => number`

スコアは基準50から、跳躍の連続・同音連打・広すぎる音域・過密を減点し、
掛留の解決・ため息型の跳躍下降・内部モチーフ・ロングトーン終止・単一の頂点を加点する。
**減点法だけでは「上手いが泣けない」断片が上位に来る**ため、加点法との両輪が必須。

**検証:** 24件パス。良い断片77.0点 / 悪い断片 −130.0点と明確に分離。

---

### Task 6: 候補断片の生成

**Files:** `tools/generate.js`, `test/generate.test.js`

**Produces:** `RHYTHMS`, `CONTOUR_SHAPE`, `buildDegrees(rng, contour, n, opts)`, `generateCandidate(rng)`

リズム型18種（うち10種は後半1小節が前半と同形＝内部モチーフ）、輪郭6種を線形補間して
度数を埋め、跳躍の連続を後処理で潰す。確率0.35で「掛留の種」（先頭音を次の音の1つ上に）を仕込む。

**検証:** 15件パス。5万件サンプリングで掛留の種39.6%、連続跳躍違反0件、輪郭分布ほぼ均等。

---

### Task 7: コード進行99件の生成

**Files:** `tools/makeProgressions.js`, `src/data/progressions.json`, `test/progressions.test.js`

定石カタログ26種（カノン進行・サブドミナントマイナー・偽終止・借用和音・王道進行）に
転回形／テンション付加／代理コード／SDM差し替え／偽終止化の変形を適用して展開。

**検証:** 10件パス。99件（メジャー55／マイナー44）、SDM含み18件、偽終止6件、再実行でバイト一致。

---

### Task 8: メロディー断片999件の生成

**Files:** `tools/makeMelodies.js`, `src/data/melodies.json`, `test/melodies.test.js`

候補6万件を生成 → 分析 → 採点 → `輪郭6 × 緊張度5 × 終止クラス2 = 60バケット`の層化抽出で999件。
`fit` / `sus` は `CHORD_VOCAB` の全コードに対し `fitsBar` / `hasSuspension` を総当たりして
**添字の配列**として焼き込む（ランタイムでの再計算を避けるため）。

**単純なスコア上位999件にしてはならない。** 似た優等生ばかりが並んで飽きるうえ、
組み立て側のフィルタが候補切れを起こす。

---

### Task 9: 曲の組み立て

**Files:** `src/compose.js`, `test/compose.test.js`

**Produces:** `composeSong(seed, data, settings) => Song`, `climaxSlot`, `curveFor`, `varyProgression`, `passesFilters`, `selectFragment`

A-A'-B-A'' 構成。進行は2つだけ引き（`P1` をA系、`P2` をB）、A'/A'' は `P1` の変形を使う。
断片選択は コード適合 → 接続の滑らかさ → 起伏カーブ の3フィルタを 3→2→1 と緩めながら通し、
候補0件ならコードトーンのロングトーンにフォールバックする（**無音の小節を作らない**）。

`maxPeak` を非クライマックスで11に抑え、クライマックスで12以上を要求することで
**曲中の最高音がただ一度だけ鳴る**ことを構造的に保証する。

---

### Task 10: 演奏の揺らぎ

**Files:** `src/perform.js`, `test/perform.test.js`

**Produces:** `buildPerformance(song, settings) => {events, durationSec}`

タイミング±揺らぎ、ベロシティ揺らぎ、頂点音のテヌート（30ms遅らせ1.15倍に伸ばす）、
終盤のリタルダンド。乱数は `seedFromString(song.seed + ':perf')` の1本のみを
melody → accomp → bass → pad の固定順で消費する（順序が変わると曲コードの再現性が壊れる）。

**検証:** 14件パス。13種の変異注入テストで全て検出されることを確認済み。

---

### Task 11: Web Audio 音源

**Files:** `src/synth.js`

**Produces:** `createEngine(audioCtx, settings) => {playPiano, playPad, applySettings, dispose}`

ピアノは基音＋2/3/4倍音の加算合成で倍音ほど速く減衰。3レイヤー（melody / accomp / bass）と
パッド、手続き生成した3.5秒のインパルス応答によるリバーブ、ソフトリミッタ。
`applySettings` はノードを作り直さずゲイン値だけ書き換える。

---

### Task 12: 設定パネルUIとページ

**Files:** `index.html`, `src/ui.js`

**Produces:** `loadStoredSettings()`, `storeSettings(s)`, `createSettingsPanel(root, {settings, onChange, onRebuild})`

パネルは `PARAM_DEFS` から自動生成する。**個別パラメータをHTMLに直書きしない。**
`apply: 'next'` の項目を変えたら「次の曲から反映されます」通知と「今すぐ作り直す」ボタンを出す。

---

### Task 13: 再生スケジューラとアプリ配線

**Files:** `src/player.js`, `src/main.js`

**Produces:** `createPlayer(audioCtx, engine, data, getSettings) => Player`

25ms間隔のタイマーで250ms先までを `audioCtx.currentTime` 基準の絶対時刻で予約する先読み方式。
曲を終端まで予約し余韻を置いたら、新しいシードで次の曲を生成して連結する（無限に続く）。
`AudioContext` は最初の再生クリックで初めて生成する（ブラウザの自動再生制限のため）。

---

### Task 14: 統合と耳での調整

**Files:** 全体

`npm start` で実際に鳴らし、音量バランス・リバーブ量・音色の明るさ・テンポを**耳で**調整する。
これらはすべて画面のコントロールから変更できるため、コードの再編集は不要。

音楽的に確認すること:

- クライマックスが曲中に一度だけ、明確に聴こえるか
- A' / A'' で冒頭の旋律が帰ってくるのが分かるか
- 断片の切れ目で音が飛んで聴こえないか
- サブドミナントマイナーの陰りが効いているか
- 曲間の余韻が短すぎ／長すぎないか
