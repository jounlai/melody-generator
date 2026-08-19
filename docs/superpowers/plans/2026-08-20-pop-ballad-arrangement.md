# 70〜80年代ポップバラード編曲層 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成される曲に「伴奏型の変化」「食い」「タイ」を入れ、旋律の音程は1音も変えずにリズムだけを70〜80年代ポップバラードのものにする。

**Architecture:** `src/arrange.js` を新設し、`composeSong` を5段（旋律 → 仕上げ → 食い/タイ → 声部配置 → 編曲）に組み直す。責務は「どの音を鳴らすか＝`compose.js`」「いつ鳴らすか＝`arrange.js`」で分ける。編曲は `seed + ':arr'` の独立した乱数列を使い、作曲側の乱数消費順には一切触れない。

**Tech Stack:** 素の ES モジュール（ビルドなし）、`node:test` + `node:assert/strict`、依存パッケージゼロ。

**Spec:** [docs/superpowers/specs/2026-08-20-pop-ballad-arrangement-design.md](../specs/2026-08-20-pop-ballad-arrangement-design.md)

## Global Constraints

以下は全タスクの要件に暗黙に含まれる。

- **乱数**: `Math.random()` を使ってよいのは `synth.js` と `player.js` のシード生成だけ。編曲は `makeRng(seedFromString(String(song.seed) + ':arr'))` の1本だけを使う
- **作曲側の乱数消費順を変えない**: `composeSong` の段1（セクションループ）の `rng` 呼び出しの順序と回数は現行と完全に同一に保つ。現行の小節ループは乱数を1つも消費しないので、これは移動しても守られる
- **旋律の midi の並びは不変**: 同じシード・同じ設定で、`song.melody.map(n => n.midi)` が案1の前後で完全一致すること。Task 1 の回帰テストがこれを機械で守る
- **`CHORD_VOCAB` の順序を触らない**（断片の適合情報が添字で保存されている）
- **新しい設定パラメータを追加しない**（曲コードの形式が変わるため）
- **`src/data/*.json` を触らない**（案2で作り直す）
- **声部は melody / accomp / bass / pad の4つのまま**。打楽器を足さない
- **範囲外**: 3連・12/8、16分刻みの伴奏、同音連打、音域カーブ（`curveFor`）、テンポ
- **`melody-generator.html` は生成物**。手で編集せず `npm run bundle` で作り直す

### テストの走らせ方

`npm test` は全485件で約4分半かかる。開発中は次を使う。

```bash
node --test test/arrange.test.js                                  # 新規。1秒未満
node --test --test-name-pattern="式" test/compose.test.js          # 1件だけ。約1.3秒
node --test test/compose.test.js                                  # compose 全部。数分
```

タスクの完了時にはそのタスクが触ったファイルのテストを全部通し、**Task 2 / 4 / 6 / 7 / 8 の完了時は `npm test` を全件通す**。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `src/arrange.js`（新規） | 「いつ鳴らすか」。伴奏型・ベース型の語彙と展開、食い、タイ |
| `src/compose.js`（変更） | 「どの音を鳴らすか」。段の組み直しと、伴奏生成の切り出し |
| `tools/snapshot.js`（新規） | 旋律スナップショットの生成。回帰の基準線を作る |
| `tools/monotony.js`（新規） | 単調さの5指標を実測する。仕様書8.1の検証に使う |
| `test/data/melody-snapshot.json`（新規） | 20シード×3長さの旋律 midi 列 |
| `test/seedcompat.test.js`（新規） | 旋律の midi 列が不変であることを守る |
| `test/arrange.test.js`（新規） | 型の展開・食い・タイの単体検査 |
| `test/compose.test.js`（変更） | 「8分が8個」という古い不変条件を書き換える |
| `algorithm.html` / `.en.html` / `.zh.html`（変更） | 解説に編曲層の節を足す |

---

## Task 1: 回帰の安全網（旋律スナップショット）

以降のすべてのタスクが「旋律の音程を変えていない」ことをこのテストで示す。**必ず何も変更していない状態で作る。**

**Files:**
- Create: `tools/snapshot.js`
- Create: `test/data/melody-snapshot.json`（`tools/snapshot.js` の生成物）
- Create: `test/seedcompat.test.js`

**Interfaces:**
- Consumes: `composeSong(seed, data, settings)` from `src/compose.js`、`defaultSettings()` from `src/settings.js`
- Produces: `test/data/melody-snapshot.json` — 形は `{ "<seed>|<bars>": "60,62,64,..." }`。以降のタスクはこのファイルを**書き換えない**

- [ ] **Step 1: スナップショット生成器を書く**

```js
// tools/snapshot.js
#!/usr/bin/env node
// 旋律の midi 列のスナップショットを作る。
//
// 編曲層(arrange.js)は「いつ鳴らすか」だけを変え、「どの音を鳴らすか」には
// 触らない。その保証を機械で守るための基準線がこのファイル。
// 一度作ったら書き換えない。書き換えたくなったときは、旋律が変わっている。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeSong } from '../src/compose.js';
import { defaultSettings } from '../src/settings.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../test/data/melody-snapshot.json');

export const SNAPSHOT_SEEDS = Array.from({ length: 20 }, (_, i) => `snap-${i}`);
export const SNAPSHOT_BARS = ['16', '32', '64'];

export function loadData() {
  const dir = resolve(HERE, '../src/data');
  return {
    melodies: JSON.parse(readFileSync(resolve(dir, 'melodies.json'), 'utf8')),
    progressions: JSON.parse(readFileSync(resolve(dir, 'progressions.json'), 'utf8')),
  };
}

/** 1曲の旋律を「拍の早い順に並べた midi の列」にする。拍と音価はわざと見ない。 */
export function melodyKey(song) {
  return song.melody
    .slice()
    .sort((a, b) => a.beat - b.beat || a.midi - b.midi)
    .map((n) => n.midi)
    .join(',');
}

export function buildSnapshot(data) {
  const out = {};
  for (const seed of SNAPSHOT_SEEDS) {
    for (const songBars of SNAPSHOT_BARS) {
      const song = composeSong(seed, data, { ...defaultSettings(), songBars });
      out[`${seed}|${songBars}`] = melodyKey(song);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snapshot = buildSnapshot(loadData());
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 0)}\n`);
  console.log(`${Object.keys(snapshot).length} 曲を ${OUT} へ書き出した`);
}
```

- [ ] **Step 2: スナップショットを生成する**

Run: `node tools/snapshot.js`
Expected: `60 曲を .../test/data/melody-snapshot.json へ書き出した`

- [ ] **Step 3: 回帰テストを書く**

```js
// test/seedcompat.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSnapshot, loadData } from '../tools/snapshot.js';

// 編曲層は「いつ鳴らすか」だけを変える。「どの音を鳴らすか」が動いたら、
// 同じ曲コードから別の旋律が出るということで、共有済みのURLが壊れる。
const snapshotPath = new URL('./data/melody-snapshot.json', import.meta.url);
const has = fs.existsSync(snapshotPath) && fs.existsSync(new URL('../src/data/melodies.json', import.meta.url));
const opts = { skip: has ? false : 'スナップショットまたは src/data/*.json が無い' };

test('旋律の midi の並びがスナップショットと完全に一致する', opts, () => {
  const want = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const got = buildSnapshot(loadData());
  const keys = Object.keys(want);
  assert.ok(keys.length >= 60, `スナップショットが少ない: ${keys.length}`);
  for (const key of keys) {
    assert.equal(got[key], want[key], `${key}: 旋律の音程が変わった`);
  }
  assert.deepEqual(Object.keys(got).sort(), keys.sort(), '曲の集合が変わった');
});
```

- [ ] **Step 4: テストを走らせて通ることを確認する**

Run: `node --test test/seedcompat.test.js`
Expected: PASS（この時点では何も変えていないので必ず通る。通らなければ `composeSong` が非決定的ということで、その調査が先）

- [ ] **Step 5: コミット**

```bash
git add tools/snapshot.js test/data/melody-snapshot.json test/seedcompat.test.js
git commit -m "旋律の midi 列のスナップショットを回帰の基準線として置く

編曲層は「いつ鳴らすか」だけを変える。「どの音を鳴らすか」が動いていないことを
20シード×3長さの60曲で機械的に守る。"
```

---

## Task 2: composeSong を5段に組み直す

振る舞いを変えないリファクタ。段の順序を入れ替えるだけで、まだ伴奏型も食いも入れない。

**Files:**
- Modify: `src/compose.js:1407-1706`（セクションループと小節ループ）

**Interfaces:**
- Consumes: Task 1 の `test/seedcompat.test.js`
- Produces: `composeSong` 内部に `barInfo` 配列（`{ bar, symbol, tonicMidi, rootMidi, voicing, padVoicing, bassNote, pcs }`）。Task 3 以降の `arrangeSong` はこれを受け取る

- [ ] **Step 1: 基準線が緑であることを確認する**

Run: `node --test test/seedcompat.test.js`
Expected: PASS

- [ ] **Step 2: セクションループから小節ループを抜き出す**

現行はセクションごとに「スロットループ（旋律）→ 小節ループ（和音の配置と伴奏）」が回っている。
これを **曲全体で段に分ける**。セクションループは和音の割り当てと旋律だけを作り、
小節ループはループの外に1本置く。

セクションループの中でやることを、こう変える。

```js
    // 【変更前】この位置に小節ループがあり、bass/accomp/pad を push していた。
    // 【変更後】和音の割り当てだけを記録して、配置と発音はループの外でやる。
    for (let b = 0; b < barChords.length; b++) {
      chordPlan[startBar + b] = { bar: startBar + b, symbol: barChords[b] };
    }
```

`chordPlan` は `sections` と同じく `for (let s = 0; ...)` の前で `const chordPlan = [];` として宣言する。
`prevBass` / `prevAccomp` の宣言も、使う場所（新しい小節ループ）の直前へ移す。

- [ ] **Step 3: 声部配置の段を、息継ぎ・最終音の処理より後ろに置く**

`composeSong` の段の順序を次にする。現行の「息継ぎ」「climaxBeat」「RELEASE」「最後の1音」の
ブロックはそのままの順序で、その**後ろ**に声部配置の小節ループを置く。

```js
  // ---- 段2: 息継ぎ・クライマックス・脱力・最終音（現行のブロックをそのまま） ----
  // （breathBar の決定、climaxBeat の算出、RELEASE_FLOOR の適用、最後の1音の書き換え）

  // ---- 段4: 声部配置 ----
  //
  // ここを段2より後ろに置くのが要。現行は息継ぎを適用する「前」の旋律で天井
  // (melodyCeiling) を計算していたので、息継ぎの小節だけ、鳴っていない旋律を
  // 避けて伴奏が不必要に低く抑えられていた。
  const barInfo = [];
  let prevBass = null;
  let prevAccomp = null;
  for (let bar = 0; bar < bars; bar++) {
    const chord = chordPlan[bar]?.symbol;
    if (!chord) continue;
    const barTonic = tonicAtBar(bar);
    const bassRaw = bassMidi(chord, mode, barTonic, BASS_LOWEST);
    const bassNote = nearestOctave(bassRaw, prevBass, BASS_RANGE);
    prevBass = bassNote;

    const rootMidi = barTonic + chordSemitones(chord, mode)[0];
    const ceiling = melodyCeiling(melody, bar);

    const raw = chordVoicing(chord, mode, barTonic, ACCOMP_LOWEST);
    const accompLo = Math.max(ACCOMP_RANGE[0], bassNote + 1);
    const accompFloor = Math.min(accompLo, bassNote);
    const voicing = placeUnder(raw, prevAccomp, accompLo, ACCOMP_RANGE[1], ceiling, accompFloor);
    prevAccomp = voicing[0];

    const padVoicing = withoutRub(
      placeUnder(chordVoicing(chord, mode, barTonic, PAD_LOWEST),
        null, voicing[0], ACCOMP_RANGE[1], ceiling, voicing[0]),
      melody, bar);

    barInfo[bar] = {
      bar,
      symbol: chord,
      tonicMidi: barTonic,
      rootMidi,
      voicing,
      padVoicing,
      bassNote,
      // ベースの5度が和音の音かどうかを編曲側が判定するために、実音の
      // ピッチクラスを持たせる。転回形では最低音の5度上が和音の音とは限らない。
      pcs: chordPitchClasses(chord, mode).map((pc) => (pc + barTonic) % 12),
    };
  }

  // ---- 段5: 発音（この時点ではまだ現行と同じ8分アルペジオ。Task 3〜5 で型にする） ----
  const accomp = [];
  const bass = [];
  const pad = [];
  for (let bar = 0; bar < bars; bar++) {
    const info = barInfo[bar];
    if (!info) continue;
    const beat = bar * 4;
    const isFinalBar = bar === bars - 1;
    bass.push({ midi: info.bassNote, beat, dur: 4, vel: BASS_VEL });
    pad.push({ midis: info.padVoicing, beat, dur: isFinalBar ? FINAL_PAD_DUR : 4, vel: PAD_VEL });
    if (isFinalBar) {
      accomp.push({
        midi: info.voicing[0], midis: info.voicing.slice(), beat, dur: 4, vel: FINAL_ACCOMP_VEL,
      });
      continue;
    }
    for (let i = 0; i < ACCOMP_OFFSETS.length; i++) {
      const at = ACCOMP_OFFSETS[i];
      accomp.push({
        midi: info.voicing[arpeggioIndex(i, info.voicing.length)],
        beat: beat + at,
        dur: Math.min(ACCOMP_DUR, BEATS_PER_BAR - at),
        vel: ACCOMP_VEL,
      });
    }
  }

  const chords = describeChords(barInfo);
```

`chordPitchClasses` を `./theory.js` の import に足す。`melody` / `accomp` / `bass` / `pad` /
`barInfo` の `const` 宣言の位置も、この順序に合わせて動かす。

- [ ] **Step 4: 旋律が動いていないことを確認する**

Run: `node --test test/seedcompat.test.js`
Expected: PASS

- [ ] **Step 5: 既存テストを全件通す**

Run: `npm test`
Expected: `# fail 0`

息継ぎの小節で伴奏・パッドの音高が変わる可能性がある（Step 3 のコメントのとおり、
これは意図した修正）。もし音高を主張しているテストが落ちたら、**落ちた小節が
`song.breathBar` の小節かどうかを確かめる**。そうならテスト側の期待値を直す。
そうでないなら段の組み直しにバグがある。

- [ ] **Step 6: コミット**

```bash
git add src/compose.js
git commit -m "composeSong を5段に組み直す

セクションごとの「スロットループ→小節ループ」を、曲全体の段に分ける。
声部配置を息継ぎの適用より後ろへ動かしたので、息継ぎの小節で伴奏が
鳴っていない旋律を避けて不必要に低く抑えられていた問題も直る。

振る舞いは旋律・和声とも不変。伴奏の型はまだ入れていない。"
```

---

## Task 3: `arrange.js` を新設し、型の展開器を書く

**Files:**
- Create: `src/arrange.js`
- Create: `test/arrange.test.js`
- Modify: `src/compose.js`（`arpeggioIndex` の再エクスポート）

**Interfaces:**
- Produces:
  - `expandAccomp(steps, voicing, barBeat, vel) -> Array<{midi, midis?, beat, dur, vel}>`
  - `expandBass(steps, barBeat, bassNote, nextBassNote, pcs, vel, range) -> Array<{midi, beat, dur, vel}>`
  - `arpeggioIndex(i, voices) -> number`（`compose.js` から移設）
  - `BEATS_PER_BAR = 4`

- [ ] **Step 1: 失敗するテストを書く**

```js
// test/arrange.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { expandAccomp, expandBass, arpeggioIndex } from '../src/arrange.js';

const VOICING = [48, 52, 55];  // C3 E3 G3

test('expandAccomp: low は最低音、upper は最低音より上を和音で鳴らす', () => {
  const steps = [{ beat: 0, voice: 'low', dur: 1 }, { beat: 1, voice: 'upper', dur: 1 }];
  const out = expandAccomp(steps, VOICING, 8, 0.3);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { midi: 48, beat: 8, dur: 1, vel: 0.3 });
  assert.equal(out[1].beat, 9);
  assert.deepEqual(out[1].midis, [52, 55]);
  assert.equal(out[1].midi, 52, '再生系が単音しか読まないときの代表音が要る');
});

test('expandAccomp: all は全構成音を和音で鳴らす', () => {
  const out = expandAccomp([{ beat: 0, voice: 'all', dur: 4 }], VOICING, 0, 0.22);
  assert.deepEqual(out[0].midis, [48, 52, 55]);
});

test('expandAccomp: arp は三角波で構成音を巡回する', () => {
  const steps = Array.from({ length: 8 }, (_, i) => ({ beat: i * 0.5, voice: 'arp', dur: 0.75 }));
  const out = expandAccomp(steps, VOICING, 0, 0.3);
  assert.deepEqual(out.map((n) => n.midi), [48, 52, 55, 52, 48, 52, 55, 52]);
});

test('expandAccomp: 小節線をはみ出す音価は小節の終わりで切る', () => {
  // 和音が変わったところへ古い和音が残ると、強拍で半音がぶつかる。
  const out = expandAccomp([{ beat: 3.5, voice: 'low', dur: 0.75 }], VOICING, 0, 0.3);
  assert.equal(out[0].dur, 0.5);
});

test('expandAccomp: voicing が2音でも upper が消えない', () => {
  const out = expandAccomp([{ beat: 0, voice: 'upper', dur: 1 }], [48, 55], 0, 0.3);
  assert.deepEqual(out[0].midis, [55]);
});

test('expandBass: fifth は和音に無ければオクターブ上へ逃がす', () => {
  // C の和音（pc 0,4,7）で最低音 C2=36 なら、5度上 G2=43 は和音の音。
  assert.equal(expandBass([{ beat: 0, kind: 'fifth', dur: 2 }], 0, 36, null, [0, 4, 7], 0.5, [28, 55])[0].midi, 43);
  // 第1転回形で最低音が E2=40 なら、5度上 B2=47 は和音の音ではない。
  // 半音単位で押し込むと別の和音になるので、オクターブ上へ逃がす。
  assert.equal(expandBass([{ beat: 0, kind: 'fifth', dur: 2 }], 0, 40, null, [0, 4, 7], 0.5, [28, 55])[0].midi, 52);
});

test('expandBass: next は次の小節の根音を先取りする。次が無ければ鳴らさない', () => {
  const steps = [{ beat: 0, kind: 'root', dur: 3.5 }, { beat: 3.5, kind: 'next', dur: 0.5 }];
  const withNext = expandBass(steps, 0, 36, 41, [0, 4, 7], 0.5, [28, 55]);
  assert.equal(withNext.length, 2);
  assert.deepEqual([withNext[1].midi, withNext[1].beat], [41, 3.5]);
  const noNext = expandBass(steps, 0, 36, null, [0, 4, 7], 0.5, [28, 55]);
  assert.equal(noNext.length, 1, '次の小節が無いのに先取りしている');
});

test('expandBass: octave が音域の上限を越えるなら元の音のまま', () => {
  const out = expandBass([{ beat: 0, kind: 'octave', dur: 2 }], 0, 50, null, [0, 4, 7], 0.5, [28, 55]);
  assert.equal(out[0].midi, 50);
});

test('arpeggioIndex: 上行して下行する波で構成音を巡回する', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => arpeggioIndex(i, 3)), [0, 1, 2, 1, 0, 1, 2, 1]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => arpeggioIndex(i, 4)), [0, 1, 2, 3, 2, 1, 0, 1]);
  assert.equal(arpeggioIndex(3, 1), 0);
});
```

- [ ] **Step 2: テストを走らせて落ちることを確認する**

Run: `node --test test/arrange.test.js`
Expected: FAIL（`Cannot find module '../src/arrange.js'`）

- [ ] **Step 3: `src/arrange.js` を書く**

```js
// src/arrange.js
//
// 曲を「どう鳴らすか」を決める層。compose.js が決めるのは音高（どの音を鳴らすか）で、
// ここが決めるのは時間（いつ鳴らすか）。この境界を跨がないこと。
//
// 初版はここが無く、伴奏は全曲・全小節が同じ8分アルペジオだった。実測すると
// 32小節の曲でリズムの変化が1つも無く、旋律がどれだけ良くても「同じことを
// 繰り返している」としか聴こえない。70〜80年代のバラードは、Aメロを薄く置いて
// サビで一気に厚くする。その落差そのものが感情を作る。
//
// 乱数は composeSong の rng とは別の列（seed + ':arr'）を使う。編曲を足し引きしても
// 旋律と和声が動かないので、同じ曲コードから同じ曲が出続ける。
const BEATS_PER_BAR = 4;

export { BEATS_PER_BAR };

/**
 * 分散和音の何番目の構成音を鳴らすか。上行して下行する三角波で巡回する。
 * 構成音3つなら 0,1,2,1,0,1,2,1、4つなら 0,1,2,3,2,1,0,1。
 * 単純な i % v の繰り返しは折り返しが無く、機械的に聴こえる。
 */
export function arpeggioIndex(i, voices) {
  if (voices <= 1) return 0;
  const period = 2 * (voices - 1);
  const t = ((i % period) + period) % period;
  return t < voices ? t : period - t;
}

/**
 * 伴奏型を実際の音に展開する。
 *
 * voicing は placeUnder が返した昇順の実音で、長さは2〜4で変動する。だから型は
 * 添字ではなく役割（low / upper / all / arp）で書く。添字で書くと、和音を天井の
 * 下へ収めるために上の音を省いた小節で型が壊れる。
 *
 * @param {Array<{beat:number, voice:'low'|'upper'|'all'|'arp', dur:number}>} steps
 * @param {number[]} voicing 昇順の実音
 * @param {number} barBeat その小節の先頭の拍（曲頭からの通し）
 * @param {number} vel
 */
export function expandAccomp(steps, voicing, barBeat, vel) {
  const out = [];
  if (!Array.isArray(voicing) || voicing.length === 0) return out;
  let arp = 0;
  for (const step of steps) {
    // 小節線で切る。隣と重ねてペダルのように繋ぐための長さでも、小節をはみ出すと
    // 和音が変わったところへ古い和音が残る（強拍の半音衝突の27%がここから出ていた）。
    const dur = Math.min(step.dur, BEATS_PER_BAR - step.beat);
    if (!(dur > 0)) continue;
    const beat = barBeat + step.beat;
    if (step.voice === 'arp') {
      out.push({ midi: voicing[arpeggioIndex(arp, voicing.length)], beat, dur, vel });
      arp += 1;
      continue;
    }
    if (step.voice === 'low') {
      out.push({ midi: voicing[0], beat, dur, vel });
      continue;
    }
    const midis = step.voice === 'all' ? voicing.slice() : voicing.slice(1);
    if (midis.length === 0) continue;
    // midi は単音しか読まない再生系のための代表音。鳴らしたい全部は midis に入れる。
    out.push({ midi: midis[0], midis, beat, dur, vel });
  }
  return out;
}

/** 5度。和音の音でなければオクターブ上へ逃がす（半音で押し込むと別の和音になる）。 */
function fifthOf(bassNote, pcs, range) {
  const fifth = bassNote + 7;
  const pc = ((fifth % 12) + 12) % 12;
  if (fifth <= range[1] && Array.isArray(pcs) && pcs.includes(pc)) return fifth;
  return octaveOf(bassNote, range);
}

function octaveOf(bassNote, range) {
  const up = bassNote + 12;
  return up <= range[1] ? up : bassNote;
}

/**
 * ベース型を実際の音に展開する。
 *
 * @param {Array<{beat:number, kind:'root'|'fifth'|'octave'|'next', dur:number}>} steps
 * @param {number} barBeat その小節の先頭の拍
 * @param {number} bassNote その小節のベース音
 * @param {number|null} nextBassNote 次の小節のベース音。無ければ null
 * @param {number[]} pcs その小節の和音の実音ピッチクラス
 * @param {number} vel
 * @param {[number,number]} range ベースの音域
 */
export function expandBass(steps, barBeat, bassNote, nextBassNote, pcs, vel, range) {
  const out = [];
  for (const step of steps) {
    const dur = Math.min(step.dur, BEATS_PER_BAR - step.beat);
    if (!(dur > 0)) continue;
    let midi = bassNote;
    if (step.kind === 'fifth') midi = fifthOf(bassNote, pcs, range);
    else if (step.kind === 'octave') midi = octaveOf(bassNote, range);
    else if (step.kind === 'next') {
      // 次の小節の根音の先取り（食い）。曲の最終小節では鳴らさない。
      if (nextBassNote === null || nextBassNote === undefined) continue;
      midi = nextBassNote;
    }
    out.push({ midi, beat: barBeat + step.beat, dur, vel });
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test test/arrange.test.js`
Expected: PASS（9件）

- [ ] **Step 5: `compose.js` の `arpeggioIndex` を再エクスポートに変える**

`compose.js` の `arpeggioIndex` の定義（`src/compose.js:292-302` 付近）を削除し、
import の並びの末尾に次を足す。`test/compose.test.js` が `compose.js` から
この名前を読んでいるので、再エクスポートで受ける（循環参照にはならない）。

```js
import { arpeggioIndex, BEATS_PER_BAR } from './arrange.js';

export { arpeggioIndex };
```

`compose.js` 冒頭の `const BEATS_PER_BAR = 4;` は削除する（`arrange.js` のものを使う）。

- [ ] **Step 6: 全件通す**

Run: `npm test`
Expected: `# fail 0`

- [ ] **Step 7: コミット**

```bash
git add src/arrange.js src/compose.js test/arrange.test.js
git commit -m "編曲層 arrange.js を新設し、伴奏型・ベース型の展開器を置く

型は voicing の添字ではなく役割(low/upper/all/arp)で書く。天井へ収めるために
和音の上の音を省いた小節でも型が壊れないため。

まだ語彙も割り当ても入れていないので、曲の出力は変わらない。"
```

---

## Task 4: 伴奏型の語彙とセクションへの割り当て

ここで初めて曲の音が変わる。

**Files:**
- Modify: `src/arrange.js`
- Modify: `src/compose.js`（段5を `arrangeSong` の呼び出しに置き換える）
- Modify: `test/arrange.test.js`
- Modify: `test/compose.test.js:895-897`, `:1627-1641`, `:2327-2336`

**Interfaces:**
- Consumes: Task 2 の `barInfo`、Task 3 の `expandAccomp` / `expandBass`
- Produces: `arrangeSong(song, barInfo, rng) -> { accomp, bass, pad, patterns }`
  - `patterns` は `{ accomp: [{startBar, pattern}], bass: [{startBar, pattern}] }`
  - この Task ではベースは `whole` 固定。ベース型は Task 5 で入れる

- [ ] **Step 1: 失敗するテストを書く**

`test/arrange.test.js` の末尾に足す。

```js
import { ACCOMP_PATTERNS, ACCOMP_PLAN, arrangeSong } from '../src/arrange.js';
import { makeRng, seedFromString } from '../src/rng.js';

// 32小節・4セクション・各8小節ぶんの最小の barInfo を作る。
function fakeBarInfo(bars) {
  return Array.from({ length: bars }, (_, bar) => ({
    bar,
    symbol: 'I',
    tonicMidi: 60,
    rootMidi: 60,
    voicing: [48, 52, 55],
    padVoicing: [55, 60, 64],
    bassNote: 36,
    pcs: [0, 4, 7],
  }));
}

function fakeSong(bars = 32) {
  return { seed: 'x', bars, totalBeats: bars * 4, melody: [], sections: [], breathBar: null };
}

test('伴奏型: どの型も1小節(4拍)からはみ出さず、音を1つ以上鳴らす', () => {
  for (const [name, p] of Object.entries(ACCOMP_PATTERNS)) {
    const out = expandAccomp(p.steps, [48, 52, 55], 0, p.vel);
    assert.ok(out.length > 0, `${name} が無音`);
    for (const n of out) {
      assert.ok(n.beat >= 0 && n.beat < 4, `${name}: 拍が範囲外 ${n.beat}`);
      assert.ok(n.beat + n.dur <= 4 + 1e-9, `${name}: 小節をはみ出す ${n.beat}+${n.dur}`);
      assert.ok(n.vel > 0 && n.vel <= 0.35, `${name}: 強すぎる ${n.vel}`);
    }
  }
});

test('伴奏型: 計画の組はすべて実在する型を指し、後半のほうが音数が多い', () => {
  for (const pairs of ACCOMP_PLAN) {
    for (const [first, second] of pairs) {
      assert.ok(ACCOMP_PATTERNS[first], `未定義の型: ${first}`);
      assert.ok(ACCOMP_PATTERNS[second], `未定義の型: ${second}`);
    }
  }
  // A'' だけは着地なので密度を下げる。それ以外は折り返しで上げる。
  for (let s = 0; s < 3; s++) {
    for (const [first, second] of ACCOMP_PLAN[s]) {
      assert.ok(ACCOMP_PATTERNS[second].steps.length >= ACCOMP_PATTERNS[first].steps.length,
        `セクション${s}: 後半 ${second} が前半 ${first} より薄い`);
    }
  }
  for (const [first, second] of ACCOMP_PLAN[3]) {
    assert.ok(ACCOMP_PATTERNS[second].steps.length <= ACCOMP_PATTERNS[first].steps.length,
      `A'': 後半 ${second} が前半 ${first} より厚い`);
  }
});

test('arrangeSong: 伴奏が8区間に分かれ、異なる型が4種類以上出る', () => {
  const song = fakeSong(32);
  const info = fakeBarInfo(32);
  const { patterns } = arrangeSong(song, info, makeRng(seedFromString('x:arr')));
  assert.equal(patterns.accomp.length, 8, '4セクション×前半後半で8区間にならない');
  const kinds = new Set(patterns.accomp.map((p) => p.pattern));
  assert.ok(kinds.size >= 4, `伴奏型が ${kinds.size} 種類しかない`);
});

test('arrangeSong: 伴奏が途切れず、最終小節だけ刻みを止めて和音を置く', () => {
  const song = fakeSong(32);
  const { accomp, bass, pad } = arrangeSong(song, fakeBarInfo(32), makeRng(seedFromString('x:arr')));
  assert.equal(pad.length, 32);
  assert.equal(bass.length, 32);
  for (let bar = 0; bar < 32; bar++) {
    const inBar = accomp.filter((n) => Math.floor(n.beat / 4) === bar);
    assert.ok(inBar.length > 0, `${bar}小節目の伴奏が無音`);
  }
  const last = accomp.filter((n) => n.beat >= 31 * 4);
  assert.equal(last.length, 1, '最終小節が刻んでいる');
  assert.equal(last[0].dur, 4);
  assert.ok(last[0].midis.length >= 3);
  assert.equal(pad[31].dur, 6, 'パッドの余韻が無い');
});

test('arrangeSong: 同じ乱数なら完全に同じ編曲になる', () => {
  const a = arrangeSong(fakeSong(32), fakeBarInfo(32), makeRng(seedFromString('x:arr')));
  const b = arrangeSong(fakeSong(32), fakeBarInfo(32), makeRng(seedFromString('x:arr')));
  assert.deepEqual(a.accomp, b.accomp);
  assert.deepEqual(a.patterns, b.patterns);
});

test('arrangeSong: 16小節でも64小節でも8区間になる', () => {
  for (const bars of [16, 32, 64]) {
    const { patterns } = arrangeSong(fakeSong(bars), fakeBarInfo(bars), makeRng(seedFromString('x:arr')));
    assert.equal(patterns.accomp.length, 8, `${bars}小節で区間が ${patterns.accomp.length}`);
  }
});
```

- [ ] **Step 2: テストを走らせて落ちることを確認する**

Run: `node --test test/arrange.test.js`
Expected: FAIL（`ACCOMP_PATTERNS` などが未定義）

- [ ] **Step 3: 語彙と割り当てと `arrangeSong` を書く**

`src/arrange.js` に足す。

```js
import { pick } from './rng.js';

// ---------------------------------------------------------------------------
// 伴奏型
//
// vel は「その型で同時に鳴る音の多さ」に合わせて決める。初版は8分が8個という
// 前提の 0.3 一本だったので、和音を8分で押す pulse8 にそのまま使うと
// 同時発音数が3倍になって旋律が埋もれる。厚い型ほど1音を弱くする。
// ---------------------------------------------------------------------------
const ARP8 = Array.from({ length: 8 }, (_, i) => ({ beat: i * 0.5, voice: 'arp', dur: 0.75 }));
const PULSE8 = Array.from({ length: 8 }, (_, i) => ({ beat: i * 0.5, voice: 'all', dur: 0.5 }));

export const ACCOMP_PATTERNS = {
  // いちばん薄い。Aメロの入りで、旋律だけを聴かせる
  sustain: { vel: 0.22, steps: [{ beat: 0, voice: 'all', dur: 4 }] },
  // broken の静かな版。低音を2拍伸ばし、その上に上声を落とす
  brokenHalf: {
    vel: 0.30,
    steps: [
      { beat: 0, voice: 'low', dur: 2 }, { beat: 1, voice: 'upper', dur: 1 },
      { beat: 2, voice: 'low', dur: 2 }, { beat: 3, voice: 'upper', dur: 1 },
    ],
  },
  // 低音→上声→低音→上声。歌謡曲バラードの左手そのもの
  broken: {
    vel: 0.32,
    steps: [
      { beat: 0, voice: 'low', dur: 1 }, { beat: 1, voice: 'upper', dur: 1 },
      { beat: 2, voice: 'low', dur: 1 }, { beat: 3, voice: 'upper', dur: 1 },
    ],
  },
  // 初版の型。左手を途切れさせずに流す
  arp8: { vel: 0.30, steps: ARP8 },
  // 8ビートの食い。拍を食って前へ押す
  syncope: {
    vel: 0.30,
    steps: [
      { beat: 0, voice: 'low', dur: 0.5 }, { beat: 0.5, voice: 'upper', dur: 1 },
      { beat: 1.5, voice: 'upper', dur: 1 }, { beat: 2.5, voice: 'upper', dur: 0.5 },
      { beat: 3, voice: 'low', dur: 0.5 }, { beat: 3.5, voice: 'upper', dur: 0.5 },
    ],
  },
  // サビ。和音を8分で押す。いちばん厚い
  pulse8: { vel: 0.22, steps: PULSE8 },
};

// セクションごとの伴奏型の候補。組は [前半, 後半]。
// A メロは薄く、サビで一気に厚く、最後は収める——70〜80年代バラードの定石。
// 折り返し（セクションの半分）で型が1段上がる。A'' だけは逆に下げて着地させる。
export const ACCOMP_PLAN = [
  [['sustain', 'brokenHalf'], ['sustain', 'broken']],                // A   提示
  [['brokenHalf', 'broken'], ['broken', 'arp8']],                    // A'  高まり
  [['arp8', 'pulse8'], ['broken', 'syncope'], ['arp8', 'syncope']],  // B   サビ
  [['broken', 'brokenHalf'], ['arp8', 'brokenHalf']],                // A'' 着地
];

// ベースは Task 5 で型にする。ここではまだ全音符のまま。
const BASS_VEL = 0.5;
const PAD_VEL = 0.3;
const FINAL_ACCOMP_VEL = 0.4;
// 最終小節のパッドは小節をはみ出して余韻を作る。
const FINAL_PAD_DUR = 6;

/**
 * 曲を編曲する。音高は barInfo が既に決めてあるので、ここは時間だけを決める。
 *
 * rng は composeSong のものとは別の列（seed + ':arr'）。編曲を足し引きしても
 * 旋律と和声が動かない。
 *
 * @param {object} song bars を持つ曲
 * @param {Array<object>} barInfo 小節ごとの voicing / padVoicing / bassNote / pcs
 * @param {() => number} rng
 */
export function arrangeSong(song, barInfo, rng) {
  const bars = Number(song.bars);
  const barsPerSection = bars / 4;
  const half = Math.max(1, Math.floor(barsPerSection / 2));

  // 型の割り当て。乱数の消費はセクションごとに1回（4回）。
  const accompAt = [];
  const patterns = { accomp: [], bass: [] };
  for (let s = 0; s < 4; s++) {
    const [first, second] = pick(rng, ACCOMP_PLAN[s]);
    const startBar = s * barsPerSection;
    patterns.accomp.push({ startBar, pattern: first });
    patterns.accomp.push({ startBar: startBar + half, pattern: second });
    for (let i = 0; i < barsPerSection; i++) accompAt[startBar + i] = i < half ? first : second;
  }

  const accomp = [];
  const bass = [];
  const pad = [];
  for (let bar = 0; bar < bars; bar++) {
    const info = barInfo[bar];
    if (!info) continue;
    const barBeat = bar * BEATS_PER_BAR;
    const isFinal = bar === bars - 1;
    pad.push({
      midis: info.padVoicing.slice(),
      beat: barBeat,
      dur: isFinal ? FINAL_PAD_DUR : BEATS_PER_BAR,
      vel: PAD_VEL,
    });
    bass.push({ midi: info.bassNote, beat: barBeat, dur: BEATS_PER_BAR, vel: BASS_VEL });
    if (isFinal) {
      // 刻みをやめて和音を置く。刻み続けたまま終わると、耳は「まだ続く」と判断する。
      accomp.push({
        midi: info.voicing[0], midis: info.voicing.slice(),
        beat: barBeat, dur: BEATS_PER_BAR, vel: FINAL_ACCOMP_VEL,
      });
      continue;
    }
    const p = ACCOMP_PATTERNS[accompAt[bar]];
    for (const e of expandAccomp(p.steps, info.voicing, barBeat, p.vel)) accomp.push(e);
  }
  return { accomp, bass, pad, patterns };
}
```

- [ ] **Step 4: `compose.js` の段5を差し替える**

`compose.js` の import に足す（`makeRng` / `seedFromString` は既に `./rng.js` から入っている）。

```js
import { arpeggioIndex, arrangeSong, BEATS_PER_BAR } from './arrange.js';
```

そのうえで、Task 2 で書いた段5のループを、まるごと次に置き換える。

```js
  // ---- 段5: 編曲 ----
  // 乱数は作曲とは別の列。編曲を変えても旋律と和声は動かない。
  const arrRng = makeRng(seedFromString(`${String(seed)}:arr`));
  const { accomp, bass, pad, patterns } = arrangeSong({ bars }, barInfo, arrRng);
```

戻り値の `arrangement` に `patterns` を載せる。

```js
    arrangement: {
      accompPatterns: patterns.accomp,
      bassPatterns: patterns.bass,
      anticipated: [],   // Task 7 で埋める
    },
```

`ACCOMP_OFFSETS` / `ACCOMP_DUR` / `ACCOMP_VEL` / `PAD_VEL` / `BASS_VEL` /
`FINAL_ACCOMP_VEL` / `FINAL_PAD_DUR` の定数は `compose.js` から削除する（`arrange.js` へ移した）。

- [ ] **Step 5: 新しいテストが通ることを確認する**

Run: `node --test test/arrange.test.js`
Expected: PASS

- [ ] **Step 6: 旋律が動いていないことを確認する**

Run: `node --test test/seedcompat.test.js`
Expected: PASS

- [ ] **Step 7: 既存テストの古い不変条件を書き換える**

「伴奏は1小節8音」という主張は成り立たなくなる。次の3か所を直す。

`test/compose.test.js:895-897`（`pad / bass / accomp が全小節ぶん鳴る`）

```js
    // 伴奏は小節ごとに型が変わるので、音数は一定ではない。
    // 守るべきなのは「どの小節にも音がある」＝左手が止まらないこと。
    for (let bar = 0; bar < song.bars; bar++) {
      const inBar = song.accomp.filter((n) => Math.floor(n.beat / 4) === bar);
      assert.ok(inBar.length > 0, `${bar}小節目の伴奏が無音`);
    }
```

`test/compose.test.js:1627`（テスト名ごと差し替える）

```js
test('伴奏はセクションごとに型が変わり、どの小節も途切れない', () => {
  const song = composeSong('accomp', DATA, S({ songBars: '32' }));
  const lastBarBeat = (song.bars - 1) * 4;
  for (const n of song.accomp) {
    if (n.beat >= lastBarBeat) continue; // 最終小節は保持和音なので別枠
    assert.ok(n.dur > 0 && n.dur <= 4, `dur が長すぎる: ${n.dur}`);
    assert.ok(n.vel > 0 && n.vel <= 0.35, `伴奏が強すぎる: ${n.vel}`);
    assert.ok(n.beat + n.dur <= Math.floor(n.beat / 4) * 4 + 4 + 1e-9, '小節をはみ出している');
  }
  // 初版はここが全曲・全小節で同じ8分アルペジオだった。
  // Aメロを薄く、サビで厚く——その落差が曲の起伏そのものになる。
  assert.equal(song.arrangement.accompPatterns.length, 8);
  const kinds = new Set(song.arrangement.accompPatterns.map((p) => p.pattern));
  assert.ok(kinds.size >= 4, `伴奏型が ${kinds.size} 種類しかない`);
  const bar0 = song.accomp.filter((n) => n.beat < 4);
  assert.ok(bar0.length > 0, '1小節目の伴奏が無音');
});
```

`test/compose.test.js:2327-2336`（実データ版。テスト名ごと差し替える）

```js
test('実データ: 伴奏がどの小節も途切れず、最終小節だけ和音を保持する', realOpts, () => {
  for (const bars of ['16', '32', '64']) {
    const song = composeSong('accomp-real', REAL, S({ songBars: bars }));
    for (let bar = 0; bar < song.bars; bar++) {
      const inBar = song.accomp.filter((n) => Math.floor(n.beat / 4) === bar);
      if (bar === song.bars - 1) {
        assert.equal(inBar.length, 1, `最終小節の伴奏が ${inBar.length} イベント`);
        assert.equal(inBar[0].dur, 4);
      } else {
        assert.ok(inBar.length > 0, `${bar}小節目の伴奏が無音`);
      }
    }
  }
});
```

- [ ] **Step 8: 全件通す**

Run: `npm test`
Expected: `# fail 0`

他にも `accomp.length` を前提にしたテストが落ちたら、同じ考え方で
「音数」ではなく「途切れないこと」を主張する形に直す。

- [ ] **Step 9: 耳で確かめる**

Run: `npm start` して http://localhost:8080/ を開き、通しで2〜3曲聴く。
Expected: Aメロが薄く、サビで厚くなる。伴奏が曲の中で顔を変える。

- [ ] **Step 10: コミット**

```bash
git add src/arrange.js src/compose.js test/arrange.test.js test/compose.test.js
git commit -m "伴奏型6種を入れ、セクションの前半後半で切り替える

全曲・全小節が同じ8分アルペジオだったのをやめ、Aメロは薄く、サビで一気に
厚く、最後は収める形にする。1曲が8区間に分かれる。

「伴奏は1小節8音」という古い不変条件のテスト3件を、
「どの小節も途切れない」「型がセクションごとに変わる」へ書き換えた。"
```

---

## Task 5: ベース型の語彙と割り当て

**Files:**
- Modify: `src/arrange.js`
- Modify: `test/arrange.test.js`

**Interfaces:**
- Consumes: Task 3 の `expandBass`、Task 4 の `arrangeSong`
- Produces: `BASS_PATTERNS` / `BASS_PLAN` を `arrange.js` から export。`arrangeSong` の戻り値 `patterns.bass` が8区間になる

- [ ] **Step 1: 失敗するテストを書く**

`test/arrange.test.js` の末尾に足す（import に `BASS_PATTERNS, BASS_PLAN` を追加）。

```js
test('ベース型: どの型も1小節からはみ出さない', () => {
  for (const [name, p] of Object.entries(BASS_PATTERNS)) {
    const out = expandBass(p.steps, 0, 36, 41, [0, 4, 7], p.vel, [28, 55]);
    assert.ok(out.length > 0, `${name} が無音`);
    for (const n of out) {
      assert.ok(n.beat >= 0 && n.beat + n.dur <= 4 + 1e-9, `${name}: 小節をはみ出す`);
      assert.ok(n.midi >= 28 && n.midi <= 55, `${name}: 音域外 ${n.midi}`);
    }
  }
});

test('ベース型: 計画の組はすべて実在する型を指す', () => {
  for (const pairs of BASS_PLAN) {
    for (const pair of pairs) {
      for (const name of pair) assert.ok(BASS_PATTERNS[name], `未定義の型: ${name}`);
    }
  }
});

test('arrangeSong: ベースも8区間に分かれ、全小節に音がある', () => {
  const { bass, patterns } = arrangeSong(fakeSong(32), fakeBarInfo(32), makeRng(seedFromString('x:arr')));
  assert.equal(patterns.bass.length, 8);
  for (let bar = 0; bar < 32; bar++) {
    assert.ok(bass.some((n) => Math.floor(n.beat / 4) === bar), `${bar}小節目のベースが無音`);
  }
});

test('arrangeSong: ベースの先取りが曲の外へはみ出さない', () => {
  const { bass } = arrangeSong(fakeSong(32), fakeBarInfo(32), makeRng(seedFromString('x:arr')));
  for (const n of bass) {
    assert.ok(n.beat + n.dur <= 32 * 4 + 1e-9, `曲の終わりを越えている: ${n.beat}+${n.dur}`);
  }
  // 最終小節は終止。刻まず先取りもしない。
  const last = bass.filter((n) => n.beat >= 31 * 4);
  assert.equal(last.length, 1);
  assert.equal(last[0].dur, 4);
});
```

- [ ] **Step 2: テストを走らせて落ちることを確認する**

Run: `node --test test/arrange.test.js`
Expected: FAIL（`BASS_PATTERNS` が未定義）

- [ ] **Step 3: ベース型を書く**

`src/arrange.js` に足す。

```js
// ---------------------------------------------------------------------------
// ベース型
//
// 初版は全小節が全音符だった。和音は変わるのに刻みが変わらないので、
// 土台がずっと止まって聴こえる。8ビートバラードの推進力は、ベースが
// 次の小節の根音を半拍先に鳴らす「食い」から出る。
// ---------------------------------------------------------------------------
export const BASS_PATTERNS = {
  whole: { vel: 0.5, steps: [{ beat: 0, kind: 'root', dur: 4 }] },
  rootFifth: {
    vel: 0.5,
    steps: [{ beat: 0, kind: 'root', dur: 2 }, { beat: 2, kind: 'fifth', dur: 2 }],
  },
  rootOctave: {
    vel: 0.5,
    steps: [{ beat: 0, kind: 'root', dur: 2 }, { beat: 2, kind: 'octave', dur: 2 }],
  },
  drive: { vel: 0.45, steps: [0, 1, 2, 3].map((beat) => ({ beat, kind: 'root', dur: 1 })) },
  // 拍3.5で次の小節の根音を先取りする。これが8ビートバラードの推進力の正体。
  anticipate: {
    vel: 0.5,
    steps: [{ beat: 0, kind: 'root', dur: 3.5 }, { beat: 3.5, kind: 'next', dur: 0.5 }],
  },
};

// セクションごとのベース型の候補。伴奏と同じく [前半, 後半]。
export const BASS_PLAN = [
  [['whole', 'whole'], ['whole', 'rootFifth']],                          // A
  [['rootFifth', 'rootFifth'], ['whole', 'rootOctave']],                 // A'
  [['rootOctave', 'anticipate'], ['rootFifth', 'drive'], ['anticipate', 'anticipate']], // B
  [['whole', 'rootFifth'], ['whole', 'whole']],                          // A''
];
```

`arrangeSong` を直す。型の割り当てで `BASS_PLAN` からも引き（乱数はセクションごとに2回、
計8回になる）、小節ループのベースを `expandBass` に置き換える。

```js
  const bassAt = [];
  for (let s = 0; s < 4; s++) {
    const [aFirst, aSecond] = pick(rng, ACCOMP_PLAN[s]);
    const [bFirst, bSecond] = pick(rng, BASS_PLAN[s]);
    const startBar = s * barsPerSection;
    patterns.accomp.push({ startBar, pattern: aFirst });
    patterns.accomp.push({ startBar: startBar + half, pattern: aSecond });
    patterns.bass.push({ startBar, pattern: bFirst });
    patterns.bass.push({ startBar: startBar + half, pattern: bSecond });
    for (let i = 0; i < barsPerSection; i++) {
      accompAt[startBar + i] = i < half ? aFirst : aSecond;
      bassAt[startBar + i] = i < half ? bFirst : bSecond;
    }
  }
```

小節ループのベース生成:

```js
    if (isFinal) {
      // 最終小節は終止。刻まず、先取りもしない。
      bass.push({ midi: info.bassNote, beat: barBeat, dur: BEATS_PER_BAR, vel: BASS_VEL });
      // （伴奏の保持和音は現行のまま）
      ...
      continue;
    }
    const bp = BASS_PATTERNS[bassAt[bar]];
    const next = barInfo[bar + 1] ? barInfo[bar + 1].bassNote : null;
    for (const e of expandBass(bp.steps, barBeat, info.bassNote, next, info.pcs, bp.vel, BASS_RANGE)) {
      bass.push(e);
    }
```

`BASS_RANGE` は `compose.js` にあるので、`arrangeSong` の引数で受けるのではなく
`arrange.js` にも `const BASS_RANGE = [28, 55];` を置き、**`compose.js` 側の
定義にコメントで対応を書く**（音域は音高の話なので compose が正、arrange は
はみ出さないための上限としてだけ使う）。

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test test/arrange.test.js`
Expected: PASS

- [ ] **Step 5: 旋律が動いていないことと全件を確認する**

Run: `node --test test/seedcompat.test.js && npm test`
Expected: どちらも `# fail 0`

- [ ] **Step 6: コミット**

```bash
git add src/arrange.js test/arrange.test.js
git commit -m "ベース型5種を入れる。サビで次の小節の根音を先取りする

全小節が全音符だったのをやめる。anticipate（拍3.5で次の小節の根音を鳴らす）
がこの時代のバラードの推進力の正体で、サビに集める。

5度は和音の音でなければオクターブへ逃がす。転回形では最低音の5度上が
和音の音とは限らず、半音で押し込むと別の和音になってしまう。"
```

---

## Task 6: `melodyCeiling` と `withoutRub` を「鳴っている区間」で見る

食いとタイで小節をまたぐ音が増える前に、その受け皿を作る。

**Files:**
- Modify: `src/compose.js`（`melodyCeiling` / `withoutRub`）
- Modify: `test/compose.test.js`（新しいテストを追加）

**Interfaces:**
- Produces: `melodyCeiling(melody, bar)` と `withoutRub(midis, melody, bar)` が、
  小節をまたいで鳴っている音と `n.anticipated` を見るようになる。署名は変わらない

- [ ] **Step 1: 失敗するテストを書く**

`test/compose.test.js` の `melodyCeiling` / `withoutRub` のテストの近くに足す。

```js
test('melodyCeiling: 前の小節から伸びてきて鳴っている音も天井に効く', () => {
  // 拍3.5から2拍伸びる音は、1小節目(拍4〜8)でも鳴っている。
  const melody = [{ midi: 60, beat: 3.5, dur: 2 }];
  assert.equal(melodyCeiling(melody, 0), 58, '自分の小節で効いていない');
  assert.equal(melodyCeiling(melody, 1), 58, 'またいで鳴っている音を取りこぼしている');
  // 小節1の途中で鳴り終わる音は、小節2には効かない。
  assert.equal(melodyCeiling(melody, 2), 72);
});

test('withoutRub: 食った音は短くても表扱いになる', () => {
  // 拍3.5から1拍。強拍にも無く1.5拍にも満たないが、聴き手には次の小節の
  // 頭の音として聴こえている。半音でぶつかるパッドは削る。
  const melody = [{ midi: 60, beat: 3.5, dur: 1, anticipated: true }];
  assert.deepEqual(withoutRub([59, 62, 65], melody, 0), [62, 65]);
  // 食っていなければ従来どおり（表の条件に当たらないので削らない）。
  const plain = [{ midi: 60, beat: 3.5, dur: 1 }];
  assert.deepEqual(withoutRub([59, 62, 65], plain, 0), [59, 62, 65]);
});
```

- [ ] **Step 2: テストを走らせて落ちることを確認する**

Run: `node --test --test-name-pattern="鳴っている音も天井|食った音は短くても" test/compose.test.js`
Expected: FAIL

- [ ] **Step 3: 実装を直す**

```js
export function melodyCeiling(melody, bar) {
  const from = bar * 4;
  const to = from + 4;
  let low = Infinity;
  for (const n of melody) {
    // 開始拍ではなく「鳴っている区間」で見る。食いとタイで小節をまたぐ音が
    // 増えたので、開始拍だけを見ると前の小節から伸びてきた音を取りこぼし、
    // 伴奏がその上を横切る。
    if (n.beat >= to || n.beat + n.dur <= from) continue;
    if (n.midi < low) low = n.midi;
  }
  return low === Infinity ? NO_MELODY_CEILING : low - LAYER_GAP;
}

export function withoutRub(midis, melody, bar) {
  const from = bar * 4;
  const to = from + 4;
  const exposed = [];
  for (const n of melody) {
    if (n.beat >= to || n.beat + n.dur <= from) continue;
    // 食った音は無条件に表扱い。拍3.5にあって短くても、聴き手には
    // 次の小節の頭の音として聴こえている。
    if (n.anticipated || n.beat % 2 === 0 || n.dur >= EXPOSED_DUR) exposed.push(n.midi);
  }
  if (exposed.length === 0) return midis;
  const rubs = (m) => exposed.some((x) => {
    const d = (((m - x) % 12) + 12) % 12;
    return d === 1 || d === 11;
  });
  const kept = midis.filter((m) => !rubs(m));
  return kept.length >= 2 ? kept : midis;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test --test-name-pattern="鳴っている音も天井|食った音は短くても" test/compose.test.js`
Expected: PASS

- [ ] **Step 5: 全件通す**

Run: `npm test`
Expected: `# fail 0`

天井の判定が広くなるぶん、伴奏の音高が下がる小節が出る。実データのテストで
「伴奏が旋律を越えない」を検査しているものは、**より通りやすくなる**方向なので落ちない。
もし落ちたら、越えている小節の旋律・伴奏・パッドを印字して原因を特定する。

- [ ] **Step 6: コミット**

```bash
git add src/compose.js test/compose.test.js
git commit -m "天井と濁りの判定を、開始拍ではなく鳴っている区間で見る

小節をまたいで鳴っている旋律を取りこぼしていた。食いとタイでまたぐ音が
増えるので、その受け皿を先に作る。食った音は短くても表扱いにする。"
```

---

## Task 7: 食い（アンティシペーション）

**Files:**
- Modify: `src/arrange.js`
- Modify: `src/compose.js`（段3の追加）
- Modify: `test/arrange.test.js`

**Interfaces:**
- Produces: `anticipateMelody(song, rng) -> number[]`（食わせた音の**移動後**の拍の配列）。
  `song.melody` を破壊的に書き換え、食った音に `anticipated: true` を立てる

- [ ] **Step 1: 失敗するテストを書く**

`test/arrange.test.js` の末尾に足す（import に `anticipateMelody` を追加）。

```js
// 常に食う／絶対に食わない乱数。確率の抽選そのものを固定して、
// 条件のほうだけを検査する。
const ALWAYS = () => 0;
const NEVER = () => 0.999999;

function melodySong(melody, over = {}) {
  return {
    seed: 'x', bars: 8, totalBeats: 32, melody,
    climaxBeat: -1, breathBar: null, sections: [], ...over,
  };
}

test('食い: 小節の頭の音が半拍前へ出て、長さがその分伸びる', () => {
  const song = melodySong([
    { midi: 60, beat: 0, dur: 1 },
    { midi: 62, beat: 8, dur: 1 },
  ]);
  const moved = anticipateMelody(song, ALWAYS);
  assert.deepEqual(moved, [7.5]);
  const n = song.melody.find((x) => x.midi === 62);
  assert.equal(n.beat, 7.5);
  assert.equal(n.dur, 1.5, '終わりの位置が動いている');
  assert.equal(n.anticipated, true);
});

test('食い: 曲の1音目は食わない', () => {
  // 拍0から始まる曲の頭を食うと、どこが1拍目か掴めないまま曲に入ることになる。
  const song = melodySong([{ midi: 60, beat: 0, dur: 1 }, { midi: 62, beat: 8, dur: 1 }]);
  anticipateMelody(song, ALWAYS);
  assert.equal(song.melody.find((x) => x.midi === 60).beat, 0);
});

test('食い: 最終小節・クライマックス・息継ぎの直後は食わない', () => {
  const base = [
    { midi: 60, beat: 0, dur: 1 },
    { midi: 62, beat: 8, dur: 1 },    // クライマックス
    { midi: 64, beat: 16, dur: 1 },   // 息継ぎ(小節3)の直後の小節4
    { midi: 65, beat: 28, dur: 1 },   // 最終小節(bars=8 → 小節7)
  ];
  const song = melodySong(base.map((n) => ({ ...n })), { climaxBeat: 8, breathBar: 3 });
  anticipateMelody(song, ALWAYS);
  const at = (midi) => song.melody.find((x) => x.midi === midi).beat;
  assert.equal(at(62), 8, 'クライマックスを食っている');
  assert.equal(at(64), 16, '息継ぎの直後を食っている');
  assert.equal(at(65), 28, '最終小節を食っている');
});

test('食い: 直前の半拍が塞がっていたら食わない', () => {
  // 前の音が拍7.75まで鳴っている＝食い込む場所が無い。
  const song = melodySong([
    { midi: 60, beat: 0, dur: 1 },
    { midi: 61, beat: 7, dur: 0.75 },
    { midi: 62, beat: 8, dur: 1 },
  ]);
  assert.deepEqual(anticipateMelody(song, ALWAYS), []);
});

test('食い: 抽選に外れたら動かさない', () => {
  const song = melodySong([{ midi: 60, beat: 0, dur: 1 }, { midi: 62, beat: 8, dur: 1 }]);
  assert.deepEqual(anticipateMelody(song, NEVER), []);
  assert.equal(song.melody.find((x) => x.midi === 62).beat, 8);
});

test('食い: 書き換えたあとも melody は拍の昇順に並ぶ', () => {
  const song = melodySong([
    { midi: 60, beat: 0, dur: 1 },
    { midi: 61, beat: 6, dur: 0.5 },
    { midi: 62, beat: 8, dur: 1 },
  ]);
  anticipateMelody(song, ALWAYS);
  const beats = song.melody.map((n) => n.beat);
  assert.deepEqual(beats, beats.slice().sort((a, b) => a - b));
});
```

- [ ] **Step 2: テストを走らせて落ちることを確認する**

Run: `node --test test/arrange.test.js`
Expected: FAIL（`anticipateMelody` が未定義）

- [ ] **Step 3: 実装する**

`src/arrange.js` に足す。

```js
// ---------------------------------------------------------------------------
// 食い（アンティシペーション）
//
// 小節の頭の音を半拍前へ出し、小節線をまたいで鳴らす。実測すると初版では
// 小節線をまたぐ音が 0.6%（85 / 14609）しか無かった。この時代のバラードの
// 推進力は、ほぼこの一点から出ている。
//
// 前の小節の和音との衝突は明示的には検査しない。この関数は声部配置より
// 前に走るので、パッドが唸る場合は withoutRub が削る。次の和音の和声音が
// 前の和音の上で鳴ること自体は潰さない——それが食いの響きそのもの。
// ---------------------------------------------------------------------------
const ANTICIPATE_SHIFT = 0.5;
// セクションごとの確率(%)。A / A' / B(サビ) / A''。
// サビに集めることで、曲を通して単調にならず、いちばん押したいところで前へ出る。
const ANTICIPATE_CHANCE = [15, 35, 70, 30];

export function anticipateMelody(song, rng) {
  const melody = Array.isArray(song?.melody) ? song.melody : [];
  if (melody.length === 0) return [];
  const bars = Number(song.bars);
  const barsPerSection = bars / 4;
  const climaxBeat = Number(song.climaxBeat);
  const breathBar = song.breathBar === undefined ? null : song.breathBar;
  const firstBeat = Math.min(...melody.map((n) => n.beat));
  const moved = [];

  // 拍の早い順に見る。同じ拍なら元の並び順のまま（乱数の消費順を固定するため）。
  const order = melody.map((_, i) => i)
    .sort((a, b) => melody[a].beat - melody[b].beat || a - b);

  for (const i of order) {
    const n = melody[i];
    if (n.beat % BEATS_PER_BAR !== 0) continue;   // 小節の頭の音だけ
    const bar = n.beat / BEATS_PER_BAR;
    if (bar === 0) continue;                      // 前の小節が無い
    if (n.beat === firstBeat) continue;           // 曲の1音目。拍の位置を示す役目がある
    if (bar === bars - 1) continue;               // 最終小節。終止は動かさない
    if (n.beat === climaxBeat) continue;          // 頂点。テヌートと二重に掛かる
    if (breathBar !== null && bar === breathBar + 1) continue;  // 息継ぎの直後
    const from = n.beat - ANTICIPATE_SHIFT;
    // 食い込む半拍が空いているか。鳴っている区間で見る。
    if (melody.some((m) => m !== n && m.beat < n.beat && m.beat + m.dur > from)) continue;
    const section = Math.min(3, Math.floor(bar / barsPerSection));
    if (!(rng() * 100 < ANTICIPATE_CHANCE[section])) continue;
    n.beat = from;
    n.dur += ANTICIPATE_SHIFT;   // 終わりの位置は動かさない
    n.anticipated = true;
    moved.push(from);
  }
  melody.sort((a, b) => a.beat - b.beat);
  return moved;
}
```

- [ ] **Step 4: `compose.js` に段3を足す**

`compose.js` の `./arrange.js` からの import に `anticipateMelody` を足す。

```js
import { anticipateMelody, arpeggioIndex, arrangeSong, BEATS_PER_BAR } from './arrange.js';
```

段2（最終音の書き換え）の直後、段4（声部配置）の**前**に置く。

```js
  // ---- 段3: 食い。旋律の音程には触れず、拍と音価だけを書き換える ----
  // 声部配置より前に置くのが要。ここで小節をまたいだ音を、天井(melodyCeiling)と
  // 濁りの判定(withoutRub)が見られるようになる。
  const arrRng = makeRng(seedFromString(`${String(seed)}:arr`));
  const anticipated = anticipateMelody({ bars, melody, climaxBeat, breathBar }, arrRng);
```

Task 4 で段5に書いた `const arrRng = ...` は削除し、この1本を使い回す
（`arrangeSong(...)` にはこの `arrRng` をそのまま渡す）。
戻り値の `arrangement.anticipated` に `anticipated` を入れる。

- [ ] **Step 5: テストが通ることを確認する**

Run: `node --test test/arrange.test.js`
Expected: PASS

- [ ] **Step 6: 旋律の音程が動いていないことを確認する**

Run: `node --test test/seedcompat.test.js`
Expected: PASS（スナップショットは midi の列だけを見るので、拍が動いても通る。
ここが落ちたら食いが音高を触っている）

- [ ] **Step 7: 全件通す**

Run: `npm test`
Expected: `# fail 0`

「旋律が拍0から始まる」を主張しているテスト（`test/compose.test.js:2562` 付近の
「出だしは拍0から」）は、曲の1音目を食わない規則があるので通るはず。落ちたら規則の実装漏れ。

- [ ] **Step 8: 楽譜と書き出しを目で確かめる**

Run: `npm start` して http://localhost:8080/ で楽譜を表示し、MusicXML と MIDI を書き出す。
Expected: 小節線をまたぐ音がタイで繋がって描かれる。MusicXML が読み込めて、
MIDI の音の長さが楽譜と合っている。

- [ ] **Step 9: コミット**

```bash
git add src/arrange.js src/compose.js test/arrange.test.js
git commit -m "食い（アンティシペーション）を入れる

小節の頭の音を半拍前へ出して小節線をまたがせる。初版は小節線をまたぐ音が
0.6%しかなく、この時代のバラードの推進力が原理的に出せなかった。

曲の1音目・クライマックス・息継ぎの直後・最終小節は食わない。
確率はサビ70%を頂点にセクションごとに変える。"
```

---

## Task 8: タイ（フレーズ末の伸ばし）

**Files:**
- Modify: `src/arrange.js`
- Modify: `src/compose.js`（段3にもう1つ足す）
- Modify: `test/arrange.test.js`

**Interfaces:**
- Produces: `sustainPhraseEnds(song) -> number` （伸ばした音の数）。`song.melody` を破壊的に書き換える。
  `song.sections[].slots[].phraseEnd` と `song.sections[].startBar` を読む。乱数は使わない

- [ ] **Step 1: 失敗するテストを書く**

`test/arrange.test.js` の末尾に足す（import に `sustainPhraseEnds` を追加）。

```js
test('タイ: フレーズ末の音が次の音の手前0.5拍まで伸びる', () => {
  const song = {
    bars: 8, melody: [
      { midi: 60, beat: 0, dur: 0.5 },
      { midi: 62, beat: 2, dur: 0.5 },   // スロット0の最後 = フレーズ末
      { midi: 64, beat: 8, dur: 0.5 },
    ],
    breathBar: null,
    sections: [{ startBar: 0, slots: [{ phraseEnd: true }, { phraseEnd: false }] }],
  };
  assert.equal(sustainPhraseEnds(song), 1);
  const n = song.melody.find((x) => x.midi === 62);
  assert.equal(n.dur, 4, '次の音(拍8)の手前0.5拍まで、上限4拍');
});

test('タイ: 息継ぎの小節へは伸ばさない', () => {
  // 伸ばすと息継ぎが消える。歌い手が息を吸う一瞬を潰してはいけない。
  const song = {
    bars: 8, melody: [{ midi: 60, beat: 2, dur: 0.5 }, { midi: 64, beat: 12, dur: 0.5 }],
    breathBar: 1,
    sections: [{ startBar: 0, slots: [{ phraseEnd: true }] }],
  };
  sustainPhraseEnds(song);
  assert.equal(song.melody[0].dur, 2, '息継ぎの小節(拍4〜)へ食い込んでいる');
});

test('タイ: 元より短くしない。曲の最後の音は触らない', () => {
  const song = {
    bars: 8, melody: [{ midi: 60, beat: 0, dur: 3 }, { midi: 62, beat: 28, dur: 4 }],
    breathBar: null,
    sections: [{ startBar: 0, slots: [{ phraseEnd: true }] },
      { startBar: 6, slots: [{ phraseEnd: true }] }],
  };
  sustainPhraseEnds(song);
  assert.equal(song.melody[0].dur, 3, '短くなっている');
  assert.equal(song.melody[1].dur, 4, '終止の音を触っている');
});
```

- [ ] **Step 2: テストを走らせて落ちることを確認する**

Run: `node --test test/arrange.test.js`
Expected: FAIL（`sustainPhraseEnds` が未定義）

- [ ] **Step 3: 実装する**

```js
// ---------------------------------------------------------------------------
// タイ（フレーズ末の伸ばし）
//
// 初版では旋律の音価の中央値が0.5拍で、2拍以上伸ばす音は 5.0% しか無かった。
// フレーズの終わりが短く切れて次まで無音、という形が繰り返される。
// 伸ばし切ってから息を吸う——それがフレーズを「歌」にする。
//
// 次の音の手前に必ず0.5拍を残すので、間は潰れない。
// ---------------------------------------------------------------------------
const PHRASE_GAP = 0.5;
const MAX_HOLD = 4;

export function sustainPhraseEnds(song) {
  const melody = Array.isArray(song?.melody) ? song.melody : [];
  if (melody.length === 0) return 0;
  const bars = Number(song.bars);
  const endBeat = bars * BEATS_PER_BAR;
  const breathBeat = song.breathBar === null || song.breathBar === undefined
    ? null
    : song.breathBar * BEATS_PER_BAR;

  // フレーズ末のスロットが占める拍の範囲。スロットは2小節ひとかたまり。
  const ranges = [];
  for (const s of song.sections ?? []) {
    const slots = Array.isArray(s?.slots) ? s.slots : [];
    for (let k = 0; k < slots.length; k++) {
      if (!slots[k]?.phraseEnd) continue;
      const from = (Number(s.startBar) + 2 * k) * BEATS_PER_BAR;
      ranges.push([from, from + 2 * BEATS_PER_BAR]);
    }
  }

  const sorted = melody.slice().sort((a, b) => a.beat - b.beat);
  let held = 0;
  for (const [from, to] of ranges) {
    // その範囲で最後に鳴り出す音がフレーズ末の音。
    let last = null;
    for (const n of sorted) {
      if (n.beat >= from && n.beat < to && (last === null || n.beat >= last.beat)) last = n;
    }
    if (last === null) continue;
    // 曲の最後の音は、終止として既に最終小節の終わりまで伸ばしてある。触らない。
    if (last.beat + last.dur >= endBeat) continue;
    const next = sorted.find((n) => n.beat > last.beat);
    let limit = next ? next.beat - PHRASE_GAP : endBeat;
    // 息継ぎの小節へは伸ばさない。
    if (breathBeat !== null && last.beat < breathBeat) limit = Math.min(limit, breathBeat);
    const dur = Math.min(MAX_HOLD, limit - last.beat);
    if (dur > last.dur) {
      last.dur = dur;
      held += 1;
    }
  }
  return held;
}
```

- [ ] **Step 4: `compose.js` の段3に足す**

`compose.js` の `./arrange.js` からの import に `sustainPhraseEnds` を足す。

```js
import {
  anticipateMelody, arpeggioIndex, arrangeSong, sustainPhraseEnds, BEATS_PER_BAR,
} from './arrange.js';
```

呼び出しは**食いより後ろ**に置く。順序が要。食いで次の音が前へ動くと、タイの伸ばせる長さが
そのぶん縮む——それが正しい（食い込んできた音の手前0.5拍で止まる）。

```js
  const anticipated = anticipateMelody({ bars, melody, climaxBeat, breathBar }, arrRng);
  // 食いのあとに伸ばす。食いで次の音が前へ動いた分だけ、伸ばせる長さが縮む。
  sustainPhraseEnds({ bars, melody, breathBar, sections });
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `node --test test/arrange.test.js`
Expected: PASS

- [ ] **Step 6: 全件通す**

Run: `node --test test/seedcompat.test.js && npm test`
Expected: どちらも `# fail 0`

- [ ] **Step 7: コミット**

```bash
git add src/arrange.js src/compose.js test/arrange.test.js
git commit -m "フレーズ末の音を次の音の手前0.5拍まで伸ばす

初版は音価の中央値が0.5拍で、2拍以上の音が5.0%しか無かった。フレーズの
終わりが短く切れて次まで無音、という形が繰り返されていた。

0.5拍の隙間を必ず残すので、伸ばし切ってから息を吸う形になり間は潰れない。
息継ぎの小節へは伸ばさない。"
```

---

## Task 9: 数値目標の検証と、楽譜・書き出しの実データ確認

**Files:**
- Create: `tools/monotony.js`
- Modify: `docs/superpowers/specs/2026-08-20-pop-ballad-arrangement-design.md`（8.1 の表に実測値を書き入れる）

**Interfaces:**
- Consumes: `composeSong`、`tools/snapshot.js` の `loadData`
- Produces: `node tools/monotony.js` が仕様書8.1の5指標を印字する

- [ ] **Step 1: 計測スクリプトを書く**

```js
// tools/monotony.js
#!/usr/bin/env node
// 単調さの5指標を実測する。仕様書 8.1 の検証に使う。
// 初版の値は「1曲の伴奏の区間 1 / 小節線をまたぐ音 0.6% / 2拍以上の音 5.0% /
// 1曲の小節リズム型 6.9」だった。
import { composeSong } from '../src/compose.js';
import { defaultSettings } from '../src/settings.js';
import { loadData } from './snapshot.js';

const N = 100;
const data = loadData();
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);

const rhythmKinds = [];
const accompKinds = [];
const accompSpans = [];
let total = 0;
let crossBar = 0;
let longNotes = 0;

for (let i = 0; i < N; i++) {
  const song = composeSong(`seed${i}`, data, defaultSettings());
  const perBar = new Map();
  for (const n of song.melody) {
    const bar = Math.floor(n.beat / 4);
    if (!perBar.has(bar)) perBar.set(bar, []);
    perBar.get(bar).push(`${+(n.beat - bar * 4).toFixed(2)}:${n.dur}`);
    total += 1;
    if (Math.floor((n.beat + n.dur - 1e-9) / 4) > bar) crossBar += 1;
    if (n.dur >= 2) longNotes += 1;
  }
  rhythmKinds.push(new Set([...perBar.values()].map((a) => a.join(','))).size);
  const ps = song.arrangement?.accompPatterns ?? [];
  accompSpans.push(ps.length);
  accompKinds.push(new Set(ps.map((p) => p.pattern)).size);
}

console.log(`1曲の伴奏の区間     : ${avg(accompSpans)}  （初版 1 / 目標 8）`);
console.log(`1曲の伴奏型の種類   : ${avg(accompKinds)}  （初版 1 / 目標 4以上）`);
console.log(`小節線をまたぐ音    : ${(crossBar / total * 100).toFixed(1)}%  （初版 0.6% / 目標 8%以上）`);
console.log(`2拍以上伸ばす音     : ${(longNotes / total * 100).toFixed(1)}%  （初版 5.0% / 目標 12%以上）`);
console.log(`1曲の小節リズム型   : ${avg(rhythmKinds)}  （初版 6.9 / 目標 10以上）`);
```

- [ ] **Step 2: 計測して目標との差を見る**

Run: `node tools/monotony.js`
Expected: 5行の実測値。

**未達だったときの手当て（この順で試す）:**

| 未達の指標 | 触る場所 |
|---|---|
| 小節線をまたぐ音 | `ANTICIPATE_CHANCE` を上げる。タイの `MAX_HOLD` を上げる |
| 2拍以上伸ばす音 | `PHRASE_GAP` を下げる（0.5 → 0.25）。ただし間が潰れるので耳で確かめる |
| 伴奏型の種類 | `ACCOMP_PLAN` の組を増やす。ただし「Aメロは薄く、サビは厚く」を崩さない |
| 1曲の小節リズム型 | **これは案1の射程を超える可能性がある**。断片プールのリズム型が40種しかないのが根本原因で、案2で扱う。未達なら数字を記録して申し送る |

数字のために音楽を壊さないこと。定数を動かしたら必ず Step 5 で耳で確かめる。

- [ ] **Step 3: 仕様書に実測値を書き入れる**

`docs/superpowers/specs/2026-08-20-pop-ballad-arrangement-design.md` の 8.1 の表に
「実測」の列を足し、Step 2 の値を入れる。未達の指標には理由を1行で書く。

- [ ] **Step 4: 楽譜と書き出しを実データで確かめる**

Run: `npm start` → http://localhost:8080/

以下を目で確認する。

- 小節線をまたぐ音がタイで繋がって描かれ、音符が重なっていない
- 伴奏の和音（`midis` を持つイベント）が楽譜に和音として出る
- MusicXML を書き出して、楽譜作成ソフト（MuseScore など）で開けて、
  タイと和音が壊れていない
- MIDI を書き出して再生し、ブラウザで聴いた曲と同じに聴こえる

- [ ] **Step 5: 通しで聴く**

3〜4曲を最後まで聴き、次を確認する。

- Aメロが薄く、サビで厚くなり、最後が収まる
- ベースの食いがサビで効いている
- フレーズの終わりが伸びて、そのあとに息が入る
- 伴奏が旋律を覆い隠していない

- [ ] **Step 6: コミット**

```bash
git add tools/monotony.js docs/superpowers/specs/
git commit -m "単調さの5指標の計測スクリプトを置き、実測値を仕様書に書き入れる"
```

---

## Task 10: 解説ページの更新と単一HTML版の再生成

**Files:**
- Modify: `algorithm.html`, `algorithm.en.html`, `algorithm.zh.html`
- Modify: `README.md`
- Regenerate: `melody-generator.html`

- [ ] **Step 1: 解説ページに編曲層の節を足す**

`algorithm.html` の「構造層」の説明の**後ろ**に、編曲層の節を1つ足す。
既存の節の書き方（見出し・本文・実測値の提示のしかた）にそのまま合わせること。

節に必ず入れる内容:

1. 初版は伴奏が全曲・全小節で同じ8分アルペジオだったという事実と、その実測値
2. 伴奏型6種とベース型5種、そしてセクションへの割り当て（Aメロは薄く、サビで厚く）
3. 食い——小節の頭の音を半拍前へ出す。初版で小節線をまたぐ音が 0.6% だったこと
4. タイ——フレーズ末を次の音の手前0.5拍まで伸ばす。初版で2拍以上の音が 5.0% だったこと
5. 編曲は `seed + ':arr'` の別の乱数列を使うので、**同じ曲コードから旋律と和声は
   1音も変わらずに出る**こと
6. Task 9 で測った実測値

`algorithm.en.html` と `algorithm.zh.html` にも同じ節を、それぞれの言語で足す。
3ファイルの節の構成と数値は完全に一致させること。

- [ ] **Step 2: README を直す**

「仕組み」の節の二層（断片層・構造層）の説明に、三層目として編曲層を足す。
「ファイル」の節の `src/` の表に `arrange.js` の行を足す。

```
  arrange.js     編曲。伴奏型・ベース型の抽選と、食い・タイ
```

`tools/` の表に `snapshot.js` と `monotony.js` の行を足す。

- [ ] **Step 3: 単一ファイル版を作り直す**

Run: `npm run bundle`
Expected: `melody-generator.html` が更新される

- [ ] **Step 4: 単一ファイル版が動くことを確認する**

`melody-generator.html` をブラウザで直接開き（サーバを通さず）、再生して
編曲が効いていることを確認する。`arrange.js` がバンドルに入っていなければ
`tools/bundle.js` のモジュールの並びを直す。

- [ ] **Step 5: 全件通す**

Run: `npm test`
Expected: `# fail 0`

- [ ] **Step 6: コミット**

```bash
git add algorithm.html algorithm.en.html algorithm.zh.html README.md melody-generator.html
git commit -m "解説ページと README に編曲層を書き、単一HTML版を再生成"
```

---

## 完了の条件

- [ ] `npm test` が `# fail 0`
- [ ] `node --test test/seedcompat.test.js` が通る（旋律の音程が1音も動いていない）
- [ ] `node tools/monotony.js` の5指標が仕様書8.1の目標を満たす。未達の指標は理由が仕様書に書いてある
- [ ] 楽譜にタイが正しく描かれ、MusicXML が楽譜作成ソフトで開ける
- [ ] `melody-generator.html` を直接開いて編曲が効いている
- [ ] 通しで3曲以上聴いて、Aメロ→サビ→着地の起伏が聴き取れる
