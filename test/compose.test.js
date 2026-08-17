import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CHORD_VOCAB, chordIndex, isChordTone, splitBars, fitsBar, hasSuspension, bassMidi,
  chordPitchClasses, degToSemitone,
} from '../src/theory.js';
import { defaultSettings } from '../src/settings.js';
import { makeRng, seedFromString } from '../src/rng.js';
import {
  SECTION_NAMES, climaxSlot, curveFor, rawTension, varyProgression,
  passesFilters, selectFragment, composeSong,
  transposeFragment, deriveFragment, phraseRoles, phraseOffsets, rhythmKey,
  progressionWeight, arpeggioIndex, isDarkChord,
  phrasePlan, phraseEndFlags, soarsToPeak, hasLongEnding, nearestOctave,
  modulatedPeakCap, keyFifths, keyDistance, chooseModulationStep,
  melodyCeiling,
  placeUnder,
  withoutRub,
} from '../src/compose.js';
// 調号の綴り（何番目の五度圏か）は notation.js が持っている。
// compose.js は同じ表を自前で持つので、一致を機械で確かめるために読むだけ読む。
import { keySignature } from '../src/notation.js';

// ---------------------------------------------------------------------------
// フィクスチャ
//
// src/data/melodies.json はまだ存在しないので、断片プールをここで合成する。
// fit / sus は theory.js の判定（isChordTone を土台にした fitsBar / hasSuspension）で
// 実際に計算する。でたらめな添字を埋めるとテストが何も保証しなくなる。
// ---------------------------------------------------------------------------

const FIX_PROGRESSIONS = [
  { id: 'fx-M1', mode: 'major', bars: ['I', 'V', 'vi', 'IV'], cadence: 'open', tension: [1, 4, 2, 2] },
  { id: 'fx-M2', mode: 'major', bars: ['vi', 'IV', 'I', 'V'], cadence: 'open', tension: [2, 2, 1, 4] },
  { id: 'fx-M3', mode: 'major', bars: ['I', 'iii', 'IV', 'V'], cadence: 'open', tension: [1, 3, 2, 4] },
  { id: 'fx-m1', mode: 'minor', bars: ['i', 'VII', 'VI', 'V'], cadence: 'open', tension: [1, 3, 2, 4] },
  { id: 'fx-m2', mode: 'minor', bars: ['i', 'iv', 'VI', 'V'], cadence: 'open', tension: [1, 2, 3, 4] },
  { id: 'fx-m3', mode: 'minor', bars: ['VI', 'III', 'i', 'v'], cadence: 'open', tension: [2, 2, 1, 3] },
].map((p) => ({ ...p, bars: p.bars.map((chord) => ({ chord })) }));

// varyProgression が作りうるコードの上位集合を、テスト側で独立に列挙する。
// （実装に問い合わせずにフィクスチャの網羅範囲を決めるため）
// level ごとの小節並び。level 2 が最後の2小節をまとめて差し替えるので、
// 小節ごとの候補を総当たりすると実際には起きない組み合わせ（iv → IV など）まで
// フィクスチャに要求してしまう。並び単位で列挙する。
function variantBars(prog) {
  const base = prog.bars.map((b) => b.chord);
  const lv1 = base.slice();
  if (lv1.length >= 2 && !lv1[1].includes('/') && chordIndex(prog.mode, `${lv1[1]}/3`) >= 0) {
    lv1[1] = `${lv1[1]}/3`;
  }
  const lv2 = lv1.slice();
  for (const [i, sym] of [[lv2.length - 1, prog.mode === 'major' ? 'I' : 'i'],
    [lv2.length - 2, prog.mode === 'major' ? 'iv' : 'VI']]) {
    if (i >= 0 && chordIndex(prog.mode, sym) >= 0) lv2[i] = sym;
  }
  return [base, lv1, lv2];
}

// スロットが覆う2小節は (0,1) と (2,3) の組み合わせだけ。
function requiredPairs() {
  const seen = new Map();
  for (const p of FIX_PROGRESSIONS) {
    for (const bars of variantBars(p)) {
      for (const [ia, ib] of [[0, 1], [2, 3]]) {
        const chordA = bars[ia];
        const chordB = bars[ib];
        seen.set(`${p.mode}|${chordA}|${chordB}`, { mode: p.mode, chordA, chordB });
      }
    }
  }
  return [...seen.values()];
}

const REQUIRED_PAIRS = requiredPairs();
const CONTOURS = ['arch', 'descend', 'ascend', 'wave', 'question', 'answer'];

const toneMemo = new Map();
function tone(deg, mode, chord) {
  const key = `${deg}|${mode}|${chord}`;
  let v = toneMemo.get(key);
  if (v === undefined) {
    v = isChordTone(deg, mode, chord);
    toneMemo.set(key, v);
  }
  return v;
}

function chordTones(chord, mode, ceiling) {
  const out = [];
  for (let d = 1; d <= ceiling; d++) if (tone(d, mode, chord)) out.push(d);
  return out;
}

// 4分音符4つの小節。fitsBar の規則上 beat 0 と 2 は「露出」するので
// コードトーンか隣接音への解決が要る。beat 1 と 3 は自由に使える。
function makeBar(chord, mode, { first, mid, last, ceiling, flexFirst }) {
  const tones = chordTones(chord, mode, ceiling);
  if (tones.length === 0) return null;
  const nearest = (t) => tones.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), tones[0]);

  let head = first;
  let second;
  if (tone(head, mode, chord)) {
    second = nearest(head + 1);
  } else if (tones.includes(head - 1)) {
    second = head - 1;              // 下行解決＝掛留になる
  } else if (tones.includes(head + 1)) {
    second = head + 1;
  } else if (flexFirst) {
    head = nearest(first);
    second = nearest(head + 1);
  } else {
    return null;                    // この開始音ではこのコードに乗せられない
  }
  return {
    head,
    notes: [
      { deg: head, beat: 0, dur: 1, vel: 0.72 },
      { deg: second, beat: 1, dur: 1, vel: 0.6 },
      { deg: nearest(mid), beat: 2, dur: 1, vel: 0.66 },
      { deg: last, beat: 3, dur: 1, vel: 0.58 },
    ],
  };
}

// どのコードに乗るか・掛留が成立するかを、実際に小節ごとに判定して埋める。
function computeFitSus(notes) {
  const [b0, b1] = splitBars(notes);
  const fit = {};
  const sus = {};
  for (const m of ['major', 'minor']) {
    const f0 = []; const f1 = []; const s0 = []; const s1 = [];
    CHORD_VOCAB[m].forEach((sym, i) => {
      if (fitsBar(b0, m, sym)) {
        f0.push(i);
        if (hasSuspension(b0, m, sym)) s0.push(i);
      }
      if (fitsBar(b1, m, sym)) {
        f1.push(i);
        if (hasSuspension(b1, m, sym)) s1.push(i);
      }
    });
    fit[m] = [f0, f1];
    sus[m] = [s0, s1];
  }
  return { fit, sus };
}

// 頂点音は1小節目の裏拍に1つだけ置き、他の音は必ずそれより低くする。
// これで peakDeg / peakCount が実データと同じ意味を持つ。
function makeFragment(id, mode, chordA, chordB, { start, end, peak, tension, contour }) {
  const ceiling = peak - 1;
  if (start < 1 || end < 1 || start > ceiling || end > ceiling) return null;
  const bar0 = makeBar(chordA, mode, {
    first: start, mid: Math.min(start + 1, ceiling), last: peak, ceiling, flexFirst: false,
  });
  if (!bar0 || bar0.head !== start) return null;
  const bar1 = makeBar(chordB, mode, {
    first: end, mid: end, last: end, ceiling, flexFirst: true,
  });
  if (!bar1) return null;

  const notes = [...bar0.notes, ...bar1.notes.map((n) => ({ ...n, beat: n.beat + 4 }))];
  const degs = notes.map((n) => n.deg);
  const peakDeg = Math.max(...degs);
  const peakCount = degs.filter((d) => d === peakDeg).length;
  if (peakDeg !== peak || peakCount !== 1) return null;

  const { fit, sus } = computeFitSus(notes);
  // 作った意図どおりに乗っていないフィクスチャは混ぜない。
  if (!fit[mode][0].includes(chordIndex(mode, chordA))) return null;
  if (!fit[mode][1].includes(chordIndex(mode, chordB))) return null;

  const lo = Math.min(...degs);
  return {
    id,
    notes,
    startDeg: start,
    endDeg: end,
    contour,
    range: [lo, peakDeg],
    span: peakDeg - lo,
    peakDeg,
    peakBeat: 3,
    peakCount,
    tension,
    density: notes.length / 8,
    tags: [],
    fit,
    sus,
    score: 50 + peakDeg,
  };
}

// peakDeg 6〜14 と tension 2 / 4 を行き渡らせるための追加分。
const SPREAD = [[6, 2], [7, 4], [8, 2], [9, 4], [11, 2], [12, 4], [14, 2]];

function buildFixtureData() {
  const melodies = [];
  const add = (mode, chordA, chordB, spec) => {
    const n = melodies.length;
    const id = `fx${String(n + 1).padStart(4, '0')}`;
    const f = makeFragment(id, mode, chordA, chordB, {
      ...spec, contour: CONTOURS[n % CONTOURS.length],
    });
    if (f) melodies.push(f);
  };

  for (const { mode, chordA, chordB } of REQUIRED_PAIRS) {
    // 主グリッド：頂点用（peak 13）と非頂点用（peak 10）を、
    // 開始音 4〜8 × 緊張度 1/3/5 で全通り用意する。
    for (const peak of [10, 13]) {
      for (const start of [4, 5, 6, 7, 8]) {
        for (const tension of [1, 3, 5]) {
          add(mode, chordA, chordB, { start, end: 4 + ((start + tension) % 5), peak, tension });
        }
      }
    }
    SPREAD.forEach(([peak, tension], i) => {
      const ceiling = peak - 1;
      add(mode, chordA, chordB, {
        start: Math.min(4 + (i % 3), ceiling),
        end: Math.min(4 + ((i + 2) % 3), ceiling),
        peak,
        tension,
      });
    });
  }
  return { melodies, progressions: FIX_PROGRESSIONS };
}

const DATA = buildFixtureData();
const BY_ID = new Map(DATA.melodies.map((m) => [m.id, m]));
const SECTION_LEVELS = [0, 1, 0, 2];
const SEEDS = ['s0', 's1', 's2', 'seed-3', 'seed-4', 'ゆうやけ', 'x9', 'zz', 'a1b2', '0000', 'seed-10', 'seed-11'];

const S = (over = {}) => ({ ...defaultSettings(), ...over });

function slotsPerSection(song) {
  return song.bars / 4 / 2;
}

// 転調のつなぎ目。composeSong は B の最終小節を「新しい調のドミナント」へ差し替える。
// 進行データから小節のコードを復元するときは、実装と同じ差し替えを掛けないと
// 復元した並びが実際に鳴っているものとずれる。
function withPivot(song, sectionIdx, chords) {
  const mod = song.modulation;
  if (!mod || mod.pivotBar === null || mod.pivotBar === undefined) return chords;
  const sec = song.sections[sectionIdx];
  const i = mod.pivotBar - sec.startBar;
  if (i < 0 || i >= chords.length) return chords;
  const out = chords.slice();
  out[i] = mod.pivotChord;
  return out;
}

// セクションが実際に使っている小節ごとのコードを復元する。
function barChordsOf(song, sectionIdx) {
  const sec = song.sections[sectionIdx];
  const base = FIX_PROGRESSIONS.find((p) => p.id === sec.progressionId);
  assert.ok(base, `未知の進行: ${sec.progressionId}`);
  const prog = varyProgression(base, SECTION_LEVELS[sectionIdx]);
  const out = [];
  for (let r = 0; r < song.bars / 4 / 4; r++) for (const b of prog.bars) out.push(b.chord);
  return withPivot(song, sectionIdx, out);
}

// スロットが実際に鳴らした断片を復元する。
// ゼクエンツで作られたスロットは元の断片が残っていないので、記録された offset で
// 同じ移調をやり直して復元する（実装と同じ関数を使う＝同じものが返る）。
function fragmentOf(slot, byId) {
  if (slot.offset === null || slot.offset === undefined) return byId.get(slot.fragmentId) ?? null;
  const base = byId.get(slot.fragmentId.slice(0, slot.fragmentId.lastIndexOf('+')));
  return base ? transposeFragment(base, slot.offset) : null;
}

// 隣接音程の並び。ゼクエンツ（平行移動）なら元とまったく同じになる。
function intervalsOf(fragment) {
  return fragment.notes.slice(1).map((n, i) => n.deg - fragment.notes[i].deg);
}

function allMidis(song) {
  const out = [];
  for (const layer of ['melody', 'accomp', 'bass']) for (const n of song[layer]) out.push(n.midi);
  for (const p of song.pad) for (const m of p.midis) out.push(m);
  return out;
}

// 「無音の小節」は伴奏を含めた**全体**で見る。
// メロディーの1小節の休みは息継ぎで、意図してそこに置いている。
function soundingBars(song) {
  const bars = new Set();
  for (const layer of ['melody', 'accomp', 'bass']) {
    for (const n of song[layer]) bars.add(Math.floor(n.beat / 4));
  }
  for (const p of song.pad) bars.add(Math.floor(p.beat / 4));
  return bars;
}

function melodyBars(song) {
  return new Set(song.melody.map((n) => Math.floor(n.beat / 4)));
}

// 曲全体で鳴っている小節と、メロディーが休んでいる小節を検査する。
// メロディーが休んでよいのは song.breathBar のちょうど1小節だけ。
function assertNoSilentBar(song, label) {
  const sounding = soundingBars(song);
  const withMelody = melodyBars(song);
  for (let bar = 0; bar < song.bars; bar++) {
    assert.ok(sounding.has(bar), `${label}: ${bar}小節目が完全に無音`);
    if (bar === song.breathBar) continue;
    assert.ok(withMelody.has(bar), `${label}: ${bar}小節目にメロディーが無い（息継ぎではない）`);
  }
  if (song.breathBar !== null) {
    assert.equal(withMelody.has(song.breathBar), false,
      `${label}: 息継ぎの小節 ${song.breathBar} にメロディーが残っている`);
  }
  assert.equal(song.bars - withMelody.size, song.breathBar === null ? 0 : 1,
    `${label}: メロディーの休みが息継ぎの1小節を超えている`);
}

// ---------------------------------------------------------------------------
// フィクスチャ自体の健全性（これが崩れると以降のテストが無意味になる）
// ---------------------------------------------------------------------------

test('フィクスチャ: 断片が200件以上あり、輪郭・緊張度・頂点音が散っている', () => {
  assert.ok(DATA.melodies.length >= 200, `断片が少なすぎる: ${DATA.melodies.length}`);
  const contours = new Set(DATA.melodies.map((m) => m.contour));
  for (const c of CONTOURS) assert.ok(contours.has(c), `輪郭が欠けている: ${c}`);
  const tensions = new Set(DATA.melodies.map((m) => m.tension));
  for (const t of [1, 2, 3, 4, 5]) assert.ok(tensions.has(t), `緊張度が欠けている: ${t}`);
  const peaks = [...new Set(DATA.melodies.map((m) => m.peakDeg))].sort((a, b) => a - b);
  assert.ok(peaks[0] <= 6 && peaks[peaks.length - 1] >= 14, `頂点音の散り方が不足: ${peaks}`);
  for (const m of DATA.melodies) {
    assert.equal(m.peakCount, 1);
    assert.equal(m.peakDeg, Math.max(...m.notes.map((n) => n.deg)));
    assert.equal(m.startDeg, m.notes[0].deg);
    assert.equal(m.endDeg, m.notes[m.notes.length - 1].deg);
  }
});

test('フィクスチャ: 曲に出てくるコード対をすべて賄える', () => {
  for (const { mode, chordA, chordB } of REQUIRED_PAIRS) {
    const ia = chordIndex(mode, chordA);
    const ib = chordIndex(mode, chordB);
    const list = DATA.melodies.filter((m) => m.fit[mode][0].includes(ia) && m.fit[mode][1].includes(ib));
    assert.ok(list.length >= 10, `${mode} ${chordA}->${chordB}: 候補 ${list.length}`);
    // 頂点用（12以上・緊張度4以上）と非頂点用（10以下）の両方が要る。
    assert.ok(list.some((m) => m.peakDeg >= 12 && m.tension >= 4), `${mode} ${chordA}->${chordB}: 頂点用が無い`);
    assert.ok(list.some((m) => m.peakDeg <= 10), `${mode} ${chordA}->${chordB}: 非頂点用が無い`);
    // 接続フィルタ（|startDeg - prevEndDeg| <= maxLeap、既定2）が必ず通せるよう、
    // 4〜8 のどの音の隣にも歌い出しがある状態を要求する。
    // 「4〜8 が全部ある」ではないのは、major の iv のように度数6の近くに
    // 構成音を持たないコードがあり、そこは音楽の側の事情で埋まらないため。
    for (const near of [4, 5, 6, 7, 8]) {
      assert.ok(list.some((m) => Math.abs(m.startDeg - near) <= 1),
        `${mode} ${chordA}->${chordB}: 度数 ${near} の隣から始まる断片が無い`);
    }
    assert.ok(new Set(list.map((m) => m.startDeg)).size >= 4,
      `${mode} ${chordA}->${chordB}: 歌い出しの種類が少なすぎる`);
  }
});

// ---------------------------------------------------------------------------
// 1〜2. 決定論性
// ---------------------------------------------------------------------------

test('同じシード・同じ設定なら完全に同じ曲になる', () => {
  for (const seed of SEEDS) {
    for (const bars of ['16', '32', '64']) {
      const cfg = S({ songBars: bars });
      const a = composeSong(seed, DATA, cfg);
      const b = composeSong(seed, DATA, cfg);
      assert.equal(JSON.stringify(a), JSON.stringify(b), `再現しない: ${seed}/${bars}`);
    }
  }
});

test('シードが違えば曲が変わる', () => {
  const seen = new Map();
  for (const seed of SEEDS) {
    const json = JSON.stringify(composeSong(seed, DATA, S()));
    assert.ok(!seen.has(json), `${seed} と ${seen.get(json)} が同じ曲になった`);
    seen.set(json, seed);
  }
});

// ---------------------------------------------------------------------------
// 3〜6. 作曲パラメータ
// ---------------------------------------------------------------------------

test('majorRatio が調を決める', () => {
  for (const seed of SEEDS) {
    assert.equal(composeSong(seed, DATA, S({ majorRatio: 100 })).mode, 'major');
    assert.equal(composeSong(seed, DATA, S({ majorRatio: 0 })).mode, 'minor');
  }
});

test('tempo は指定範囲に収まる', () => {
  for (const [min, max] of [[52, 92], [64, 76], [70, 70]]) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ tempoMin: min, tempoMax: max }));
      assert.ok(Number.isInteger(song.tempo), `整数でない: ${song.tempo}`);
      assert.ok(song.tempo >= min && song.tempo <= max, `範囲外: ${song.tempo}`);
    }
  }
});

test('musicKey の指定がトニックに反映される', () => {
  for (const [key, expected] of [['0', 60], ['6', 66], ['7', 55], ['11', 59]]) {
    const song = composeSong('key-test', DATA, S({ musicKey: key }));
    assert.equal(song.tonicMidi, expected, `key=${key}`);
  }
  for (const seed of SEEDS) {
    const t = composeSong(seed, DATA, S({ musicKey: 'random' })).tonicMidi;
    assert.ok(t >= 56 && t <= 63, `ランダムキーが範囲外: ${t}`);
  }
});

test('songBars ごとに bars と totalBeats が正しい', () => {
  for (const [bars, n] of [['16', 16], ['32', 32], ['64', 64]]) {
    for (const seed of SEEDS.slice(0, 4)) {
      const song = composeSong(seed, DATA, S({ songBars: bars }));
      assert.equal(song.bars, n);
      assert.equal(song.totalBeats, n * 4);
      assert.equal(song.sections[3].startBar + n / 4, n);
    }
  }
});

test('セクションは A / A\' / B / A\'\' の4つ', () => {
  assert.deepEqual(SECTION_NAMES, ['A', "A'", 'B', "A''"]);
  for (const bars of ['16', '32', '64']) {
    const song = composeSong('sections', DATA, S({ songBars: bars }));
    assert.equal(song.sections.length, 4);
    assert.deepEqual(song.sections.map((s) => s.name), SECTION_NAMES);
    assert.deepEqual(song.sections.map((s) => s.startBar), [0, 1, 2, 3].map((i) => (i * song.bars) / 4));
    // A / A' / A'' は同じ進行、B だけ別の進行。
    const ids = song.sections.map((s) => s.progressionId);
    assert.equal(ids[0], ids[1]);
    assert.equal(ids[0], ids[3]);
    assert.notEqual(ids[0], ids[2]);
  }
});

// ---------------------------------------------------------------------------
// 7〜8. スロットと無音
// ---------------------------------------------------------------------------

test('すべてのスロットが断片で埋まっている', () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars }));
      const slots = slotsPerSection(song);
      for (const sec of song.sections) {
        assert.equal(sec.slots.length, slots);
        for (const slot of sec.slots) {
          assert.ok(typeof slot.fragmentId === 'string' && slot.fragmentId.length > 0,
            `空スロット: ${sec.name} ${JSON.stringify(slot)}`);
          // 十分な断片プールを渡しているのでフォールバックは出ないはず。
          assert.notEqual(slot.fragmentId, 'fallback', `${seed}/${sec.name} でフォールバック`);
        }
      }
    }
  }
});

// 「無音の小節が無い」は伴奏・ベース・パッドを含めた全体について検査する。
// メロディーだけが1小節休む「息継ぎ」は歌のためにわざと置いたもので、
// そこも伴奏は鳴り続けている（＝音楽は止まっていない）。
test('無音の小節が1つも無い（伴奏を含めた全体で）', () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars }));
      assertNoSilentBar(song, `${seed}/${bars}`);
      for (const n of song.melody) {
        assert.ok(n.beat >= 0 && n.beat < song.totalBeats, `曲の外に音がある: ${n.beat}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 9. クライマックス
// ---------------------------------------------------------------------------

test('曲中の最高音はただ一度だけ鳴り、B の中にある', () => {
  for (const bars of ['16', '32', '64']) {
    for (const motifRecall of [true, false]) {
      for (const seed of SEEDS) {
        const song = composeSong(seed, DATA, S({ songBars: bars, curveStrength: 100, motifRecall }));
        const top = Math.max(...song.melody.map((n) => n.midi));
        const hits = song.melody.filter((n) => n.midi === top);
        assert.equal(hits.length, 1, `${seed}/${bars}/recall=${motifRecall}: 最高音が${hits.length}回`);
        assert.equal(song.climaxBeat, hits[0].beat);
        const b = song.sections[2];
        const from = b.startBar * 4;
        const to = from + (song.bars / 4) * 4;
        assert.ok(song.climaxBeat >= from && song.climaxBeat < to,
          `${seed}/${bars}: 頂点が B の外 (${song.climaxBeat} ∉ [${from}, ${to}))`);
      }
    }
  }
});

// 実データには最高音が断片内で2回以上鳴るもの（peakCount > 1）が1割弱ある。
// それを頂点に置くと「そこで初めて届いた」音が2回鳴ってしまい、一回性が消える。
test('頂点には、断片内で最高音が2回鳴る断片を選ばない', () => {
  // 既存の高い断片の最高音をもう1つ増やした「双子」を作る。
  // 乗れるコードが元より狭くなった双子は競争相手にならないので混ぜない。
  const covers = (twin, base) => ['major', 'minor'].every(
    (m) => [0, 1].every((b) => base.fit[m][b].every((i) => twin.fit[m][b].includes(i))),
  );
  const twins = [];
  for (const m of DATA.melodies) {
    if (m.peakDeg < 12) continue;
    const notes = m.notes.map((n) => ({ ...n }));
    notes[1] = { ...notes[1], deg: m.peakDeg };
    const { fit, sus } = computeFitSus(notes);
    const twin = { ...m, id: `twin-${m.id}`, notes, fit, sus, peakCount: 2, score: m.score + 1 };
    if (covers(twin, m)) twins.push(twin);
  }
  assert.ok(twins.length >= 20, `双子が少なすぎる: ${twins.length}`);

  // 双子は「peakCount 以外は頂点の条件を満たす」＝素通しなら必ず引かれる存在であること。
  const probe = twins[0];
  const ctx = {
    mode: 'major', chordA: 'I', chordB: 'V',
    chordAIdx: chordIndex('major', 'I'), chordBIdx: chordIndex('major', 'V'),
    prevEndDeg: null, tension: 5, maxPeak: 15, minPeak: 12, maxLeap: 6, preferSus: false,
  };
  const fitting = twins.find((t) => passesFilters(t, { ...ctx, soloPeak: false }, 3));
  assert.ok(fitting, '頂点の条件を満たす双子が無く、検証にならない');
  assert.equal(passesFilters(fitting, { ...ctx, soloPeak: true }, 3), false);

  // 双子のほうが多数派になるよう先に並べる（素通しなら必ず引かれる状況を作る）。
  const data = { melodies: [...twins, ...twins, ...DATA.melodies], progressions: FIX_PROGRESSIONS };
  const byId = new Map(data.melodies.map((m) => [m.id, m]));
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, data, S({ songBars: bars }));
      const slots = slotsPerSection(song);
      const climax = song.sections[2].slots[climaxSlot(slots)];
      const frag = byId.get(climax.fragmentId);
      assert.ok(frag, `断片が見つからない: ${climax.fragmentId}`);
      assert.equal(frag.peakCount, 1, `${seed}/${bars}: 頂点に peakCount=${frag.peakCount} の断片`);
      const top = Math.max(...song.melody.map((n) => n.midi));
      assert.equal(song.melody.filter((n) => n.midi === top).length, 1,
        `${seed}/${bars}: 最高音が複数回鳴っている`);
    }
  }
});

// ---------------------------------------------------------------------------
// 10〜11. 接続とコード適合
// ---------------------------------------------------------------------------

// 接続の滑らかさは「選び直したスロット」の保証。
// ゼクエンツで導出したスロットは、同じ音形を意図して平行移動したものなので、
// そこで生じる跳躍は事故ではなく形の一部。免除する。
test('隣り合うスロットの接続が滑らか（通常選択のスロット）', () => {
  for (const maxLeap of [2, 3]) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ maxLeap, motifRecall: false }));
      const slots = slotsPerSection(song);
      const cs = climaxSlot(slots);
      let prevEnd = null;
      song.sections.forEach((sec, si) => {
        sec.slots.forEach((slot, k) => {
          const frag = fragmentOf(slot, BY_ID);
          assert.ok(frag, `断片が見つからない: ${slot.fragmentId}`);
          const exempt = k === 0 || (si === 2 && k === cs) || slot.derivedFrom !== null;
          if (prevEnd !== null && !exempt) {
            assert.ok(Math.abs(frag.startDeg - prevEnd) <= maxLeap,
              `${seed} ${sec.name}:${k} で跳躍しすぎ (${prevEnd} → ${frag.startDeg})`);
          }
          prevEnd = frag.endDeg;
        });
      });
    }
  }
});

test('選ばれた断片は実際にその小節のコードに乗っている', () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars }));
      song.sections.forEach((sec, si) => {
        const chords = barChordsOf(song, si);
        sec.slots.forEach((slot, k) => {
          const frag = fragmentOf(slot, BY_ID);
          if (!frag) return; // フォールバックは対象外
          const [b0, b1] = splitBars(frag.notes);
          assert.ok(fitsBar(b0, song.mode, chords[2 * k]),
            `${seed} ${sec.name}:${k} 前半が ${chords[2 * k]} に乗っていない`);
          assert.ok(fitsBar(b1, song.mode, chords[2 * k + 1]),
            `${seed} ${sec.name}:${k} 後半が ${chords[2 * k + 1]} に乗っていない`);
        });
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 12〜13. モチーフの再登場
// ---------------------------------------------------------------------------

test('motifRecall が真なら A のモチーフが A\' と A\'\' に帰ってくる', () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars, motifRecall: true }));
      const slots = slotsPerSection(song);
      const head = song.sections[0].slots[0].fragmentId;
      for (const si of [1, 3]) {
        const slot = song.sections[si].slots[0];
        assert.equal(slot.reusedFrom, 'A:0', `${seed} ${song.sections[si].name}:0 が再利用でない`);
        assert.equal(slot.fragmentId, head, `${seed} ${song.sections[si].name}:0 の断片が違う`);
      }
      // A'' の後半にも A の同じ番号のスロットが戻る（スロット番号が同じなら
      // 進行内のコード位置も同じなので、必ず乗る）。
      const reuses = song.sections.flatMap((sec) => sec.slots).filter((sl) => sl.reusedFrom !== null);
      if (slots >= 3) {
        const k = slots - 2;
        const tail = song.sections[3].slots[k];
        assert.equal(tail.reusedFrom, `A:${k}`, `${seed}/${bars}: A''の後半が再利用でない`);
        assert.equal(tail.fragmentId, song.sections[0].slots[k].fragmentId,
          `${seed}/${bars}: A''の後半の断片が違う`);
        assert.equal(reuses.length, 3, `${seed}/${bars}: 再利用が${reuses.length}回`);
      } else {
        // slots===2 では A'' の2つ目の再登場先がスロット0と衝突するので行わない。
        assert.equal(reuses.length, 2, `${seed}/${bars}: 再利用が${reuses.length}回`);
      }
    }
  }
});

test('motifRecall が偽ならどのスロットも再利用しない', () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars, motifRecall: false }));
      for (const sec of song.sections) {
        for (const slot of sec.slots) {
          assert.equal(slot.reusedFrom, null, `${seed} ${sec.name} が再利用されている`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 14. フォールバック
// ---------------------------------------------------------------------------

test('適合する断片が皆無でも例外を投げず、無音の小節も作らない', () => {
  // どのコードにも乗らない断片だけのプール。
  const lonely = {
    id: 'lonely',
    notes: [{ deg: 4, beat: 0, dur: 4, vel: 0.6 }, { deg: 6, beat: 4, dur: 4, vel: 0.6 }],
    startDeg: 4, endDeg: 6, contour: 'wave', range: [4, 6], span: 2,
    peakDeg: 6, peakBeat: 4, peakCount: 1, tension: 3, density: 0.25, tags: [],
    fit: { major: [[], []], minor: [[], []] },
    sus: { major: [[], []], minor: [[], []] },
    score: 0,
  };
  const cases = [
    { melodies: [lonely], progressions: FIX_PROGRESSIONS },
    { melodies: [], progressions: FIX_PROGRESSIONS },
    { melodies: [], progressions: [] },             // 進行も無い
    { melodies: DATA.melodies, progressions: [] },
  ];
  for (const data of cases) {
    for (const bars of ['16', '32', '64']) {
      for (const seed of SEEDS.slice(0, 4)) {
        let song;
        assert.doesNotThrow(() => { song = composeSong(seed, data, S({ songBars: bars })); });
        assertNoSilentBar(song, `${seed}/${bars}`);
        for (const sec of song.sections) {
          for (const slot of sec.slots) assert.ok(slot.fragmentId);
        }
        assert.equal(song.pad.length, song.bars);
        // 完全に同じ入力なら同じ結果になることもここで確認する。
        assert.equal(JSON.stringify(song), JSON.stringify(composeSong(seed, data, S({ songBars: bars }))));
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 15〜18. 起伏カーブと進行の変形（単体）
// ---------------------------------------------------------------------------

test('curveFor: B の頂点だけが最高音域を要求する', () => {
  for (const slots of [2, 4, 8]) {
    const cs = climaxSlot(slots);
    const climax = curveFor(2, cs, slots, 1);
    // 頂点の天井は 15（＝制限なし）ではなく 14。登り（rise）との差を詰めて、
    // 最後の一歩が跳躍ではなく到達に聴こえるようにするため。
    assert.deepEqual(climax, { tension: 5, maxPeak: 14, minPeak: 12 });

    for (let si = 0; si < 4; si++) {
      for (let k = 0; k < slots; k++) {
        const c = curveFor(si, k, slots, 1);
        assert.ok(c.tension >= 1 && c.tension <= 5);
        if (si === 2 && k === cs) continue;
        assert.ok(c.maxPeak <= 11, `セクション${si}:${k} の maxPeak=${c.maxPeak}`);
        assert.equal(c.minPeak, 1);
        // A'' と、B の頂点を過ぎたスロットは着地なので、他より低い天井にする。
        const landing = si === 3 || (si === 2 && k > cs);
        assert.equal(c.maxPeak, landing ? 10 : 11);
      }
    }
    // 起伏を切ったら音高の制約は消える。
    for (let si = 0; si < 4; si++) {
      for (let k = 0; k < slots; k++) {
        assert.deepEqual(curveFor(si, k, slots, 0), { tension: 3, maxPeak: 15, minPeak: 1 });
      }
    }
  }
});

test('curveFor: 緊張度は A→A\'→B と積み上がり A\'\' で解ける', () => {
  const slots = 4;
  const a = [0, 1, 2, 3].map((k) => curveFor(0, k, slots, 1).tension);
  const a2 = [0, 1, 2, 3].map((k) => curveFor(1, k, slots, 1).tension);
  const b = [0, 1, 2, 3].map((k) => curveFor(2, k, slots, 1).tension);
  const a3 = [0, 1, 2, 3].map((k) => curveFor(3, k, slots, 1).tension);
  assert.equal(a[0], 1);
  assert.equal(a[slots - 1], 2);
  assert.equal(a2[0], 2);
  assert.equal(a2[slots - 1], 3);
  assert.equal(Math.max(...b), 5);
  assert.equal(b[climaxSlot(slots)], 5);
  assert.equal(a3[0], 3);
  assert.equal(a3[slots - 1], 1);
});

test('rawTension: 頂点を過ぎたら 3 まで落ちる（脱力の落差）', () => {
  for (const slots of [4, 8]) {
    const cs = climaxSlot(slots);
    assert.equal(rawTension(2, cs, slots), 5, '頂点は5');
    for (let k = cs + 1; k < slots; k++) {
      assert.equal(rawTension(2, k, slots), 3, `B:${k} が頂点のあとも緩んでいない`);
    }
    // 頂点までは登り続ける。
    for (let k = 1; k <= cs; k++) {
      assert.ok(rawTension(2, k, slots) > rawTension(2, k - 1, slots), `B:${k} で登っていない`);
    }
  }
});

test('climaxSlot は終わりの1つ手前を頂点にする', () => {
  assert.equal(climaxSlot(4), 2);
  assert.equal(climaxSlot(2), 1);
  assert.equal(climaxSlot(8), 6);
  assert.equal(climaxSlot(3), 1);
});

test('varyProgression: level 1 は2小節目を第1転回形にする', () => {
  const p = FIX_PROGRESSIONS.find((x) => x.id === 'fx-M1');
  assert.deepEqual(varyProgression(p, 1).bars.map((b) => b.chord), ['I', 'V/3', 'vi', 'IV']);
  // どの進行でも規則は同じ：転回形が語彙にあれば差し替え、無ければ原形を残す。
  // （語彙 CHORD_VOCAB は theory.js 側で増えるので、記号を決め打ちにしない）
  for (const q of FIX_PROGRESSIONS) {
    const base = q.bars.map((b) => b.chord);
    const want = base.slice();
    want[1] = chordIndex(q.mode, `${base[1]}/3`) >= 0 ? `${base[1]}/3` : base[1];
    assert.deepEqual(varyProgression(q, 1).bars.map((b) => b.chord), want, q.id);
    // 1小節目・3小節目・4小節目は触らない。
    for (const i of [0, 2, 3]) assert.equal(varyProgression(q, 1).bars[i].chord, base[i]);
  }
  // 語彙に無い転回形は諦めて原形を残す（語彙の外の記号で規則そのものを確かめる）。
  const alien = { id: 'alien', mode: 'major', bars: [{ chord: 'I' }, { chord: 'bVII' }, { chord: 'IV' }, { chord: 'V' }] };
  assert.equal(chordIndex('major', 'bVII/3') >= 0, false, 'bVII/3 が語彙に入ったので別の記号で試すこと');
  assert.deepEqual(varyProgression(alien, 1).bars.map((b) => b.chord), ['I', 'bVII', 'IV', 'V']);
});

test('varyProgression: level 2 は iv → I（VI → i）のアーメン終止で閉じる', () => {
  // 最終小節は主和音。その1つ前がサブドミナントマイナー。
  // 陰りは落とすが、曲は解決した和音で終わる。
  const p = FIX_PROGRESSIONS.find((x) => x.id === 'fx-M1');
  assert.deepEqual(varyProgression(p, 2).bars.map((b) => b.chord), ['I', 'V/3', 'iv', 'I']);
  const m = FIX_PROGRESSIONS.find((x) => x.id === 'fx-m2');
  assert.deepEqual(varyProgression(m, 2).bars.map((b) => b.chord), ['i', 'iv/3', 'VI', 'i']);
  for (const mode of ['major', 'minor']) {
    assert.ok(chordIndex(mode, mode === 'major' ? 'iv' : 'VI') >= 0);
    assert.ok(chordIndex(mode, mode === 'major' ? 'I' : 'i') >= 0);
  }
  // どの進行でも、level 2 の最終小節は必ず主和音になる。
  for (const prog of FIX_PROGRESSIONS) {
    const bars = varyProgression(prog, 2).bars.map((b) => b.chord);
    assert.equal(bars[bars.length - 1], prog.mode === 'major' ? 'I' : 'i');
    assert.equal(bars[bars.length - 2], prog.mode === 'major' ? 'iv' : 'VI');
  }
});

test('varyProgression: 元の進行を壊さない', () => {
  const p = FIX_PROGRESSIONS.find((x) => x.id === 'fx-M1');
  const before = JSON.parse(JSON.stringify(p));
  const v0 = varyProgression(p, 0);
  assert.deepEqual(v0.bars.map((b) => b.chord), before.bars.map((b) => b.chord));
  assert.notEqual(v0, p);
  assert.notEqual(v0.bars, p.bars);
  // 変形の結果をいじっても原形は無傷。
  v0.bars[0].chord = 'bVII';
  v0.tension[0] = 99;
  varyProgression(p, 1);
  varyProgression(p, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(p)), before);
});

// ---------------------------------------------------------------------------
// 19〜20. 伴奏レイヤーと音域
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 声部の上下関係
// ---------------------------------------------------------------------------

test('melodyCeiling は旋律の最低音より下を返す', () => {
  const melody = [
    { beat: 0, midi: 72, dur: 1 }, { beat: 1, midi: 64, dur: 1 },
    { beat: 4, midi: 80, dur: 1 },
  ];
  assert.equal(melodyCeiling(melody, 0), 62); // 64 - LAYER_GAP(2)
  assert.equal(melodyCeiling(melody, 1), 78);
  // 旋律が休んでいる小節は制限しない
  assert.ok(melodyCeiling(melody, 2) >= 72);
});

test('placeUnder は音名を変えずに天井の下へ収める', () => {
  const chord = [60, 64, 67]; // C E G
  const pcs = (a) => a.map((m) => ((m % 12) + 12) % 12).sort((x, y) => x - y);
  for (const ceiling of [80, 67, 60, 55, 50, 45]) {
    const out = placeUnder(chord, null, 48, 72, ceiling, 36);
    // !!! これが最重要 !!! 半音でずらすと、その和音は別の和音になる
    for (const m of out) {
      assert.ok(pcs(chord).includes(((m % 12) + 12) % 12),
        `天井${ceiling}: 音名が変わった ${m}`);
    }
    assert.ok(out.length >= 2, `天井${ceiling}: 音が減りすぎ`);
    assert.ok(out.every((m, i) => i === 0 || m > out[i - 1]), '昇順でない');
  }
  // 収まるならちゃんと収まる
  assert.ok(Math.max(...placeUnder(chord, null, 48, 72, 60, 36)) <= 60);
});

test('placeUnder は声部進行のために前の小節へ寄せる', () => {
  const chord = [60, 64, 67];
  assert.equal(placeUnder(chord, 48, 48, 72, 99, 36)[0], 48);
  assert.equal(placeUnder(chord, 72, 48, 72, 99, 36)[0], 72);
});

test('withoutRub は旋律と半音でぶつかる持続音だけを落とす', () => {
  // 旋律が C（60）を強拍で歌っているとき、B（59）を伸ばすと唸る
  const melody = [{ beat: 0, midi: 60, dur: 2 }];
  assert.deepEqual(withoutRub([55, 59, 64], melody, 0), [55, 64]);
  // ぶつからないならそのまま
  assert.deepEqual(withoutRub([55, 60, 64], melody, 0), [55, 60, 64]);
  // 2音を切るところまでは削らない（和音が和音でなくなる）
  assert.deepEqual(withoutRub([59, 61], melody, 0), [59, 61]);
  // 弱拍の短い音は対象外（通過音でいちいち和音を削らない）
  assert.deepEqual(withoutRub([59, 64, 67], [{ beat: 1, midi: 60, dur: 0.5 }], 0), [59, 64, 67]);
});

test('実データ: 伴奏とパッドが旋律を追い越さない', () => {
  let notes = 0;
  let crossed = 0;
  for (const seed of ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8']) {
    const song = composeSong(seed, DATA, S({}));
    const under = [
      ...song.accomp.map((n) => ({ midi: n.midi, beat: n.beat, dur: n.dur })),
      ...song.bass.map((n) => ({ midi: n.midi, beat: n.beat, dur: n.dur })),
      ...song.pad.flatMap((p) => p.midis.map((m) => ({ midi: m, beat: p.beat, dur: p.dur }))),
    ];
    for (const m of song.melody) {
      const sounding = under.filter((a) => a.beat <= m.beat && a.beat + a.dur > m.beat);
      if (sounding.length === 0) continue;
      notes++;
      if (Math.max(...sounding.map((a) => a.midi)) > m.midi) crossed++;
    }
  }
  assert.ok(notes > 500, `検査した音が少ない: ${notes}`);
  // 実測 0.02%（8564音中2回、いずれも1半音）。0.5% を超えたら設計が壊れている。
  assert.ok(crossed / notes < 0.005,
    `伴奏が旋律を追い越しすぎ: ${crossed}/${notes}`);
});

test('pad / bass / accomp が全小節ぶん鳴る', () => {
  for (const bars of ['16', '32', '64']) {
    const song = composeSong('layers', DATA, S({ songBars: bars }));
    assert.equal(song.pad.length, song.bars);
    assert.equal(song.bass.length, song.bars);
    // 伴奏は8分音符。1小節8音で左手を途切れさせない。
    // ただし最終小節だけは刻みを止めて和音を置く（＝1イベント）。
    assert.equal(song.accomp.length, (song.bars - 1) * 8 + 1);
    for (let bar = 0; bar < song.bars; bar++) {
      const isFinal = bar === song.bars - 1;
      assert.equal(song.pad[bar].beat, bar * 4);
      assert.equal(song.pad[bar].dur, isFinal ? 6 : 4);
      // パッドは旋律の下へ収めるために上の音を落とすことがある。
      // 和音として成り立つ最低限（2音）は必ず残る。
      assert.ok(song.pad[bar].midis.length >= 2);
      assert.equal(song.bass[bar].beat, bar * 4);
      assert.equal(song.bass[bar].dur, 4);
      const inBar = song.accomp.filter((n) => Math.floor(n.beat / 4) === bar);
      if (isFinal) {
        assert.equal(inBar.length, 1, '最終小節で刻みが止まっていない');
        assert.equal(inBar[0].beat, bar * 4);
        assert.equal(inBar[0].dur, 4);
        assert.ok(inBar[0].midis.length >= 3, '最終小節の伴奏が和音になっていない');
        assert.ok(song.bass[bar].midi < Math.min(...inBar[0].midis));
        continue;
      }
      assert.equal(inBar.length, 8);
      assert.deepEqual(inBar.map((n) => n.beat - bar * 4), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
      // ベースは伴奏より下、伴奏はパッドより下（同じ高さになることはある）。
      // 層が入れ替わると土台が濁る。
      // 同度は許す（左手が根音を重ねる形）。潜らせないことだけを見る。
      assert.ok(song.bass[bar].midi <= Math.min(...inBar.map((n) => n.midi)));
      assert.ok(Math.min(...inBar.map((n) => n.midi)) <= Math.min(...song.pad[bar].midis));
    }
  }
});

// ---------------------------------------------------------------------------
// 声部進行（下降ベース）
//
// theory.js の chordVoicing / bassMidi は和音を1つずつオクターブ正規化するので、
// 単体では正しくても、並べると下降ベースが最初の1歩で7度跳ね上がる。
// 下降ベースはバラードの背骨なので、ここが跳ねると進行そのものが聴こえない。
// ---------------------------------------------------------------------------

test('nearestOctave: 直前の音にいちばん近いオクターブを、範囲の中から選ぶ', () => {
  // 47 は 35 のほうが 36 に近い（|35-36|=1 < |47-36|=11）。
  assert.equal(nearestOctave(47, 36, [28, 55]), 35);
  // 同点なら低いほうを採る（30 と 42 はどちらも 36 から6半音）。
  assert.equal(nearestOctave(42, 36, [28, 55]), 30);
  assert.equal(nearestOctave(48, 42, [28, 55]), 36);
  // 同点でなければ純粋に近いほう。
  assert.equal(nearestOctave(42, 48, [28, 55]), 42);
  assert.equal(nearestOctave(48, 38, [28, 55]), 36);
  assert.equal(nearestOctave(48, 50, [28, 55]), 48);
  assert.equal(nearestOctave(36, 50, [28, 55]), 48);
  // 範囲の外へは出さない（下がり続けて張り付かないよう止める）。
  for (const prev of [28, 30, 55]) {
    for (const midi of [36, 40, 47]) {
      const v = nearestOctave(midi, prev, [28, 55]);
      assert.ok(v >= 28 && v <= 55, `範囲外: ${v}`);
      assert.equal(((v - midi) % 12 + 12) % 12, 0, 'オクターブ以外の移動をした');
    }
  }
  // 曲の1小節目（prev が無い）は正規化された値をそのまま使う。
  assert.equal(nearestOctave(36, null, [28, 55]), 36);
  assert.equal(nearestOctave(47, undefined, [28, 55]), 47);
});

// 下降ベースの進行だけを持つデータ。狙いは I - V/3 - vi - I/5 の順次下降。
const DESC_PROG = {
  id: 'fx-desc',
  mode: 'major',
  bars: [{ chord: 'I' }, { chord: 'V/3' }, { chord: 'vi' }, { chord: 'I/5' }],
  cadence: 'open',
  tension: [1, 2, 2, 3],
  popularity: 5,
};

test('I - V/3 - vi - I/5 のベースが4小節にわたって単調非増加', () => {
  for (const sym of ['I', 'V/3', 'vi', 'I/5']) {
    assert.ok(chordIndex('major', sym) >= 0, `語彙に無い: ${sym}`);
  }
  const data = { melodies: DATA.melodies, progressions: [DESC_PROG] };
  for (const seed of SEEDS) {
    const song = composeSong(seed, data, S({ songBars: '16', majorRatio: 100 }));
    // A（level 0）は進行そのまま。ここが下降ベースの本体。
    const line = song.bass.slice(0, 4).map((n) => n.midi);
    for (let i = 1; i < line.length; i++) {
      assert.ok(line[i] <= line[i - 1], `${seed}: ベースが上がった ${line.join(' → ')}`);
    }
    // 半音・全音でじわじわ下がること（オクターブ跳躍で「下降」に見せかけていない）。
    for (let i = 1; i < line.length; i++) {
      assert.ok(line[i - 1] - line[i] <= 4, `${seed}: 下降の1歩が大きすぎる ${line.join(' → ')}`);
    }
    for (const m of allMidis(song)) assert.ok(m >= 21 && m <= 108, `音域外: ${m}`);
  }
});

// 修正前（各和音を独立に正規化したときの並び）を、テスト側で独立に再現する。
function rawBassLine(song, chordsOf) {
  const out = [];
  song.sections.forEach((sec, si) => {
    // 主音はセクションごと（転調した A'' と、つなぎ目の小節だけ新しい主音）。
    const mod = song.modulation;
    chordsOf(song, si).forEach((chord, b) => {
      const bar = sec.startBar + b;
      const tonic = mod && bar >= (mod.pivotBar ?? mod.atBar) ? mod.toTonicMidi : song.tonicMidi;
      out.push(bassMidi(chord, song.mode, tonic, 36));
    });
  });
  return out;
}

function meanStep(line) {
  let sum = 0;
  for (let i = 1; i < line.length; i++) sum += Math.abs(line[i] - line[i - 1]);
  return sum / (line.length - 1);
}

test('隣り合う小節のベースと伴奏が跳ね回らない（合成フィクスチャ）', () => {
  let after = 0;
  let before = 0;
  let accomp = 0;
  let songs = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars }));
      songs++;
      after += meanStep(song.bass.map((n) => n.midi));
      before += meanStep(rawBassLine(song, barChordsOf));
      const lows = [];
      for (let bar = 0; bar < song.bars; bar++) {
        const inBar = song.accomp.filter((n) => Math.floor(n.beat / 4) === bar);
        lows.push(Math.min(...inBar.map((n) => n.midi)));
      }
      accomp += meanStep(lows);
    }
  }
  const show = `修正後 ${(after / songs).toFixed(2)} / 修正前 ${(before / songs).toFixed(2)}`
    + ` / 伴奏 ${(accomp / songs).toFixed(2)} 半音`;
  assert.ok(after / songs <= 7, `ベースが跳ね回っている: ${show}`);
  assert.ok(accomp / songs <= 7, `伴奏が跳ね回っている: ${show}`);
  assert.ok(after / songs < before / songs, `正規化したままと変わらない: ${show}`);
});

test('すべての音がピアノの音域（21〜108）に収まる', () => {
  for (const key of ['random', '0', '6', '7', '11']) {
    for (const bars of ['16', '32', '64']) {
      for (const seed of SEEDS.slice(0, 6)) {
        const song = composeSong(seed, DATA, S({ songBars: bars, musicKey: key }));
        for (const midi of allMidis(song)) {
          assert.ok(Number.isFinite(midi) && midi >= 21 && midi <= 108, `音域外: ${midi}`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 公開している選択ロジックの単体確認
// ---------------------------------------------------------------------------

test('passesFilters: 緩めてよいのは接続と緊張度だけ', () => {
  const ctx = {
    mode: 'major',
    chordA: 'I', chordB: 'V',
    chordAIdx: chordIndex('major', 'I'), chordBIdx: chordIndex('major', 'V'),
    prevEndDeg: 5, tension: 3, maxPeak: 11, minPeak: 1, maxLeap: 2, preferSus: false,
  };
  const base = DATA.melodies.find((m) => passesFilters(m, ctx, 3));
  assert.ok(base, 'level 3 を通る断片が無い');

  // 接続と緊張度は、候補が枯れたときに緩む。
  const leaper = { ...base, startDeg: base.startDeg + 9 };
  assert.equal(passesFilters(leaper, ctx, 1), true);
  assert.equal(passesFilters(leaper, ctx, 2), false);

  const tooTense = { ...base, tension: 5 };
  assert.equal(passesFilters(tooTense, ctx, 2), true);
  assert.equal(passesFilters(tooTense, ctx, 3), false);

  // コード適合と音高の窓は、どのレベルまで落ちても死守する。
  const wrongChord = { ...base, fit: { major: [[], []], minor: [[], []] } };
  for (const level of [1, 2, 3]) assert.equal(passesFilters(wrongChord, ctx, level), false);

  const tooHigh = { ...base, peakDeg: 14 };
  for (const level of [1, 2, 3]) {
    assert.equal(passesFilters(tooHigh, ctx, level), false, `level ${level} で天井が抜けた`);
  }

  // 頂点のスロット（下限12・最高音が1回だけ）も同じく死守する。
  const climaxCtx = { ...ctx, minPeak: 12, maxPeak: 15, tension: 5, soloPeak: true };
  const tooLow = { ...base, peakDeg: 9, tension: 5 };
  for (const level of [1, 2, 3]) {
    assert.equal(passesFilters(tooLow, climaxCtx, level), false, `level ${level} で下限が抜けた`);
  }
  const twinPeak = { ...base, peakDeg: 13, peakCount: 2, tension: 5 };
  for (const level of [1, 2, 3]) {
    assert.equal(passesFilters(twinPeak, climaxCtx, level), false, `level ${level} で二度打ちが通った`);
  }
  assert.equal(passesFilters({ ...twinPeak, peakCount: 1 }, climaxCtx, 3), true);
});

test('selectFragment: 候補が無ければ2小節を埋めるフォールバックを返す', () => {
  const ctx = {
    mode: 'minor',
    chordA: 'i', chordB: 'V',
    chordAIdx: chordIndex('minor', 'i'), chordBIdx: chordIndex('minor', 'V'),
    prevEndDeg: null, tension: 3, maxPeak: 11, minPeak: 1, maxLeap: 2, preferSus: false,
  };
  const rng = () => 0.5;
  const f = selectFragment(rng, [], ctx);
  assert.equal(f.id, 'fallback');
  assert.equal(f.notes.length, 2);
  assert.deepEqual(f.notes.map((n) => n.beat), [0, 4]);
  assert.ok(isChordTone(f.notes[0].deg, 'minor', 'i'));
  assert.ok(isChordTone(f.notes[1].deg, 'minor', 'V'));
  assert.equal(f.startDeg, f.notes[0].deg);
  assert.equal(f.endDeg, f.notes[1].deg);
});

test('selectFragment: 頂点の直前では掛留のある断片を優先する', () => {
  const mode = 'major';
  const chordA = 'I';
  const chordB = 'V';
  const ia = chordIndex(mode, chordA);
  const ib = chordIndex(mode, chordB);
  const ctx = {
    mode, chordA, chordB, chordAIdx: ia, chordBIdx: ib,
    prevEndDeg: null, tension: 3, maxPeak: 15, minPeak: 1, maxLeap: 6, preferSus: true,
  };
  const pool = DATA.melodies.filter((m) => passesFilters(m, ctx, 3));
  const withSus = pool.filter((m) => m.sus[mode][0].includes(ia) || m.sus[mode][1].includes(ib));
  assert.ok(withSus.length > 0, 'フィクスチャに掛留のある断片が無い');
  assert.ok(withSus.length < pool.length, '掛留が全候補を占めていて優先の検証にならない');
  for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
    const picked = selectFragment(() => r, DATA.melodies, ctx);
    assert.ok(withSus.some((m) => m.id === picked.id), `掛留でない断片が選ばれた: ${picked.id}`);
  }
});

// ---------------------------------------------------------------------------
// 楽節構造（a - a' - b - a''）
//
// 無関係な断片を4つ並べても「ランダムな音程の列」にしか聴こえない。
// 旋律が旋律に聴こえるのは、同じ形が少しずつ姿を変えて戻ってくるから。
// ---------------------------------------------------------------------------

test('phraseRoles: スロット数ごとの役割', () => {
  assert.deepEqual(phraseRoles(2).map((r) => r.name), ['a', "a'"]);
  assert.deepEqual(phraseRoles(4).map((r) => r.name), ['a', "a'", 'b', "a''"]);
  assert.deepEqual(phraseRoles(8).map((r) => r.name),
    ['a', "a'", 'b', "a''", 'a', "a'", 'b', "a''"]);
  // 導出するのは a' と a'' だけ。導出元は同じ楽節の a。
  assert.deepEqual(phraseRoles(8).map((r) => r.derive),
    [false, true, false, true, false, true, false, true]);
  assert.deepEqual(phraseRoles(8).map((r) => r.anchor), [null, 0, 0, 0, null, 4, 4, 4]);
  assert.deepEqual(phraseRoles(2).map((r) => r.anchor), [null, 0]);
});

test('transposeFragment: リズムを保ったままスケール度数を平行移動する', () => {
  const src = DATA.melodies.find((m) => m.peakDeg <= 10);
  assert.ok(src, '素材が無い');
  const moved = transposeFragment(src, 2);
  assert.ok(moved);
  assert.equal(moved.notes.length, src.notes.length);
  assert.deepEqual(moved.notes.map((n) => n.deg), src.notes.map((n) => n.deg + 2));
  // リズムは完全に同じ
  assert.equal(rhythmKey(moved), rhythmKey(src));
  assert.deepEqual(moved.notes.map((n) => n.vel), src.notes.map((n) => n.vel));
  // 音形（隣接音程の並び）も完全に同じ
  assert.deepEqual(intervalsOf(moved), intervalsOf(src));
  // 再計算されるフィールド
  assert.equal(moved.startDeg, src.startDeg + 2);
  assert.equal(moved.endDeg, src.endDeg + 2);
  assert.equal(moved.peakDeg, src.peakDeg + 2);
  assert.equal(moved.peakCount, src.peakCount);
  assert.deepEqual(moved.range, [src.range[0] + 2, src.range[1] + 2]);
  assert.equal(moved.span, src.span);
  assert.equal(moved.contour, src.contour);
  assert.equal(moved.tension, src.tension);
  assert.match(moved.id, /\+2$/);
  // offset 0 は元と同じ音
  assert.deepEqual(transposeFragment(src, 0).notes.map((n) => n.deg), src.notes.map((n) => n.deg));
  // 元の断片は無傷
  assert.equal(src.id.includes('+'), false);

  // 1〜15 に収まらない offset は不採用（クランプで音形が潰れるため）
  assert.equal(transposeFragment(src, 20), null);
  assert.equal(transposeFragment(src, -20), null);
  assert.equal(transposeFragment({ id: 'x', notes: [] }, 1), null);
});

test('deriveFragment: コードに乗る平行移動を選び、音高の窓も守る', () => {
  const mode = 'major';
  const ctx = {
    mode, chordA: 'I', chordB: 'V',
    chordAIdx: chordIndex(mode, 'I'), chordBIdx: chordIndex(mode, 'V'),
    maxPeak: 11, minPeak: 1,
  };
  const anchor = DATA.melodies.find((m) => m.peakDeg <= 9);
  const got = deriveFragment(anchor, ctx);
  assert.ok(got, '導出できる断片が1つも無い');
  assert.ok(Number.isInteger(got.offset));
  // 実際にコードへ乗っていること（fit の添字ではなく再計算で確かめる）
  const [b0, b1] = splitBars(got.fragment.notes);
  assert.ok(fitsBar(b0, mode, 'I'), '前半が I に乗っていない');
  assert.ok(fitsBar(b1, mode, 'V'), '後半が V に乗っていない');
  assert.ok(got.fragment.peakDeg <= 11, '音高の窓を超えた');

  // 窓を閉じきれば導出できない
  assert.equal(deriveFragment(anchor, { ...ctx, maxPeak: 0 }), null);
  // 乗りようのないコードでも null（例外を投げない）
  assert.equal(deriveFragment(null, ctx), null);

  // exclude した offset は使わない
  const again = deriveFragment(anchor, ctx, { exclude: got.offset });
  if (again) assert.notEqual(again.offset, got.offset);
});

// フィクスチャは4分音符4つの断片ばかりなので、リズム一致の代替は必ず見つかる。
// 実データでの割合は下の実データ統合テストで測る。
test('セクション内が a - a\' - b - a\'\' の楽節になっている', () => {
  let derived = 0;
  let total = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars, motifRecall: false }));
      const slots = slotsPerSection(song);
      const cs = climaxSlot(slots);
      const roles = phraseRoles(slots);
      song.sections.forEach((sec, si) => {
        assert.deepEqual(sec.slots.map((sl) => sl.role), roles.map((r) => r.name));
        sec.slots.forEach((slot, k) => {
          // クライマックスは楽節構造より音高の条件が優先。導出しない。
          if (si === 2 && k === cs) {
            assert.equal(slot.derivedFrom, null, 'クライマックスで導出している');
            return;
          }
          if (!roles[k].derive) {
            assert.equal(slot.derivedFrom, null, `${sec.name}:${k} は導出しないスロット`);
            return;
          }
          total++;
          if (slot.derivedFrom !== null) {
            assert.equal(slot.derivedFrom, roles[k].anchor);
            derived++;
          }
        });
      });
    }
  }
  assert.ok(total > 0);
  assert.ok(derived / total >= 0.95, `導出された割合が低い: ${(100 * derived / total).toFixed(1)}%`);
});

test('ゼクエンツは a とリズムも音形も完全に一致する', () => {
  let checked = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars, motifRecall: false }));
      song.sections.forEach((sec) => {
        sec.slots.forEach((slot) => {
          if (slot.offset === null || slot.offset === undefined) return;
          const anchor = fragmentOf(sec.slots[slot.derivedFrom], BY_ID);
          const frag = fragmentOf(slot, BY_ID);
          assert.ok(anchor && frag);
          assert.equal(rhythmKey(frag), rhythmKey(anchor),
            `${seed} ${sec.name}: リズムが違う`);
          assert.deepEqual(intervalsOf(frag), intervalsOf(anchor),
            `${seed} ${sec.name}: 音形が違う`);
          assert.deepEqual(frag.notes.map((n) => n.deg),
            anchor.notes.map((n) => n.deg + slot.offset));
          checked++;
        });
      });
    }
  }
  assert.ok(checked > 0, 'ゼクエンツが1件も作られていない');
});

test('導出した断片も、実際にそのスロットのコードに乗っている', () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars }));
      song.sections.forEach((sec, si) => {
        const chords = barChordsOf(song, si);
        sec.slots.forEach((slot, k) => {
          if (slot.derivedFrom === null) return;
          const frag = fragmentOf(slot, BY_ID);
          assert.ok(frag, `断片が復元できない: ${slot.fragmentId}`);
          const [b0, b1] = splitBars(frag.notes);
          assert.ok(fitsBar(b0, song.mode, chords[2 * k]),
            `${seed} ${sec.name}:${k} 導出の前半が ${chords[2 * k]} に乗っていない`);
          assert.ok(fitsBar(b1, song.mode, chords[2 * k + 1]),
            `${seed} ${sec.name}:${k} 導出の後半が ${chords[2 * k + 1]} に乗っていない`);
        });
      });
    }
  }
});

test('b は a と違う輪郭で対比を作る', () => {
  let contrast = 0;
  let total = 0;
  for (const bars of ['32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars, motifRecall: false }));
      song.sections.forEach((sec) => {
        for (let k = 2; k < sec.slots.length; k += 4) {
          const a = fragmentOf(sec.slots[k - 2], BY_ID);
          const b = fragmentOf(sec.slots[k], BY_ID);
          if (!a || !b) continue;
          total++;
          if (a.contour !== b.contour) contrast++;
        }
      });
    }
  }
  assert.ok(total > 0);
  assert.ok(contrast / total >= 0.7, `対比が少なすぎる: ${(100 * contrast / total).toFixed(1)}%`);
});

// ---------------------------------------------------------------------------
// ゼクエンツの方向 / 終止の重み / 陰りの和音（単体）
// ---------------------------------------------------------------------------

test('phraseOffsets: セクションと役割ごとに向きのある優先順を返す', () => {
  // A は静かに提示して少しだけ上げ、A' と B は上げ、A'' は下げて収める。
  assert.deepEqual(phraseOffsets(0, "a'"), [1, 2, -1, 3, -2, 0]);
  assert.deepEqual(phraseOffsets(0, "a''"), [1, 2, 3, -1, -2, 0]);
  assert.deepEqual(phraseOffsets(1, "a'"), [1, 2, 3, -1, 0]);
  assert.deepEqual(phraseOffsets(1, "a''"), [2, 3, 1, -1, 0]);
  assert.deepEqual(phraseOffsets(2, "a'"), [2, 3, 1, 4, 0]);
  assert.deepEqual(phraseOffsets(2, "a''"), [3, 4, 2, 1, 0]);
  assert.deepEqual(phraseOffsets(3, "a'"), [-1, -2, 1, -3, 0]);
  assert.deepEqual(phraseOffsets(3, "a''"), [-2, -3, -1, -4, 0]);

  // 移動量 0 は「平行移動しない」＝ a をそのまま繰り返すことで、ゼクエンツではない。
  // どのセクションでも先頭に置かない（置くと a' が a の完全なコピーになる）。
  for (const si of [0, 1, 2, 3]) {
    for (const role of ["a'", "a''"]) {
      const o = phraseOffsets(si, role);
      assert.notEqual(o[0], 0, `セクション${si} の ${role} が 0 で始まっている`);
      assert.equal(o[o.length - 1], 0, `セクション${si} の ${role} の最後が 0 でない`);
    }
  }

  // 先頭の向きが A ≦ A' ≦ B と上がり、A'' だけ下がる。
  for (const role of ["a'", "a''"]) {
    const head = [0, 1, 2, 3].map((s) => phraseOffsets(s, role)[0]);
    assert.ok(head[0] <= head[1], `${role}: A の出だしが A' より上`);
    assert.ok(head[1] < head[2], `${role}: A' の出だしが B より上`);
    assert.ok(head[3] <= 0, `${role}: A'' が下降で始まっていない`);
    // 平均も同じ向きに並ぶ（先頭だけでなく表全体が上げ／下げになっている）。
    const avg = [0, 1, 2, 3].map((s) => {
      const o = phraseOffsets(s, role);
      return o.reduce((a, b) => a + b, 0) / o.length;
    });
    assert.ok(avg[0] < avg[1] && avg[1] < avg[2], `${role}: 表の平均が A<A'<B でない`);
    assert.ok(avg[3] < 0, `${role}: A'' の表の平均が負でない`);
  }
  // 表に無い組み合わせでも落ちない。
  assert.ok(Array.isArray(phraseOffsets(0, 'a')));
  assert.ok(Array.isArray(phraseOffsets(9, "a'")));
});

test('deriveFragment: 終止条件を満たす平行移動量を前に出す', () => {
  const mode = 'major';
  const ctx = {
    mode, chordA: 'I', chordB: 'V',
    chordAIdx: chordIndex(mode, 'I'), chordBIdx: chordIndex(mode, 'V'),
    maxPeak: 15, minPeak: 1,
  };
  const sd = (d) => ((((d - 1) % 7) + 7) % 7) + 1;
  // 乗る量が2つ以上ある断片を探し、その中で「終止で並べ替えると別の量が来る」例を見る。
  let checked = 0;
  for (const anchor of DATA.melodies) {
    const accepted = [];
    for (const o of [0, -1, 1, -2, 2, -3, 3]) {
      const got = deriveFragment(anchor, ctx, { offsets: [o] });
      if (got) accepted.push(got);
    }
    if (accepted.length < 2) continue;
    const offsets = accepted.map((a) => a.offset);
    const wanted = accepted.filter((a) => sd(a.fragment.endDeg) === 1);
    if (wanted.length === 0 || sd(accepted[0].fragment.endDeg) === 1) continue;
    // 素の順（終止指定なし）では先頭が選ばれる。
    const plain = deriveFragment(anchor, ctx, { offsets });
    assert.equal(plain.offset, accepted[0].offset);
    // トニックを第1段に指定すると、トニックで終われる量が前に出る。
    const closed = deriveFragment(anchor, ctx, { offsets, endDegrees: [[1], [3, 5]] });
    assert.equal(sd(closed.fragment.endDeg), 1, `${anchor.id}: トニックで閉じていない`);
    checked++;
    if (checked >= 5) break;
  }
  assert.ok(checked > 0, '終止で並べ替わる例が1つも無く、検証になっていない');

  // どの段にも当たらなければ元の優先順のまま（＝必須ではない）。
  const anchor = DATA.melodies.find((m) => deriveFragment(m, ctx, { offsets: [0, 1, 2] }));
  const none = deriveFragment(anchor, ctx, { offsets: [0, 1, 2], endDegrees: [[]] });
  const bare = deriveFragment(anchor, ctx, { offsets: [0, 1, 2] });
  assert.equal(none.offset, bare.offset);
});

test('selectFragment: 役割ごとに終止音の好みが変わり、空なら絞らない', () => {
  const mode = 'major';
  const ctx = {
    mode, chordA: 'I', chordB: 'V', chordAIdx: chordIndex(mode, 'I'), chordBIdx: chordIndex(mode, 'V'),
    prevEndDeg: null, tension: 3, maxPeak: 15, minPeak: 1, maxLeap: 6,
  };
  const sd = (d) => ((((d - 1) % 7) + 7) % 7) + 1;
  const pool = DATA.melodies.filter((m) => passesFilters(m, ctx, 3));
  assert.ok(pool.length > 5);
  const ends = new Set(pool.map((m) => sd(m.endDeg)));
  assert.ok(ends.has(1) && ends.size > 1, 'プールの終止音が偏っていて検証にならない');

  for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
    // a / b は「問いかけて開いたまま」＝トニック以外
    const open = selectFragment(() => r, pool, { ...ctx, endDegrees: [[2, 3, 4, 5, 6, 7]] });
    assert.notEqual(sd(open.endDeg), 1, `開いた終止のはずが主音: ${open.id}`);
    // a'' は「完全に閉じる」＝主音
    const closed = selectFragment(() => r, pool, { ...ctx, endDegrees: [[1], [3, 5]] });
    assert.equal(sd(closed.endDeg), 1, `閉じた終止のはずが主音でない: ${closed.id}`);
  }
  // 第1段が空なら第2段へ落ちる。
  const noTonic = pool.filter((m) => sd(m.endDeg) !== 1);
  const tier2 = selectFragment(() => 0.5, noTonic, { ...ctx, endDegrees: [[1], [3, 5]] });
  assert.ok([3, 5].includes(sd(tier2.endDeg)), `第2段に落ちていない: ${tier2.id}`);
  // どの段にも該当が無ければ絞らない（候補が消えて例外になったりしない）。
  const impossible = selectFragment(() => 0.5, pool, { ...ctx, endDegrees: [[], []] });
  assert.equal(impossible.id, selectFragment(() => 0.5, pool, ctx).id);
});

test('isDarkChord: iv / bVI / bVII だけを陰りとみなす', () => {
  for (const sym of ['iv', 'iv7', 'iv/3', 'bVI', 'bVI/3', 'bVII', 'bVIIM7']) {
    assert.equal(isDarkChord(sym), true, `${sym} が陰りに入っていない`);
  }
  for (const sym of ['I', 'i', 'i7', 'IV', 'IVM7', 'V', 'V7', 'vi', 'VI', 'VII', 'III', '', null]) {
    assert.equal(isDarkChord(sym), false, `${sym} を陰りと誤判定`);
  }
});

test('selectFragment: 陰りの和音では掛留がペンタトニックより先に掛かる', () => {
  const mode = 'major';
  const ia = chordIndex(mode, 'iv');
  const ib = chordIndex(mode, 'I');
  const ctx = {
    mode, chordA: 'iv', chordB: 'I', chordAIdx: ia, chordBIdx: ib,
    prevEndDeg: null, tension: 3, maxPeak: 15, minPeak: 1, maxLeap: 6,
  };
  const base = DATA.melodies.filter((m) => passesFilters(m, ctx, 3));
  const susOf = (m) => m.sus[mode][0].includes(ia) || m.sus[mode][1].includes(ib);
  // 掛留を持つ断片には「ペンタでない」札を、持たない断片にはペンタの札を貼る。
  // ＝ ペンタ優先が先に掛かると掛留が全滅する、意地の悪いプール。
  const pool = base.map((m) => ({ ...m, tags: susOf(m) ? [] : ['penta-major'] }));
  assert.ok(pool.some(susOf), '掛留を持つ断片が無く、検証にならない');
  assert.ok(pool.some((m) => m.tags.length > 0), 'ペンタの断片が無く、検証にならない');
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const dark = selectFragment(() => r, pool, {
      ...ctx, preferPenta: true, preferSus: true, susOverPenta: true,
    });
    assert.ok(susOf(dark), `陰りの和音で掛留でない断片が選ばれた: ${dark.id}`);
    // 陰りでないスロットは従来どおりペンタ優先が先。
    const bright = selectFragment(() => r, pool, { ...ctx, preferPenta: true, preferSus: true });
    assert.ok(bright.tags.includes('penta-major'), `非ペンタが選ばれた: ${bright.id}`);
  }
});

// ---------------------------------------------------------------------------
// 人気度による重み付け抽選
// ---------------------------------------------------------------------------

test('progressionWeight: 人気度の2乗。欠けていたら真ん中(3)として扱う', () => {
  for (const [pop, w] of [[1, 1], [2, 4], [3, 9], [4, 16], [5, 25]]) {
    assert.equal(progressionWeight({ popularity: pop }), w);
  }
  assert.equal(progressionWeight({}), 9);
  assert.equal(progressionWeight({ popularity: 'x' }), 9);
  assert.equal(progressionWeight({ popularity: 99 }), 25);
  assert.equal(progressionWeight({ popularity: -5 }), 1);
});

test('人気度の高い進行のほうが多く選ばれる', () => {
  // 同じ進行を「人気5」と「人気1」の2つに複製して、どちらが引かれるかを数える。
  // 重み 25 対 1 なので、人気側が圧倒的多数になるはず。
  const data = {
    melodies: DATA.melodies,
    progressions: [
      ...FIX_PROGRESSIONS.map((p) => ({ ...p, id: `${p.id}-hi`, popularity: 5 })),
      ...FIX_PROGRESSIONS.map((p) => ({ ...p, id: `${p.id}-lo`, popularity: 1 })),
    ],
  };
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < 1000; i++) {
    const song = composeSong(`w-${i}`, data, S());
    for (const si of [0, 2]) {
      if (song.sections[si].progressionId.endsWith('-hi')) hi++; else lo++;
    }
  }
  const share = hi / (hi + lo);
  assert.ok(share >= 0.85, `人気進行の採用率が低い: ${(100 * share).toFixed(1)}%`);
  // フィルタではなく重み付けであること（人気の低い進行も出番はある）。
  assert.ok(lo > 0, '人気の低い進行が一度も選ばれていない');
});

// ---------------------------------------------------------------------------
// ペンタトニック優先
// ---------------------------------------------------------------------------

const PENTA_TAG = { major: 'penta-major', minor: 'penta-minor' };

// 主グリッド（緊張度 1/3/5）にだけタグを付ける。
// 非クライマックスのスロットは主グリッドから必ず選べるので、
// 優先が効いていればタグ付きしか選ばれない。
function pentaData() {
  return {
    melodies: DATA.melodies.map((m) => (m.tension % 2 === 1
      ? { ...m, tags: [PENTA_TAG.major, PENTA_TAG.minor] }
      : m)),
    progressions: FIX_PROGRESSIONS,
  };
}

test('ペンタトニックの断片が優先され、クライマックスでは優先しない', () => {
  const data = pentaData();
  const byId = new Map(data.melodies.map((m) => [m.id, m]));
  const tagged = data.melodies.filter((m) => m.tags.length > 0);
  assert.ok(tagged.length > 0 && tagged.length < data.melodies.length,
    'タグ付きが全件または0件では検証にならない');

  let climaxNonPenta = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, data, S({ songBars: bars, motifRecall: false }));
      const slots = slotsPerSection(song);
      const cs = climaxSlot(slots);
      song.sections.forEach((sec, si) => {
        sec.slots.forEach((slot, k) => {
          // 通常選択のスロットだけが対象（導出は元のタグを引き継ぐ・引き剥がすため）。
          if (slot.source !== 'select') return;
          const frag = byId.get(slot.fragmentId);
          assert.ok(frag, `断片が見つからない: ${slot.fragmentId}`);
          const penta = (frag.tags ?? []).includes(PENTA_TAG[song.mode]);
          if (si === 2 && k === cs) {
            if (!penta) climaxNonPenta++;
            return;
          }
          assert.ok(penta, `${seed}/${bars} ${sec.name}:${k} が非ペンタ (${frag.id})`);
        });
      });
    }
  }
  assert.ok(climaxNonPenta > 0,
    'クライマックスでもペンタトニックが強制されている（頂点は音域が最優先のはず）');
});

test('selectFragment: preferPenta はモードに合うタグだけを見る', () => {
  const mode = 'major';
  const ctx = {
    mode, chordA: 'I', chordB: 'V',
    chordAIdx: chordIndex(mode, 'I'), chordBIdx: chordIndex(mode, 'V'),
    prevEndDeg: null, tension: 3, maxPeak: 15, minPeak: 1, maxLeap: 6,
  };
  const base = DATA.melodies.filter((m) => passesFilters(m, ctx, 3));
  assert.ok(base.length >= 4);
  // 半分に penta-major、残りに penta-minor（＝長調では効かないタグ）を付ける。
  const pool = base.map((m, i) => ({ ...m, tags: [i % 2 === 0 ? 'penta-major' : 'penta-minor'] }));
  const rs = [0, 0.2, 0.4, 0.6, 0.8, 0.99];
  for (const r of rs) {
    const picked = selectFragment(() => r, pool, { ...ctx, preferPenta: true });
    assert.ok(picked.tags.includes('penta-major'), `長調で penta-minor が選ばれた: ${picked.id}`);
  }
  // 優先を切れば penta-minor 側も引ける（フィルタではなく優先であることの確認）。
  // 抽選のどの目も一度は通るよう、候補数ぶんの目を等間隔で舐める。
  const sweep = pool.map((_, i) => (i + 0.5) / pool.length);
  const off = new Set(sweep.map((r) => selectFragment(() => r, pool, { ...ctx, preferPenta: false }).tags[0]));
  assert.ok(off.has('penta-minor'), '優先を切っても結果が変わっていない');
  assert.ok(off.has('penta-major'));
});

test('selectFragment: ペンタトニックのタグが1件も無ければ絞らない', () => {
  // melodies.json がまだタグ無しでも安全に動くこと。
  const mode = 'minor';
  const ctx = {
    mode, chordA: 'i', chordB: 'VII',
    chordAIdx: chordIndex(mode, 'i'), chordBIdx: chordIndex(mode, 'VII'),
    prevEndDeg: null, tension: 3, maxPeak: 15, minPeak: 1, maxLeap: 6,
  };
  assert.ok(DATA.melodies.every((m) => (m.tags ?? []).length === 0), 'フィクスチャにタグがある');
  for (const r of [0, 0.33, 0.66, 0.99]) {
    const on = selectFragment(() => r, DATA.melodies, { ...ctx, preferPenta: true });
    const off = selectFragment(() => r, DATA.melodies, { ...ctx, preferPenta: false });
    assert.equal(on.id, off.id, 'タグが無いのに候補が絞られた');
  }
});

test('selectFragment: ペンタトニック優先のあとに掛留優先が掛かる', () => {
  const mode = 'major';
  const ia = chordIndex(mode, 'I');
  const ib = chordIndex(mode, 'V');
  const ctx = {
    mode, chordA: 'I', chordB: 'V', chordAIdx: ia, chordBIdx: ib,
    prevEndDeg: null, tension: 3, maxPeak: 15, minPeak: 1, maxLeap: 6,
  };
  const base = DATA.melodies.filter((m) => passesFilters(m, ctx, 3));
  const hasSus = (m) => m.sus[mode][0].includes(ia) || m.sus[mode][1].includes(ib);
  // ペンタかつ掛留、ペンタだけ、掛留だけ、が混ざったプールを作る。
  const pool = base.map((m) => ({ ...m, tags: hasSus(m) || base.indexOf(m) % 2 === 0 ? ['penta-major'] : [] }));
  const both = pool.filter((m) => m.tags.length > 0 && hasSus(m));
  assert.ok(both.length > 0, '両方を満たす断片が無く、検証にならない');
  for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
    const picked = selectFragment(() => r, pool, { ...ctx, preferPenta: true, preferSus: true });
    assert.ok(picked.tags.includes('penta-major'), `非ペンタが選ばれた: ${picked.id}`);
    assert.ok(hasSus(picked), `掛留でない断片が選ばれた: ${picked.id}`);
  }
});

// ---------------------------------------------------------------------------
// 伴奏（8分音符の分散和音）
// ---------------------------------------------------------------------------

test('arpeggioIndex: 上行して下行する波で構成音を巡回する', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => arpeggioIndex(i, 3)), [0, 1, 2, 1, 0, 1, 2, 1]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => arpeggioIndex(i, 4)), [0, 1, 2, 3, 2, 1, 0, 1]);
  assert.deepEqual([0, 1, 2, 3].map((i) => arpeggioIndex(i, 2)), [0, 1, 0, 1]);
  assert.equal(arpeggioIndex(3, 1), 0);
  for (const voices of [1, 2, 3, 4, 5]) {
    for (let i = 0; i < 32; i++) {
      const idx = arpeggioIndex(i, voices);
      assert.ok(Number.isInteger(idx) && idx >= 0 && idx < voices, `voices=${voices} i=${i} → ${idx}`);
    }
  }
});

test('伴奏は1小節8音の8分音符で、単純な繰り返しになっていない', () => {
  const song = composeSong('accomp', DATA, S({ songBars: '32' }));
  assert.equal(song.accomp.length, (song.bars - 1) * 8 + 1);
  const lastBarBeat = (song.bars - 1) * 4;
  for (const n of song.accomp) {
    if (n.beat >= lastBarBeat) continue; // 最終小節は保持和音なので別枠
    assert.ok(n.dur > 0 && n.dur <= 1, `dur が長すぎる: ${n.dur}`);
    assert.ok(n.vel > 0 && n.vel <= 0.35, `伴奏が強すぎる: ${n.vel}`);
  }
  // 8音のうち、単純な i % voices の繰り返しとは違う並びになっていること。
  const bar0 = song.accomp.filter((n) => n.beat < 4);
  const midis = bar0.map((n) => n.midi);
  assert.equal(new Set(midis).size >= 3, true, '同じ音ばかり鳴っている');
  assert.equal(midis[0], Math.min(...midis), '小節頭が最低音ではない');
});

// ---------------------------------------------------------------------------
// 楽節計画（フレーズの長さの非対称）
//
// 断片が2小節なので、素直に組むと全フレーズが2小節ちょうどに切り揃う。
// 名バラード（Yesterday の7小節フレーズなど）はそうなっていない。
// 計画は「どこで息継ぎするか」だけを決め、楽節の役割と導出には手を出さない。
// ---------------------------------------------------------------------------

const PLAN_RNG_SEED = 'plan-rng';

test('phrasePlan: 計画の合計は必ずスロット数と一致する', () => {
  for (const slots of [2, 4, 8]) {
    const rng = makeRng(seedFromString(`${PLAN_RNG_SEED}-${slots}`));
    for (let i = 0; i < 500; i++) {
      const plan = phrasePlan(rng, slots);
      assert.ok(plan.length > 0, `空の計画: slots=${slots}`);
      assert.equal(plan.reduce((a, b) => a + b, 0), slots, `合計が違う: ${JSON.stringify(plan)}`);
      for (const g of plan) assert.ok(g === 1 || g === 2, `グループが1でも2でもない: ${g}`);
    }
  }
});

test('phrasePlan: 4スロットの抽選が表の重みどおりに散る', () => {
  const rng = makeRng(seedFromString('plan-dist'));
  const count = new Map();
  const N = 12000;
  for (let i = 0; i < N; i++) {
    const key = JSON.stringify(phrasePlan(rng, 4));
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  // 表: [1,1,1,1]=2 / [2,1,1]=3 / [1,1,2]=3 / [2,2]=2 / [1,2,1]=2（合計12）
  const want = {
    '[1,1,1,1]': 2 / 12, '[2,1,1]': 3 / 12, '[1,1,2]': 3 / 12, '[2,2]': 2 / 12, '[1,2,1]': 2 / 12,
  };
  assert.deepEqual([...count.keys()].sort(), Object.keys(want).sort(), '表に無い計画が出た');
  for (const [key, share] of Object.entries(want)) {
    const got = (count.get(key) ?? 0) / N;
    assert.ok(Math.abs(got - share) < 0.02,
      `${key} の割合が重みと違う: ${(100 * got).toFixed(1)}% (期待 ${(100 * share).toFixed(1)}%)`);
  }
  // 「4小節フレーズを含む計画」が多数派であること（＝2小節で切り揃わない）。
  const even = (count.get('[1,1,1,1]') ?? 0) / N;
  assert.ok(1 - even >= 0.75, `4小節フレーズを含む計画が少ない: ${(100 * (1 - even)).toFixed(1)}%`);
});

test('phrasePlan: 8スロットは4スロットの計画を2つ連結する', () => {
  const rng = makeRng(seedFromString('plan-8'));
  const allowed = new Set(['[1,1,1,1]', '[2,1,1]', '[1,1,2]', '[2,2]', '[1,2,1]']);
  for (let i = 0; i < 400; i++) {
    const plan = phrasePlan(rng, 8);
    // 前半4スロットぶんで必ず切れる（連結なので境目はフレーズ末になる）。
    let acc = 0;
    let cut = -1;
    for (let j = 0; j < plan.length; j++) {
      acc += plan[j];
      if (acc === 4) { cut = j; break; }
    }
    assert.ok(cut >= 0, `4スロット目で切れていない: ${JSON.stringify(plan)}`);
    assert.ok(allowed.has(JSON.stringify(plan.slice(0, cut + 1))), `前半が表に無い: ${JSON.stringify(plan)}`);
    assert.ok(allowed.has(JSON.stringify(plan.slice(cut + 1))), `後半が表に無い: ${JSON.stringify(plan)}`);
  }
});

test('phraseEndFlags: グループの最後のスロットだけがフレーズ末', () => {
  const cases = [
    [[1, 1, 1, 1], 4, [true, true, true, true]],
    [[2, 1, 1], 4, [false, true, true, true]],
    [[1, 1, 2], 4, [true, true, false, true]],
    [[2, 2], 4, [false, true, false, true]],
    [[1, 2, 1], 4, [true, false, true, true]],
    [[1, 1], 2, [true, true]],
    [[2], 2, [false, true]],
    [[2, 1, 1, 1, 1, 2], 8, [false, true, true, true, true, true, false, true]],
  ];
  for (const [plan, slots, want] of cases) {
    assert.deepEqual(phraseEndFlags(plan, slots), want, JSON.stringify(plan));
  }
  // セクションの最後は、計画が壊れていても必ずフレーズ末にする。
  assert.deepEqual(phraseEndFlags([1], 4), [true, false, false, true]);
  assert.deepEqual(phraseEndFlags([], 2), [false, true]);
});

// ---------------------------------------------------------------------------
// 息の流れ（フレーズ末は閉じ、フレーズ途中は閉じない）
// ---------------------------------------------------------------------------

// 終止感だけが違う2つの断片を作る。音符も fit も完全に同一で、
// 違うのは long-ending タグの有無だけ。だから選ばれ方に差が出たら、
// それは「フレーズ末か途中か」以外では説明がつかない。
function flowPair(base) {
  const closing = { ...base, id: `close-${base.id}`, tags: [...base.tags, 'long-ending'] };
  const flowing = { ...base, id: `flow-${base.id}`, tags: [...base.tags] };
  return [closing, flowing];
}

// タグが全断片に付いてしまっているデータ（実測: 999/999）でも息の流れが効くよう、
// 実装は「最後の音を伸ばすかどうか」を第2段に持っている。その段を直接見る。
function holdPair(base) {
  const held = {
    ...base,
    id: `hold-${base.id}`,
    tags: [...base.tags, 'long-ending'],
    notes: base.notes.map((n, i) => (i === base.notes.length - 1 ? { ...n, dur: 2 } : { ...n })),
  };
  const quick = { ...base, id: `quick-${base.id}`, tags: [...base.tags, 'long-ending'] };
  return [held, quick];
}

const FLOW_CTX = {
  mode: 'major',
  chordA: 'I',
  chordB: 'V',
  chordAIdx: chordIndex('major', 'I'),
  chordBIdx: chordIndex('major', 'V'),
  prevEndDeg: null,
  tension: 3,
  maxPeak: 15,
  minPeak: 1,
  maxLeap: 6,
  preferSus: false,
  preferPenta: false,
  soloPeak: false,
};

test('selectFragment: フレーズ末は閉じる断片、フレーズ途中は閉じない断片を選ぶ', () => {
  const base = DATA.melodies.filter((m) => passesFilters(m, FLOW_CTX, 1)).slice(0, 12);
  assert.ok(base.length >= 6, `土台の断片が足りない: ${base.length}`);
  const pool = base.flatMap(flowPair);

  for (const [phraseEnd, want] of [[true, 'close-'], [false, 'flow-']]) {
    const rng = makeRng(seedFromString(`flow-${phraseEnd}`));
    for (let i = 0; i < 200; i++) {
      const got = selectFragment(rng, pool, { ...FLOW_CTX, phraseEnd });
      assert.ok(got.id.startsWith(want),
        `phraseEnd=${phraseEnd} で ${got.id} が選ばれた（${want}* を期待）`);
    }
  }
});

test('selectFragment: 全断片が long-ending でも、伸ばす／伸ばさないで区別できる', () => {
  const base = DATA.melodies.filter((m) => passesFilters(m, FLOW_CTX, 1)).slice(0, 12);
  assert.ok(base.length >= 6, `土台の断片が足りない: ${base.length}`);
  const pool = base.flatMap(holdPair);
  assert.ok(pool.every(hasLongEnding), 'このプールは全断片が long-ending であること');

  for (const [phraseEnd, want] of [[true, 'hold-'], [false, 'quick-']]) {
    const rng = makeRng(seedFromString(`hold-${phraseEnd}`));
    for (let i = 0; i < 200; i++) {
      const got = selectFragment(rng, pool, { ...FLOW_CTX, phraseEnd });
      assert.ok(got.id.startsWith(want),
        `phraseEnd=${phraseEnd} で ${got.id} が選ばれた（${want}* を期待）`);
    }
  }
});

test('selectFragment: 息の流れの好みは、該当が無ければ絞らない', () => {
  const base = DATA.melodies.filter((m) => passesFilters(m, FLOW_CTX, 1)).slice(0, 12);
  const closingOnly = base.flatMap(flowPair).filter((m) => m.id.startsWith('close-'));
  const flowingOnly = base.flatMap(flowPair).filter((m) => m.id.startsWith('flow-'));

  // 閉じる断片しか無いプールでも、フレーズ途中のスロットは必ず何かを返す。
  const rngA = makeRng(seedFromString('flow-empty-a'));
  for (let i = 0; i < 50; i++) {
    const got = selectFragment(rngA, closingOnly, { ...FLOW_CTX, phraseEnd: false });
    assert.notEqual(got.id, 'fallback', 'フレーズ途中の絞り込みで候補が全滅した');
  }
  // 逆も同じ。
  const rngB = makeRng(seedFromString('flow-empty-b'));
  for (let i = 0; i < 50; i++) {
    const got = selectFragment(rngB, flowingOnly, { ...FLOW_CTX, phraseEnd: true });
    assert.notEqual(got.id, 'fallback', 'フレーズ末の絞り込みで候補が全滅した');
  }
});

test('selectFragment: フレーズ途中はトニックで着地しない断片を優先する', () => {
  // 終わりの度数だけが違う断片を並べ、途中のスロットが非トニックを採ることを見る。
  const pool = DATA.melodies.filter((m) => passesFilters(m, FLOW_CTX, 1));
  const tonics = pool.filter((m) => scaleDeg(m.endDeg) === 1);
  const others = pool.filter((m) => scaleDeg(m.endDeg) !== 1);
  assert.ok(tonics.length > 0 && others.length > 0, `終止音の散り方が足りない: ${tonics.length}/${others.length}`);
  const rng = makeRng(seedFromString('flow-tonic'));
  for (let i = 0; i < 200; i++) {
    // endDegrees を渡さない＝役割の終止の好みが無い状態で、途中の好みだけを見る。
    const got = selectFragment(rng, pool, { ...FLOW_CTX, phraseEnd: false });
    assert.notEqual(scaleDeg(got.endDeg), 1, `${got.id} がトニックで閉じた`);
  }
});

// ---------------------------------------------------------------------------
// クライマックスの舞い上がり
// ---------------------------------------------------------------------------

test('soarsToPeak: 跳び上がって届き、直後が順次下降の形だけを真とする', () => {
  const frag = (degs) => ({
    id: 'x',
    notes: degs.map((deg, i) => ({ deg, beat: i, dur: 1, vel: 0.6 })),
    peakDeg: Math.max(...degs),
    peakBeat: degs.indexOf(Math.max(...degs)),
  });
  // 跳び上がって（+5）順次下降（-1）
  assert.equal(soarsToPeak(frag([5, 6, 11, 10, 8])), true);
  // ちょうど4度の跳躍でも真
  assert.equal(soarsToPeak(frag([5, 7, 11, 9, 8])), true);
  // 跳躍が3度しかない
  assert.equal(soarsToPeak(frag([5, 8, 11, 10, 8])), false);
  // 順次で登ってきた
  assert.equal(soarsToPeak(frag([8, 9, 10, 9, 8])), false);
  // 跳び上がったが、直後も跳んで降りる（3度）
  assert.equal(soarsToPeak(frag([5, 6, 11, 8, 7])), false);
  // 跳び上がったが、直後が上行
  assert.equal(soarsToPeak(frag([5, 6, 11, 11, 8])), false);
  // 頂点が先頭・末尾なら「到達」も「降り」も無い
  assert.equal(soarsToPeak(frag([11, 6, 5, 4, 3])), false);
  assert.equal(soarsToPeak(frag([3, 4, 5, 6, 11])), false);
  // 壊れた入力
  assert.equal(soarsToPeak(null), false);
  assert.equal(soarsToPeak({ notes: [] }), false);
  assert.equal(soarsToPeak({ notes: [{ deg: 5, beat: 0, dur: 1 }] }), false);
});

test('selectFragment: クライマックスは舞い上がる断片を優先し、無ければ従来どおり', () => {
  const climaxCtx = { ...FLOW_CTX, tension: 5, minPeak: 12, soloPeak: true, preferSoar: true };
  const fitting = DATA.melodies.filter((m) => passesFilters(m, climaxCtx, 1));
  assert.ok(fitting.length >= 5, `頂点の候補が少ない: ${fitting.length}`);

  // 舞い上がる形へ作り替えた双子を混ぜる。頂点の直前を低くして跳躍を作り、
  // 頂点の直後を1度下へ置いて順次下降にする（fit は作り直す）。
  const soaring = [];
  for (const m of fitting) {
    const notes = m.notes.map((n) => ({ ...n }));
    const i = notes.findIndex((n) => n.deg === m.peakDeg);
    if (i <= 0 || i >= notes.length - 1) continue;
    notes[i - 1] = { ...notes[i - 1], deg: m.peakDeg - 5 };
    notes[i + 1] = { ...notes[i + 1], deg: m.peakDeg - 1 };
    const { fit, sus } = computeFitSus(notes);
    const twin = { ...m, id: `soar-${m.id}`, notes, fit, sus };
    if (soarsToPeak(twin) && passesFilters(twin, climaxCtx, 1)) soaring.push(twin);
  }
  assert.ok(soaring.length >= 3, `舞い上がる双子が作れない: ${soaring.length}`);

  // 舞い上がらない断片のほうが圧倒的多数でも、頂点は必ず舞い上がるほうを引く。
  const pool = [...fitting, ...fitting, ...soaring];
  const rng = makeRng(seedFromString('soar-pick'));
  for (let i = 0; i < 200; i++) {
    const got = selectFragment(rng, pool, climaxCtx);
    assert.ok(soarsToPeak(got), `舞い上がらない断片が頂点に選ばれた: ${got.id}`);
  }

  // 舞い上がる断片が1つも無ければ、絞らずに従来どおり選ぶ。
  const rng2 = makeRng(seedFromString('soar-none'));
  for (let i = 0; i < 100; i++) {
    const got = selectFragment(rng2, fitting, climaxCtx);
    assert.notEqual(got.id, 'fallback', '舞い上がりの絞り込みで候補が全滅した');
    assert.ok(got.peakDeg >= 12 && got.peakCount === 1);
  }
});

// ---------------------------------------------------------------------------
// 楽節計画が曲に効いているか（合成フィクスチャ）
// ---------------------------------------------------------------------------

test('曲は楽節計画を持ち、スロットのフレーズ末フラグと一致する', () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars }));
      const slots = slotsPerSection(song);
      for (const sec of song.sections) {
        assert.ok(Array.isArray(sec.phrasePlan), `${seed}/${bars} ${sec.name}: 計画が無い`);
        assert.equal(sec.phrasePlan.reduce((a, b) => a + b, 0), slots,
          `${seed}/${bars} ${sec.name}: 計画の合計がスロット数と違う`);
        const want = phraseEndFlags(sec.phrasePlan, slots);
        assert.deepEqual(sec.slots.map((sl) => sl.phraseEnd), want,
          `${seed}/${bars} ${sec.name}: フレーズ末フラグが計画と食い違う`);
        assert.equal(sec.slots[slots - 1].phraseEnd, true,
          `${seed}/${bars} ${sec.name}: セクション末がフレーズ末でない`);
      }
      // 役割（a - a' - b - a''）は計画に関係なく従来どおり。
      const roles = phraseRoles(slots).map((r) => r.name);
      for (const sec of song.sections) {
        assert.deepEqual(sec.slots.map((sl) => sl.role), roles, `${seed}/${bars}: 役割が壊れた`);
      }
    }
  }
});

test('曲じゅうのフレーズが2小節ちょうどには揃わない', () => {
  let sections = 0;
  let asymmetric = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      for (const sec of composeSong(seed, DATA, S({ songBars: bars })).sections) {
        sections++;
        if (sec.phrasePlan.some((g) => g >= 2)) asymmetric++;
      }
    }
  }
  assert.ok(sections >= 100, `検査したセクションが少ない: ${sections}`);
  const rate = asymmetric / sections;
  assert.ok(rate >= 0.5,
    `4小節フレーズを含むセクションが少なすぎる: ${(100 * rate).toFixed(1)}% (${asymmetric}/${sections})`);
  assert.ok(rate <= 0.95, `2小節ぞろいのセクションが消えた: ${(100 * rate).toFixed(1)}%`);
});

test('フレーズ途中とフレーズ末で、選ばれる断片の終わり方が20ポイント以上違う', () => {
  // 終止感だけが違う双子でプールを作る（音符と fit は同一）。
  // 選ばれ方に差が出るなら、それは楽節計画が効いている証拠にしかならない。
  const pool = DATA.melodies.flatMap(flowPair);
  const byIdFlow = new Map(pool.map((m) => [m.id, m]));
  const data = { melodies: pool, progressions: FIX_PROGRESSIONS };
  const stat = { mid: { n: 0, open: 0 }, end: { n: 0, open: 0 } };
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, data, S({ songBars: bars }));
      for (const sec of song.sections) {
        for (const slot of sec.slots) {
          // 選び直したスロットだけを見る（再登場・移調は選択をやり直していない）。
          if (slot.source !== 'select') continue;
          const frag = byIdFlow.get(slot.fragmentId);
          if (!frag) continue;
          const b = stat[slot.phraseEnd ? 'end' : 'mid'];
          b.n++;
          if (!hasLongEnding(frag)) b.open++;
        }
      }
    }
  }
  assert.ok(stat.mid.n >= 50 && stat.end.n >= 50, `標本が少ない: ${stat.mid.n}/${stat.end.n}`);
  const mid = stat.mid.open / stat.mid.n;
  const end = stat.end.open / stat.end.n;
  const show = `途中 ${(100 * mid).toFixed(1)}% (${stat.mid.open}/${stat.mid.n})`
    + ` / 末 ${(100 * end).toFixed(1)}% (${stat.end.open}/${stat.end.n})`;
  assert.ok(mid - end >= 0.2, `long-ending を持たない断片の差が20ポイント未満: ${show}`);
});

// ---------------------------------------------------------------------------
// 息継ぎ（メロディーだけが1小節休む）
// ---------------------------------------------------------------------------

test('息継ぎは1曲に最大1回、A か A\' のフレーズ末スロットの2小節目に置かれる', () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars }));
      const slots = slotsPerSection(song);
      const cs = climaxSlot(slots);
      const marked = [];
      song.sections.forEach((sec, si) => {
        sec.slots.forEach((slot, k) => { if (slot.breath) marked.push({ si, k, sec }); });
      });
      assert.ok(marked.length <= 1, `${seed}/${bars}: 息継ぎが${marked.length}回`);
      if (song.breathBar === null) {
        assert.equal(marked.length, 0, `${seed}/${bars}: breathBar が無いのに印がある`);
        continue;
      }
      assert.equal(marked.length, 1, `${seed}/${bars}: breathBar があるのに印が無い`);
      const { si, k, sec } = marked[0];
      assert.ok(si === 0 || si === 1, `${seed}/${bars}: 息継ぎが ${SECTION_NAMES[si]} にある`);
      assert.equal(sec.slots[k].phraseEnd, true, `${seed}/${bars}: フレーズ途中で息継ぎした`);
      // スロットの2小節目であること。
      assert.equal(song.breathBar, sec.startBar + 2 * k + 1, `${seed}/${bars}: 息継ぎの小節がずれている`);
      // 曲の最初と最後のスロットではない。
      const g = si * slots + k;
      assert.ok(g > 0 && g < 4 * slots - 1, `${seed}/${bars}: 曲の端のスロットで息継ぎした`);
      // クライマックスのスロットとその前後でもない。
      assert.ok(Math.abs(g - (2 * slots + cs)) > 1, `${seed}/${bars}: 頂点の周りで息継ぎした`);
      // 再登場のスロットでもない（モチーフを欠けた形で帰らせない）。
      assert.equal(sec.slots[k].reusedFrom, null, `${seed}/${bars}: 再登場のスロットを削った`);
      // 息継ぎの小節でも伴奏・ベース・パッドは鳴り続ける。
      const from = song.breathBar * 4;
      assert.ok(song.accomp.some((n) => n.beat >= from && n.beat < from + 4), '伴奏が止まった');
      assert.ok(song.bass.some((n) => n.beat >= from && n.beat < from + 4), 'ベースが止まった');
      assert.ok(song.pad.some((p) => p.beat >= from && p.beat < from + 4), 'パッドが止まった');
      // 頂点と最後の音は削らない。
      assert.ok(song.climaxBeat < from || song.climaxBeat >= from + 4, '頂点を削った');
      const tail = song.melody.reduce((a, b) => (b.beat >= a.beat ? b : a));
      assert.ok(tail.beat < from || tail.beat >= from + 4, '最後の音を削った');
    }
  }
});

// ---------------------------------------------------------------------------
// 最終セクションの転調（合成フィクスチャ）
// ---------------------------------------------------------------------------

test('modulatedPeakCap: クライマックスの高さに並ばない最大の度数を返す', () => {
  for (const mode of ['major', 'minor']) {
    const climax = degToSemitone(12, mode); // curveFor がクライマックスに要求する高さ
    for (const semitones of [0, 1, 2]) {
      const cap = modulatedPeakCap(semitones, mode);
      assert.ok(degToSemitone(cap, mode) + semitones < climax,
        `${mode}/+${semitones}: cap=${cap} が頂点に届いてしまう`);
      assert.ok(degToSemitone(cap + 1, mode) + semitones >= climax,
        `${mode}/+${semitones}: cap=${cap} はまだ上げられる（下げすぎ）`);
    }
    // +1 なら deg11(=17半音)+1=18 < 19 で通る。+2 では 19 で並ぶので deg10 まで。
    assert.equal(modulatedPeakCap(1, mode), 11);
    assert.equal(modulatedPeakCap(2, mode), 10);
  }
});

test('keyFifths: notation.js の調号（keySignature）と完全に一致する', () => {
  // ここがずれると「楽譜に出る臨時記号の数」と「compose.js が最適化している距離」が
  // 食い違う。綴りの表を2か所に持つ以上、一致は毎回機械で確かめる。
  for (const mode of ['major', 'minor']) {
    for (let pc = 0; pc < 12; pc++) {
      const key = keySignature(60 + pc, mode);
      const want = key.accidental === 'sharp' ? key.count
        : key.accidental === 'flat' ? -key.count : 0;
      assert.equal(keyFifths(60 + pc, mode), want, `${mode} pc${pc} (${key.label})`);
    }
  }
});

test('keyDistance: 半音上げは五度圏で必ず5以上、全音上げは2（綴りが飛ぶ2か所だけ10）', () => {
  const of = (semitones) => {
    const out = new Set();
    for (const mode of ['major', 'minor']) {
      for (let pc = 0; pc < 12; pc++) out.add(keyDistance(60 + pc, semitones, mode));
    }
    return [...out].sort((a, b) => a - b);
  };
  // 1半音 = 五度圏で7つ（反対回りに5つ）。**どう綴っても5未満にはならない**。
  assert.deepEqual(of(1), [5, 7]);
  assert.deepEqual(of(2), [2, 10]);
  // 報告のあった実例: 変ニ長調(♭5) から。+1 は ニ長調(♯2) で距離7、+2 は 変ホ長調(♭3) で距離2。
  const db = 61; // Db
  assert.equal(keyDistance(db, 1, 'major'), 7);
  assert.equal(keyDistance(db, 2, 'major'), 2);
});

test('chooseModulationStep: 調号が近いほうを選び、両方遠ければ近いほうに決め打つ', () => {
  // 乱数を「必ず 0.0, 0.1, …, 0.9 を返す10本」で回して、選ばれる比率を数える。
  const share = (tonicMidi, mode) => {
    let ones = 0;
    for (let i = 0; i < 10; i++) {
      if (chooseModulationStep(() => i / 10, tonicMidi, mode) === 1) ones++;
    }
    return ones / 10;
  };
  // 変ニ長調: +1 は距離7、+2 は距離2。ほとんど +2 になる（が、両方出る余地は残す）。
  const db = share(61, 'major');
  assert.ok(db <= 0.2, `変ニ長調で +1 が多すぎる: ${db}`);
  // ロ長調: +1 は距離5、+2 は ロ→変ニ で距離10。両方遠いので必ず近い +1。
  assert.equal(keyDistance(59, 2, 'major'), 10);
  assert.equal(share(59, 'major'), 1);
  // 乱数の消費はどちらの道でも必ず1回。ここが揺れると同じシードで別の曲になる。
  for (const [tonic, mode] of [[61, 'major'], [59, 'major'], [60, 'minor']]) {
    let calls = 0;
    chooseModulationStep(() => { calls++; return 0.5; }, tonic, mode);
    assert.equal(calls, 1, `${mode}/${tonic}: 乱数を ${calls} 回消費した`);
  }
  // どの調でも、返るのは +1 か +2 だけ。
  for (const mode of ['major', 'minor']) {
    for (let pc = 0; pc < 12; pc++) {
      for (let i = 0; i < 10; i++) {
        const step = chooseModulationStep(() => i / 10, 60 + pc, mode);
        assert.ok(step === 1 || step === 2, `${mode} pc${pc}: ${step}`);
      }
    }
  }
});

test('曲は転調の記録を持ち、A\'\' だけが新しい主音で鳴る（合成フィクスチャ）', () => {
  let modulated = 0;
  let plain = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars }));
      const m = song.modulation;
      if (m === null) {
        plain++;
        for (const sec of song.sections) {
          assert.equal(sec.tonicMidi, song.tonicMidi,
            `${seed}/${bars}: 転調しない曲のセクションの主音がずれている`);
        }
        continue;
      }
      modulated++;
      assert.ok(m.semitones === 1 || m.semitones === 2, `${seed}/${bars}: 上げ幅 ${m.semitones}`);
      assert.equal(m.atBar, song.sections[3].startBar, `${seed}/${bars}: atBar が A'' の頭でない`);
      assert.equal(m.fromTonicMidi, song.tonicMidi);
      assert.equal(m.toTonicMidi, song.tonicMidi + m.semitones);
      for (const si of [0, 1, 2]) {
        assert.equal(song.sections[si].tonicMidi, song.tonicMidi,
          `${seed}/${bars}: ${SECTION_NAMES[si]} が元の調で鳴っていない`);
      }
      assert.equal(song.sections[3].tonicMidi, m.toTonicMidi);
      // 同じシード・同じ設定なら、転調も含めて完全に同じ曲になる。
      assert.equal(JSON.stringify(song), JSON.stringify(composeSong(seed, DATA, S({ songBars: bars }))));
    }
  }
  assert.ok(modulated > 0, '転調した曲が1つも出ない');
  assert.ok(plain > 0, '転調しない曲が1つも出ない');
});

// ---------------------------------------------------------------------------
// 実データ統合テスト
//
// src/data/*.json は別途生成されるので、無い環境ではスキップする。
// （上の合成フィクスチャによるテストだけでも仕様は担保される）
// ---------------------------------------------------------------------------

function loadRealData() {
  const dir = new URL('../src/data/', import.meta.url);
  try {
    return {
      melodies: JSON.parse(fs.readFileSync(new URL('melodies.json', dir), 'utf8')),
      progressions: JSON.parse(fs.readFileSync(new URL('progressions.json', dir), 'utf8')),
    };
  } catch {
    return null;
  }
}

const REAL = loadRealData();
const realOpts = { skip: REAL ? false : 'src/data/*.json が無い' };
const REAL_SEEDS = Array.from({ length: 200 }, (_, i) => `real-${i}`);

test('実データ: 999断片・99進行が読める', realOpts, () => {
  assert.ok(REAL.melodies.length >= 900, `断片が少ない: ${REAL.melodies.length}`);
  assert.ok(REAL.progressions.length >= 90, `進行が少ない: ${REAL.progressions.length}`);
});

test('実データ: 全曲で最高音がちょうど1回、B の中で鳴る', realOpts, () => {
  let songs = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      songs++;
      const top = Math.max(...song.melody.map((n) => n.midi));
      const hits = song.melody.filter((n) => n.midi === top);
      assert.equal(hits.length, 1, `${seed}/${bars}: 最高音が${hits.length}回`);
      assert.equal(song.climaxBeat, hits[0].beat, `${seed}/${bars}: climaxBeat が頂点と違う`);
      const b = song.sections[2];
      const from = b.startBar * 4;
      const to = from + (song.bars / 4) * 4;
      assert.ok(song.climaxBeat >= from && song.climaxBeat < to,
        `${seed}/${bars}: 頂点が B の外 (${song.climaxBeat} ∉ [${from}, ${to}))`);
    }
  }
  assert.ok(songs >= 200, `曲数が足りない: ${songs}`);
});

test('実データ: モチーフの再登場回数が曲の長さどおりになる', realOpts, () => {
  for (const [bars, expected] of [['16', 2], ['32', 3], ['64', 3]]) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars, motifRecall: true }));
      const slots = slotsPerSection(song);
      const reuses = song.sections.flatMap((sec) => sec.slots).filter((sl) => sl.reusedFrom !== null);
      assert.equal(reuses.length, expected, `${seed}/${bars}: 再利用が${reuses.length}回`);
      // 再登場は必ず A と同じ断片、同じスロット番号から来る。
      assert.equal(song.sections[1].slots[0].reusedFrom, 'A:0');
      assert.equal(song.sections[1].slots[0].fragmentId, song.sections[0].slots[0].fragmentId);
      assert.equal(song.sections[3].slots[0].reusedFrom, 'A:0');
      assert.equal(song.sections[3].slots[0].fragmentId, song.sections[0].slots[0].fragmentId);
      if (slots >= 3) {
        const k = slots - 2;
        assert.equal(song.sections[3].slots[k].reusedFrom, `A:${k}`);
        assert.equal(song.sections[3].slots[k].fragmentId, song.sections[0].slots[k].fragmentId);
      }
    }
  }
});

test('実データ: fallback が1度も発動しない', realOpts, () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      for (const sec of song.sections) {
        for (const sl of sec.slots) {
          assert.notEqual(sl.fragmentId, 'fallback', `${seed}/${bars} ${sec.name} で fallback`);
        }
      }
    }
  }
});

test('実データ: セクション内の楽節構造が95%以上のスロットで成立する', realOpts, () => {
  let derived = 0;
  let total = 0;
  const sources = {};
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      const slots = slotsPerSection(song);
      const cs = climaxSlot(slots);
      const roles = phraseRoles(slots);
      song.sections.forEach((sec, si) => {
        assert.deepEqual(sec.slots.map((sl) => sl.role), roles.map((r) => r.name));
        sec.slots.forEach((slot, k) => {
          sources[slot.source] = (sources[slot.source] ?? 0) + 1;
          // クライマックスと、再登場で埋まったスロットは楽節の導出より優先される。
          if (si === 2 && k === cs) return;
          if (!roles[k].derive || slot.reusedFrom !== null) return;
          total++;
          if (slot.derivedFrom === null) return;
          assert.equal(slot.derivedFrom, roles[k].anchor);
          // 導出元は必ず同じセクションの a
          assert.equal(sec.slots[roles[k].anchor].role, 'a');
          derived++;
        });
      });
    }
  }
  assert.ok(total >= 1000, `検査したスロットが少ない: ${total}`);
  const rate = derived / total;
  assert.ok(rate >= 0.95,
    `導出された割合が低い: ${(100 * rate).toFixed(1)}% (${derived}/${total}) ${JSON.stringify(sources)}`);
  assert.ok((sources.fallback ?? 0) === 0, 'fallback が出ている');
});

test('実データ: ゼクエンツはリズムも音形も元と完全に一致し、コードにも乗る', realOpts, () => {
  const byId = new Map(REAL.melodies.map((m) => [m.id, m]));
  const progById = new Map(REAL.progressions.map((p) => [p.id, p]));
  let checked = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS.slice(0, 80)) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      song.sections.forEach((sec, si) => {
        const prog = varyProgression(progById.get(sec.progressionId), SECTION_LEVELS[si]);
        const raw = [];
        for (let r = 0; r < song.bars / 4 / 4; r++) for (const b of prog.bars) raw.push(b.chord);
        const chords = withPivot(song, si, raw);
        sec.slots.forEach((slot, k) => {
          if (slot.offset === null || slot.offset === undefined) return;
          const anchor = fragmentOf(sec.slots[slot.derivedFrom], byId);
          const frag = fragmentOf(slot, byId);
          assert.ok(anchor && frag, `断片が復元できない: ${slot.fragmentId}`);
          assert.equal(rhythmKey(frag), rhythmKey(anchor), `${seed} ${sec.name}:${k} リズムが違う`);
          assert.deepEqual(intervalsOf(frag), intervalsOf(anchor), `${seed} ${sec.name}:${k} 音形が違う`);
          const [b0, b1] = splitBars(frag.notes);
          assert.ok(fitsBar(b0, song.mode, chords[2 * k]),
            `${seed} ${sec.name}:${k} 導出の前半が ${chords[2 * k]} に乗っていない`);
          assert.ok(fitsBar(b1, song.mode, chords[2 * k + 1]),
            `${seed} ${sec.name}:${k} 導出の後半が ${chords[2 * k + 1]} に乗っていない`);
          checked++;
        });
      });
    }
  }
  assert.ok(checked >= 500, `ゼクエンツが少なすぎる: ${checked}`);
});

test('実データ: b と a の輪郭が違う曲が7割以上ある', realOpts, () => {
  const byId = new Map(REAL.melodies.map((m) => [m.id, m]));
  let contrast = 0;
  let total = 0;
  for (const bars of ['32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      song.sections.forEach((sec) => {
        for (let k = 2; k < sec.slots.length; k += 4) {
          const a = fragmentOf(sec.slots[k - 2], byId);
          const b = fragmentOf(sec.slots[k], byId);
          if (!a || !b) continue;
          total++;
          if (a.contour !== b.contour) contrast++;
        }
      });
    }
  }
  assert.ok(total >= 1000);
  assert.ok(contrast / total >= 0.7,
    `対比が少なすぎる: ${(100 * contrast / total).toFixed(1)}% (${contrast}/${total})`);
});

test('実データ: popularity >= 4 の進行が7割以上使われる', realOpts, () => {
  const byId = new Map(REAL.progressions.map((p) => [p.id, p]));
  let used = 0;
  let popular = 0;
  for (let i = 0; i < 1000; i++) {
    const song = composeSong(`pop-${i}`, REAL, S());
    // A系（セクション0）と B（セクション2）の2つが、その曲で使われた進行。
    for (const si of [0, 2]) {
      const p = byId.get(song.sections[si].progressionId);
      assert.ok(p, `未知の進行: ${song.sections[si].progressionId}`);
      used++;
      if (p.popularity >= 4) popular++;
    }
  }
  assert.equal(used, 2000);
  const share = popular / used;
  assert.ok(share >= 0.7, `人気進行の採用率が低い: ${(100 * share).toFixed(1)}%`);
});

test('実データ: 伴奏が1小節8音で鳴り、最終小節だけ和音を保持する', realOpts, () => {
  for (const bars of ['16', '32', '64']) {
    const song = composeSong('accomp-real', REAL, S({ songBars: bars }));
    assert.equal(song.accomp.length, (song.bars - 1) * 8 + 1);
    for (let bar = 0; bar < song.bars; bar++) {
      const inBar = song.accomp.filter((n) => Math.floor(n.beat / 4) === bar);
      const want = bar === song.bars - 1 ? 1 : 8;
      assert.equal(inBar.length, want, `${bar}小節目の伴奏が ${inBar.length} 音`);
    }
  }
});

test('実データ: 無音の小節が無く、音域も外れない', realOpts, () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS.slice(0, 60)) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      assertNoSilentBar(song, `${seed}/${bars}`);
      for (const midi of allMidis(song)) assert.ok(midi >= 21 && midi <= 108, `音域外: ${midi}`);
      assert.equal(JSON.stringify(song), JSON.stringify(composeSong(seed, REAL, S({ songBars: bars }))));
    }
  }
});

// ---------------------------------------------------------------------------
// 実データ: ゼクエンツの方向・終止の重み・陰りの掛留
//
// ここは「曲が良くなったか」を数字で見る唯一の場所なので、
// 単体テストではなく実データ200シード×3つの長さ（600曲）で測る。
// ---------------------------------------------------------------------------

// 曲の全スロットを、復元した断片つきで舐めるための共通ヘルパ。
function walkSlots(seeds, barsList, fn) {
  const byId = new Map(REAL.melodies.map((m) => [m.id, m]));
  const progById = new Map(REAL.progressions.map((p) => [p.id, p]));
  for (const bars of barsList) {
    for (const seed of seeds) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      const slots = slotsPerSection(song);
      song.sections.forEach((sec, si) => {
        const prog = varyProgression(progById.get(sec.progressionId), SECTION_LEVELS[si]);
        const raw = [];
        for (let r = 0; r < song.bars / 16; r++) for (const b of prog.bars) raw.push(b.chord);
        const chords = withPivot(song, si, raw);
        sec.slots.forEach((slot, k) => {
          fn({ song, sec, si, slot, k, slots, chords, fragment: fragmentOf(slot, byId) });
        });
      });
    }
  }
}

const scaleDeg = (deg) => ((((deg - 1) % 7) + 7) % 7) + 1;
const meanOf = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('実データ: ゼクエンツが A→A\'→B と上行し、A\'\' だけ下降する', realOpts, () => {
  // 感動させる音楽は数小節かけて音域を上げ、頂点で解放し、下りてくる。
  // その「上げ」を作っているのが平行移動量の符号なので、セクション平均で見る。
  const offsets = [[], [], [], []];
  walkSlots(REAL_SEEDS, ['16', '32', '64'], ({ si, slot }) => {
    if (slot.offset !== null && slot.offset !== undefined) offsets[si].push(slot.offset);
  });
  for (let si = 0; si < 4; si++) {
    assert.ok(offsets[si].length >= 200, `セクション${si}のゼクエンツが少ない: ${offsets[si].length}`);
  }
  const [a, a2, b, a3] = offsets.map(meanOf);
  const show = `A=${a.toFixed(3)} A'=${a2.toFixed(3)} B=${b.toFixed(3)} A''=${a3.toFixed(3)}`;
  assert.ok(a < a2, `A が A' より上がっている: ${show}`);
  assert.ok(a2 < b, `A' が B より上がっている: ${show}`);
  assert.ok(a3 < 0, `A'' が下降していない: ${show}`);
  // 「A は静かに提示」なので、B ほど上げてはいけない。
  assert.ok(b - a >= 0.3, `A と B の差が小さすぎる: ${show}`);
});

test('実データ: メロディーの平均音高が A→A\'→B で上がる', realOpts, () => {
  const pitch = [[], [], [], []];
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      const span = (song.bars / 4) * 4;
      song.sections.forEach((sec, si) => {
        const from = sec.startBar * 4;
        const notes = song.melody.filter((n) => n.beat >= from && n.beat < from + span);
        assert.ok(notes.length > 0);
        pitch[si].push(meanOf(notes.map((n) => n.midi)));
      });
    }
  }
  const [a, a2, b, a3] = pitch.map(meanOf);
  const show = `A=${a.toFixed(2)} A'=${a2.toFixed(2)} B=${b.toFixed(2)} A''=${a3.toFixed(2)}`;
  assert.ok(a < a2, `A' が A より高くない: ${show}`);
  assert.ok(a2 < b, `B が A' より高くない: ${show}`);
  assert.ok(a3 < b, `A'' が B より下りていない: ${show}`);
});

test('実データ: 楽節の役割ごとに終わり方が変わる', realOpts, () => {
  // a は問いかけて開いたまま、a' はひとまず答え、b で再び開き、a'' で閉じる。
  // 2小節ごとに同じ終わり方をすると、聴き手は次に何が来るか全部読めてしまう。
  const stat = {};
  walkSlots(REAL_SEEDS, ['16', '32', '64'], ({ slot, fragment }) => {
    if (!fragment) return;
    const s = (stat[slot.role] ??= { n: 0, tonic: 0, triad: 0 });
    const d = scaleDeg(fragment.endDeg);
    s.n++;
    if (d === 1) s.tonic++;
    if ([1, 3, 5].includes(d)) s.triad++;
  });
  const rate = (r, key) => stat[r][key] / stat[r].n;
  const show = Object.entries(stat)
    .map(([r, s]) => `${r}:トニック${(100 * s.tonic / s.n).toFixed(1)}% {1,3,5}${(100 * s.triad / s.n).toFixed(1)}%`)
    .join(' / ');

  // a と b は「開いたまま」＝トニック以外で終わる。
  assert.ok(1 - rate('a', 'tonic') >= 0.6, `a がトニックで閉じすぎ: ${show}`);
  assert.ok(1 - rate('b', 'tonic') >= 0.6, `b がトニックで閉じすぎ: ${show}`);
  // a' は「ひとまず答える」＝主和音の構成音。
  assert.ok(rate("a'", 'triad') >= 0.6, `a' が答えていない: ${show}`);
  // a'' は「完全に閉じる」。断片プールの都合でトニックそのものには届かない曲も
  // あるので、まず {1,3,5} で閉じること、そのうえで a より明確にトニックが多いこと。
  assert.ok(rate("a''", 'triad') >= 0.6, `a'' が閉じていない: ${show}`);
  assert.ok(rate("a''", 'tonic') >= rate('a', 'tonic') + 0.15, `a'' と a の差が無い: ${show}`);
  assert.ok(rate("a''", 'tonic') >= rate('b', 'tonic'), `a'' が b より閉じていない: ${show}`);
});

test('実データ: 陰りの和音のスロットに掛留が寄る', realOpts, () => {
  // iv / bVI / bVII が鳴る瞬間はその曲でいちばん感情が動く。掛留を重ねて効かせる。
  // 再登場・移調で埋まったスロットは断片を選び直していないので対象外。
  const dark = { n: 0, sus: 0 };
  const plain = { n: 0, sus: 0 };
  walkSlots(REAL_SEEDS, ['32', '64'], ({ song, slot, k, chords, fragment }) => {
    if (!fragment) return;
    if (slot.source !== 'select' && slot.source !== 'rhythm') return;
    const [b0, b1] = splitBars(fragment.notes);
    const sus = hasSuspension(b0, song.mode, chords[2 * k])
      || hasSuspension(b1, song.mode, chords[2 * k + 1]);
    const bucket = isDarkChord(chords[2 * k]) || isDarkChord(chords[2 * k + 1]) ? dark : plain;
    bucket.n++;
    if (sus) bucket.sus++;
  });
  assert.ok(dark.n >= 500 && plain.n >= 500, `標本が少ない: ${dark.n}/${plain.n}`);
  const dr = dark.sus / dark.n;
  const pr = plain.sus / plain.n;
  const show = `陰り ${(100 * dr).toFixed(1)}% (${dark.sus}/${dark.n}) / それ以外 ${(100 * pr).toFixed(1)}% (${plain.sus}/${plain.n})`;
  assert.ok(dr > pr, `陰りの和音に掛留が寄っていない: ${show}`);
  assert.ok(dr - pr >= 0.03, `寄せ方が弱い: ${show}`);
  assert.ok(dr >= 0.25, `陰りの和音の掛留率が低い: ${show}`);
});

// ---------------------------------------------------------------------------
// 実データ: 強弱のヘッドルームと、頂点のあとの脱力
// ---------------------------------------------------------------------------

test('実データ: メロディーの素ベロシティに余裕がある', realOpts, () => {
  // 演奏側は最大 1.10(B) × 1.20(頂点) を掛ける。素で 0.72 を超えると
  // クレッシェンドの行き先が 1.0 に張り付き、いちばん効かせたい一音が潰れる。
  let hi = 0;
  let lo = 1;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      for (const n of composeSong(seed, REAL, S({ songBars: bars })).melody) {
        if (n.vel > hi) hi = n.vel;
        if (n.vel < lo) lo = n.vel;
        assert.ok(n.vel > 0, `ベロシティが0以下: ${n.vel}`);
      }
    }
  }
  assert.ok(hi <= 0.72, `素ベロシティが大きすぎる: ${hi.toFixed(4)}`);
  assert.ok(hi * 1.1 * 1.2 < 1, `演奏側の係数を掛けると天井に当たる: ${hi.toFixed(4)}`);
  assert.ok(lo >= 0.05, `素ベロシティが小さすぎる: ${lo.toFixed(4)}`);
});

test('実データ: 頂点の直後は直前より弱くなる', realOpts, () => {
  // 上げて、頂点で解放し、下りてくる。この往復が「感動」の形。
  // 頂点を過ぎても素材が鳴り続けると、演奏側のディミヌエンドを押し返してしまう。
  let ok = 0;
  let n = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      const cb = song.climaxBeat;
      const before = song.melody.filter((x) => x.beat >= cb - 4 && x.beat < cb);
      const after = song.melody.filter((x) => x.beat > cb && x.beat <= cb + 4);
      if (before.length === 0 || after.length === 0) continue;
      n++;
      if (meanOf(after.map((x) => x.vel)) < meanOf(before.map((x) => x.vel))) ok++;
    }
  }
  assert.ok(n >= 50, `検査した曲が少ない: ${n}`);
  assert.ok(ok / n >= 0.9, `脱力できていない曲が多い: ${(100 * ok / n).toFixed(1)}% (${ok}/${n})`);
});

// ---------------------------------------------------------------------------
// 実データ: 曲の始まりと終わり
//
// 曲が切り替わるとき「ちゃんと終わって、ちゃんと始まる」ように聴こえるかどうか。
// ---------------------------------------------------------------------------

test('実データ: 曲は iv → I（VI → i）で閉じ、最後の音が主音を伸ばす', realOpts, () => {
  const progById = new Map(REAL.progressions.map((p) => [p.id, p]));
  let songs = 0;
  let subdominant = 0;
  let melodyTonic = 0;
  let downbeat = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      songs++;
      // 最終小節の和音は主和音。A'' は level 2 で、進行を repeats 回まわしても
      // 最後に来るのは差し替えた最終小節。
      const prog = varyProgression(progById.get(song.sections[3].progressionId), 2);
      const chords = prog.bars.map((b) => b.chord);
      const tonic = song.mode === 'major' ? 'I' : 'i';
      assert.equal(chords[chords.length - 1], tonic, `${seed}/${bars}: 最終小節が主和音でない`);
      if (chords[chords.length - 2] === (song.mode === 'major' ? 'iv' : 'VI')) subdominant++;

      // 最後の音は最終小節の終わりまで伸び、主音へ着地する。
      const tail = song.melody.reduce((a, b) => (b.beat >= a.beat ? b : a));
      assert.ok(tail.dur >= 3, `${seed}/${bars}: 最後の音が短い (${tail.dur})`);
      assert.ok(tail.beat + tail.dur >= song.totalBeats,
        `${seed}/${bars}: 最後の音が最終小節を埋めていない`);
      // 着地する主音は「最終セクションの主音」。転調した曲では新しい調の主音になる
      // （転調しない曲では song.tonicMidi と同じなので、この式は従来と同じ意味）。
      if ((((tail.midi - song.sections[3].tonicMidi) % 12) + 12) % 12 === 0) melodyTonic++;
      // 最高音がただ一度だけ、という保証を最後の1音が壊していないこと。
      const top = Math.max(...song.melody.map((x) => x.midi));
      assert.equal(song.melody.filter((x) => x.midi === top).length, 1,
        `${seed}/${bars}: 最後の音が最高音に並んだ`);

      // 最終小節は刻みを止めて和音を保持し、パッドは小節をはみ出して余韻を作る。
      const lastBeat = (song.bars - 1) * 4;
      const inLast = song.accomp.filter((x) => x.beat >= lastBeat);
      assert.equal(inLast.length, 1, `${seed}/${bars}: 最終小節の伴奏が ${inLast.length} イベント`);
      assert.equal(inLast[0].dur, 4);
      assert.ok(inLast[0].midis.length >= 3);
      assert.equal(song.pad[song.bars - 1].dur, 6, `${seed}/${bars}: パッドの余韻が無い`);

      // 出だしは拍0から。弱起で始まるとどこが1拍目か掴めない。
      const head = song.melody.reduce((a, b) => (b.beat < a.beat ? b : a));
      if (head.beat === 0) downbeat++;
    }
  }
  assert.ok(songs >= 100, `曲数が足りない: ${songs}`);
  assert.ok(subdominant / songs >= 0.8,
    `終止前がサブドミナントマイナーの曲が少ない: ${(100 * subdominant / songs).toFixed(1)}%`);
  assert.ok(melodyTonic / songs >= 0.9,
    `最後の音が主音でない曲が多い: ${(100 * melodyTonic / songs).toFixed(1)}%`);
  assert.ok(downbeat / songs >= 0.8,
    `弱起で始まる曲が多い: ${(100 * downbeat / songs).toFixed(1)}%`);
});

// ---------------------------------------------------------------------------
// 実データ: 楽節計画・舞い上がり・息継ぎ
//
// 「曲が良くなったか」は600曲（200シード×3つの長さ）の実測でしか言えない。
// ---------------------------------------------------------------------------

const endingHoldOf = (m) => (m?.notes?.length ? Number(m.notes[m.notes.length - 1].dur) || 0 : 0);

test('実データ: 楽節計画がフレーズを2小節ぞろいから外す', realOpts, () => {
  const count = new Map();
  let sections = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      const slots = slotsPerSection(song);
      for (const sec of song.sections) {
        sections++;
        assert.equal(sec.phrasePlan.reduce((a, b) => a + b, 0), slots,
          `${seed}/${bars} ${sec.name}: 計画の合計が違う`);
        assert.deepEqual(sec.slots.map((sl) => sl.phraseEnd), phraseEndFlags(sec.phrasePlan, slots),
          `${seed}/${bars} ${sec.name}: フレーズ末フラグが計画と食い違う`);
        const key = JSON.stringify(sec.phrasePlan);
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    }
  }
  assert.ok(sections >= 800, `セクションが少ない: ${sections}`);
  let even = 0;
  for (const [key, n] of count) if (!JSON.parse(key).some((g) => g >= 2)) even += n;
  const four = 1 - even / sections;
  const show = `4小節フレーズを含む ${(100 * four).toFixed(1)}% / 2小節ぞろい ${(100 * even / sections).toFixed(1)}%`;
  // 大半のセクションが2小節で切り揃わないこと。ただし従来の形も残っていること。
  assert.ok(four >= 0.6, `フレーズが2小節ぞろいのままだ: ${show}`);
  assert.ok(even / sections >= 0.05, `2小節ぞろいの計画が消えた: ${show}`);
});

test('実データ: フレーズ途中は次へ流れ、フレーズ末で息継ぎする', realOpts, () => {
  // フレーズ途中のスロットは終止感の無い断片を、フレーズ末は終止感のある断片を採る。
  // 途中が閉じずに次の小節へ流れ込むから、2小節の断片2つが4小節の1フレーズに聴こえる。
  //
  // 選び直したスロット（source === 'select'）だけを見る。再登場と移調のスロットは
  // 断片を選び直していないので、絞り込みの効き目は測れない。
  const stat = {
    mid: { n: 0, noTag: 0, quick: 0 },
    end: { n: 0, noTag: 0, quick: 0 },
  };
  const pool = { tagged: 0, n: REAL.melodies.length };
  for (const m of REAL.melodies) if (hasLongEnding(m)) pool.tagged++;

  walkSlots(REAL_SEEDS, ['16', '32', '64'], ({ slot, fragment }) => {
    if (!fragment || slot.source !== 'select') return;
    const b = stat[slot.phraseEnd ? 'end' : 'mid'];
    b.n++;
    if (!hasLongEnding(fragment)) b.noTag++;
    if (endingHoldOf(fragment) < 2) b.quick++;
  });
  assert.ok(stat.mid.n >= 300 && stat.end.n >= 300, `標本が少ない: ${stat.mid.n}/${stat.end.n}`);

  const rate = (b, key) => stat[b][key] / stat[b].n;
  const show = (key) => `途中 ${(100 * rate('mid', key)).toFixed(1)}% (${stat.mid[key]}/${stat.mid.n})`
    + ` / 末 ${(100 * rate('end', key)).toFixed(1)}% (${stat.end[key]}/${stat.end.n})`;

  // 断片プールが long-ending タグで区別できるデータなら、タグそのもので差が出ること。
  // タグが全断片に付いている（または1つも無い）データでは、タグでは何も測れないので、
  // 実装の第2段＝「最後の音を伸ばすかどうか」で同じ差を要求する。
  const usable = pool.tagged > 0.05 * pool.n && pool.tagged < 0.95 * pool.n;
  if (usable) {
    assert.ok(rate('mid', 'noTag') - rate('end', 'noTag') >= 0.2,
      `long-ending を持たない断片の差が20ポイント未満: ${show('noTag')}`);
  } else {
    assert.equal(rate('mid', 'noTag'), rate('end', 'noTag'),
      `タグが区別に使えないはずなのに差が出ている（${pool.tagged}/${pool.n}）: ${show('noTag')}`);
  }
  assert.ok(rate('mid', 'quick') - rate('end', 'quick') >= 0.2,
    `終止を伸ばすかどうかの差が20ポイント未満: ${show('quick')}`);
  // フレーズ末はしっかり閉じ、途中はしっかり流れていること（片側だけでは意味が無い）。
  assert.ok(rate('mid', 'quick') >= 0.6, `フレーズ途中が閉じすぎ: ${show('quick')}`);
  assert.ok(rate('end', 'quick') <= 0.4, `フレーズ末が閉じていない: ${show('quick')}`);
});

test('実データ: クライマックスは舞い上がって頂点に届く', realOpts, () => {
  // 頂点に効くのは高さではなく到達の仕方。跳び上がって着地し、順次で降りてくる。
  let n = 0;
  let soar = 0;
  let single = 0;
  let high = 0;
  walkSlots(REAL_SEEDS, ['16', '32', '64'], ({ si, k, slots, slot, fragment }) => {
    if (si !== 2 || k !== climaxSlot(slots)) return;
    assert.notEqual(slot.source, 'fallback', 'クライマックスが fallback で埋まった');
    if (!fragment) return;
    n++;
    if (fragment.peakCount === 1) single++;
    if (fragment.peakDeg >= 12) high++;
    if (soarsToPeak(fragment)) soar++;
  });
  assert.ok(n >= 400, `頂点の標本が少ない: ${n}`);
  // peakDeg >= 12 と peakCount === 1 は必須のまま（舞い上がりはその中での優先）。
  assert.equal(single, n, `頂点に peakCount > 1 の断片が入った: ${single}/${n}`);
  assert.equal(high, n, `頂点に peakDeg < 12 の断片が入った: ${high}/${n}`);
  const rate = soar / n;
  assert.ok(rate >= 0.6,
    `舞い上がって届く頂点が少ない: ${(100 * rate).toFixed(1)}% (${soar}/${n})`);
});

test('実データ: 息継ぎが1曲に最大1回、A か A\' のフレーズ末に置かれる', realOpts, () => {
  let songs = 0;
  let breaths = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      songs++;
      const slots = slotsPerSection(song);
      const cs = climaxSlot(slots);
      const marked = [];
      song.sections.forEach((sec, si) => {
        sec.slots.forEach((slot, k) => { if (slot.breath) marked.push({ si, k, sec }); });
      });
      assert.ok(marked.length <= 1, `${seed}/${bars}: 息継ぎが${marked.length}回`);
      if (song.breathBar === null) continue;
      breaths++;
      const { si, k, sec } = marked[0];
      assert.ok(si === 0 || si === 1, `${seed}/${bars}: 息継ぎが ${SECTION_NAMES[si]} にある`);
      assert.equal(sec.slots[k].phraseEnd, true, `${seed}/${bars}: フレーズ途中で息継ぎした`);
      assert.equal(song.breathBar, sec.startBar + 2 * k + 1, `${seed}/${bars}: スロットの2小節目でない`);
      const g = si * slots + k;
      assert.ok(g > 0 && g < 4 * slots - 1, `${seed}/${bars}: 曲の端で息継ぎした`);
      assert.ok(Math.abs(g - (2 * slots + cs)) > 1, `${seed}/${bars}: 頂点の周りで息継ぎした`);
      assert.equal(sec.slots[k].reusedFrom, null, `${seed}/${bars}: 再登場のスロットを削った`);
      assertNoSilentBar(song, `${seed}/${bars}`);
    }
  }
  assert.ok(songs >= 200, `曲数が足りない: ${songs}`);
  const rate = breaths / songs;
  assert.ok(rate >= 0.8, `息継ぎがほとんど起きていない: ${(100 * rate).toFixed(1)}% (${breaths}/${songs})`);
});

test('実データ: ベースと伴奏が隣の小節へ滑らかにつながる', realOpts, () => {
  // 各和音を独立にオクターブ正規化すると、下降ベースが最初の1歩で7度跳ね上がる。
  // 前の小節を見てオクターブを選び直すと、平均の移動量がはっきり小さくなる。
  const progById = new Map(REAL.progressions.map((p) => [p.id, p]));
  const chordsOf = (song, si) => {
    const prog = varyProgression(progById.get(song.sections[si].progressionId), SECTION_LEVELS[si]);
    const out = [];
    for (let r = 0; r < song.bars / 16; r++) for (const b of prog.bars) out.push(b.chord);
    return withPivot(song, si, out);
  };
  let after = 0;
  let before = 0;
  let accomp = 0;
  let songs = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS.slice(0, 100)) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      songs++;
      after += meanStep(song.bass.map((n) => n.midi));
      before += meanStep(rawBassLine(song, chordsOf));
      const lows = [];
      for (let bar = 0; bar < song.bars; bar++) {
        const inBar = song.accomp.filter((n) => Math.floor(n.beat / 4) === bar);
        lows.push(Math.min(...inBar.map((n) => n.midi)));
      }
      accomp += meanStep(lows);
      for (const m of allMidis(song)) assert.ok(m >= 21 && m <= 108, `${seed}: 音域外 ${m}`);
      // 層（ベース <= 伴奏 <= パッド）が入れ替わっていないこと。
      // 同度は許す。旋律が低く歌う小節では、伴奏がベースと同じ高さまで降りて
      // 旋律の下へ回る（左手が根音を重ねる普通の書き方）。禁じるのは
      // 「伴奏がベースより下へ潜る」ほうだけで、そこが崩れると土台が濁る。
      for (let bar = 0; bar < song.bars; bar++) {
        const inBar = song.accomp.filter((n) => Math.floor(n.beat / 4) === bar);
        const lo = Math.min(...inBar.map((n) => n.midi));
        assert.ok(song.bass[bar].midi <= lo, `${seed}/${bar}: ベースが伴奏より上`);
        assert.ok(lo <= Math.min(...song.pad[bar].midis), `${seed}/${bar}: 伴奏がパッドより上`);
      }
    }
  }
  assert.ok(songs >= 100, `曲数が足りない: ${songs}`);
  const show = `修正後 ${(after / songs).toFixed(2)} / 修正前 ${(before / songs).toFixed(2)}`
    + ` / 伴奏 ${(accomp / songs).toFixed(2)} 半音`;
  assert.ok(after / songs <= 7, `隣接小節のベースが跳ね回っている: ${show}`);
  assert.ok(accomp / songs <= 7, `隣接小節の伴奏が跳ね回っている: ${show}`);
  // 正規化したままより確実に小さくなること。効き目がいちばん出るのは下降ベースの
  // 進行で、その効果は下の「下降ベースの進行で、ベースが実際に下降する」で測る。
  assert.ok(before / songs - after / songs >= 0.3, `正規化したままと大差ない: ${show}`);
});

// 「下降ベースの進行」＝隣り合う和音の根音が、音名として1〜4半音ずつ下がる形。
// I - V/3 - vi - I/5 なら C→B→A→G で 1, 2, 2 半音。バラードの背骨。
function isDescendingBass(chords, mode, tonicMidi) {
  const pcs = chords.map((c) => ((bassMidi(c, mode, tonicMidi, 36) % 12) + 12) % 12);
  for (let i = 1; i < pcs.length; i++) {
    const d = ((pcs[i - 1] - pcs[i]) % 12 + 12) % 12;
    if (d < 1 || d > 4) return false;
  }
  return true;
}

test('実データ: 下降ベースの進行で、ベースが実際に下降する', realOpts, () => {
  const progById = new Map(REAL.progressions.map((p) => [p.id, p]));
  let checked = 0;
  let descending = 0;
  let rawDescending = 0;
  const samples = [];
  const nonIncreasing = (line) => line.every((v, i) => i === 0 || v <= line[i - 1]);
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      // A（セクション0）と B（セクション2）は level 0 ＝ 進行そのまま。
      // どちらもセクション頭の4小節が進行の4小節に対応する。
      for (const si of [0, 2]) {
        const prog = progById.get(song.sections[si].progressionId);
        const chords = prog.bars.map((b) => b.chord);
        if (!isDescendingBass(chords, song.mode, song.tonicMidi)) continue;
        checked++;
        const from = song.sections[si].startBar;
        const line = song.bass.slice(from, from + 4).map((n) => n.midi);
        if (nonIncreasing(line)) descending++;
        else if (samples.length < 5) samples.push(`${seed}/${bars} ${chords.join('-')}: ${line.join(' → ')}`);
        // 修正前（各和音を独立に正規化した並び）は、ここで跳ね上がっていたはず。
        if (nonIncreasing(chords.map((c) => bassMidi(c, song.mode, song.tonicMidi, 36)))) rawDescending++;
      }
    }
  }
  assert.ok(checked >= 30, `下降ベースの進行を使った曲が少ない: ${checked}`);
  const rate = descending / checked;
  const rawRate = rawDescending / checked;
  const show = `修正後 ${(100 * rate).toFixed(1)}% (${descending}/${checked})`
    + ` / 修正前 ${(100 * rawRate).toFixed(1)}%`;
  assert.ok(rate >= 0.95, `下降しない曲が多い: ${show}\n${samples.join('\n')}`);
  assert.ok(rate > rawRate, `正規化したままと変わらない: ${show}`);
});

// ---------------------------------------------------------------------------
// 実データ: 最終セクションの転調
//
// 70〜80年代のアメリカとイタリアのラブソング、そして韓国のバラード。
// 3つの伝統に共通する最大の高揚装置が「最後のサビで半音か全音上がる」で、
// これは断片の組み立てだけでは絶対に出てこない。
//
// 転調は既存の保証をまとめて壊しうる（最高音の一回性・終止・音域）。
// だから 600曲（200シード×3つの長さ）の実測で、壊れていないことを毎回確かめる。
// ---------------------------------------------------------------------------

const pcOf = (midi) => ((midi % 12) + 12) % 12;

// その小節で実際に鳴っている音名（ベース・伴奏・パッド）。
function soundingPitchClasses(song, bar) {
  const out = new Set([pcOf(song.bass[bar].midi)]);
  for (const m of song.pad[bar].midis) out.add(pcOf(m));
  for (const n of song.accomp) {
    if (Math.floor(n.beat / 4) !== bar) continue;
    for (const m of n.midis ?? [n.midi]) out.add(pcOf(m));
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * その小節で鳴っているのが、指定した和音の構成音だけであることを検査する。
 *
 * 一致（deepEqual）ではなく部分集合で見る。伴奏とパッドは旋律の下へ収めるために
 * 上の音を落とすことがあり、和音の第5音などが鳴らない小節が出る。
 * 和音が違うことと、和音の一部を省くことは別の話なので、
 * ここで見張るのは「よその音が鳴っていないこと」と「根音が居ること」。
 */
function assertChordOnly(song, bar, symbol, tonicMidi, message) {
  const want = chordPcsOn(symbol, song.mode, tonicMidi);
  const got = soundingPitchClasses(song, bar);
  for (const pc of got) assert.ok(want.includes(pc), `${message}: 和音外の音 ${pc}`);
  assert.ok(got.length >= 2, `${message}: 鳴っている音が少なすぎる`);
}

function chordPcsOn(symbol, mode, tonicMidi) {
  return [...new Set(chordPitchClasses(symbol, mode).map((s) => pcOf(s + tonicMidi)))]
    .sort((a, b) => a - b);
}

test('実データ: 転調率が30〜50%で、上げ幅は +1 か +2 だけ', realOpts, () => {
  let songs = 0;
  let modulated = 0;
  const steps = new Map();
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      songs++;
      const m = song.modulation;
      if (m === null) {
        // 転調しない曲は、全セクションが曲の主音のまま。
        for (const sec of song.sections) {
          assert.equal(sec.tonicMidi, song.tonicMidi,
            `${seed}/${bars}: 転調していないのに ${sec.name} の主音が違う`);
        }
        continue;
      }
      modulated++;
      assert.ok(m.semitones === 1 || m.semitones === 2,
        `${seed}/${bars}: 上げ幅が +${m.semitones}`);
      steps.set(m.semitones, (steps.get(m.semitones) ?? 0) + 1);
      assert.equal(m.atBar, song.sections[3].startBar, `${seed}/${bars}: atBar が A'' の頭でない`);
      assert.equal(m.fromTonicMidi, song.tonicMidi);
      assert.equal(m.toTonicMidi, song.tonicMidi + m.semitones);
      assert.equal(song.sections[3].tonicMidi, song.tonicMidi + m.semitones,
        `${seed}/${bars}: A'' の主音が転調ぶん上がっていない`);
      for (const si of [0, 1, 2]) {
        assert.equal(song.sections[si].tonicMidi, song.tonicMidi,
          `${seed}/${bars}: ${SECTION_NAMES[si]} まで一緒に動いている`);
      }
    }
  }
  assert.ok(songs >= 200, `曲数が足りない: ${songs}`);
  const rate = modulated / songs;
  const up1 = steps.get(1) ?? 0;
  const up2 = steps.get(2) ?? 0;
  const show = `${(100 * rate).toFixed(1)}% (${modulated}/${songs}) +1:${up1} +2:${up2}`;
  assert.ok(rate >= 0.30 && rate <= 0.50, `転調率が設定(40%)から外れている: ${show}`);
  // 上げ幅は調号の近さで重みを付けて引くので半々にはならないが、
  // どちらかが消えてはいけない（半音上げはバラードの定石そのもの）。
  assert.ok(up1 / modulated >= 0.15 && up2 / modulated >= 0.15, `上げ幅が偏りきっている: ${show}`);
});

test('実データ: 転調した曲でも、最高音が曲中ちょうど1回・B の中で鳴る', realOpts, () => {
  // 転調で最初に壊れるのがここ。A'' 全体が持ち上がるので、B のクライマックスを
  // 追い越すか、並ぶ（長調 +2 なら deg11 が deg12 と同じ高さになる）。
  let checked = 0;
  let minGap = Infinity;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      if (song.modulation === null) continue;
      checked++;
      const label = `${seed}/${bars} +${song.modulation.semitones}`;
      const top = Math.max(...song.melody.map((n) => n.midi));
      const hits = song.melody.filter((n) => n.midi === top);
      assert.equal(hits.length, 1, `${label}: 最高音が${hits.length}回`);
      const from = song.sections[2].startBar * 4;
      const to = song.sections[3].startBar * 4;
      assert.ok(hits[0].beat >= from && hits[0].beat < to,
        `${label}: 頂点が B の外 (${hits[0].beat} ∉ [${from}, ${to}))`);
      assert.equal(song.climaxBeat, hits[0].beat, `${label}: climaxBeat が頂点と違う`);
      // 転調した A'' の最高音は、頂点より必ず低い。
      const inA2 = song.melody.filter((n) => n.beat >= to).map((n) => n.midi);
      const gap = top - Math.max(...inA2);
      assert.ok(gap > 0, `${label}: A'' が頂点に並んだ`);
      minGap = Math.min(minGap, gap);
    }
  }
  assert.ok(checked >= 150, `転調した曲が少ない: ${checked}`);
  assert.ok(minGap >= 1, `頂点と A'' の差: ${minGap} 半音`);
});

test('実データ: 転調した曲は、新しい調で閉じる', realOpts, () => {
  // 上がったまま元の調で終わると、曲が終わらない。最後の音も最後の和音も
  // 「新しい調の主音・主和音」でなければならない。
  let checked = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      const m = song.modulation;
      if (m === null) continue;
      checked++;
      const label = `${seed}/${bars} +${m.semitones}`;

      // 最後の音は、新しい調の主音を最終小節の終わりまで伸ばす。
      const tail = song.melody.reduce((a, b) => (b.beat >= a.beat ? b : a));
      assert.equal(pcOf(tail.midi - m.toTonicMidi), 0, `${label}: 最終音が新しい調の主音でない`);
      assert.notEqual(pcOf(tail.midi - m.fromTonicMidi), 0, `${label}: 元の調の主音のまま`);
      assert.ok(tail.dur >= 3, `${label}: 最後の音が短い (${tail.dur})`);
      assert.ok(tail.beat + tail.dur >= song.totalBeats, `${label}: 最後の音が最終小節を埋めていない`);

      // 最終小節に鳴っているのは、新しい調の主和音の構成音だけ。
      const lastBar = song.bars - 1;
      const tonicChord = song.mode === 'major' ? 'I' : 'i';
      assertChordOnly(song, lastBar, tonicChord, m.toTonicMidi,
        `${label}: 最終小節が新しい調の主和音でない`);
      assert.equal(pcOf(song.bass[lastBar].midi - m.toTonicMidi), 0,
        `${label}: 最終小節のベースが新しい主音でない`);
      // 直前の小節は陰りのサブドミナントマイナー（アーメン終止）。これも新しい調で。
      const sub = song.mode === 'major' ? 'iv' : 'VI';
      assertChordOnly(song, lastBar - 1, sub, m.toTonicMidi,
        `${label}: 終止直前が新しい調のサブドミナントマイナーでない`);
    }
  }
  assert.ok(checked >= 150, `転調した曲が少ない: ${checked}`);
});

test('実データ: 転調のつなぎ目が、新しい調のドミナントになっている', realOpts, () => {
  // B の最後からいきなり半音上がると唐突に聴こえる。属和音を1小節挟んで、
  // 耳が新しい調を受け入れてから A'' へ入る。
  const progById = new Map(REAL.progressions.map((p) => [p.id, p]));
  let withPivotBar = 0;
  let withoutPivotBar = 0;
  let downbeat = 0;
  let toTonicChord = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      const m = song.modulation;
      if (m === null) continue;
      const label = `${seed}/${bars} +${m.semitones}`;
      const headBeat = m.atBar * 4;
      const head = song.melody.filter((n) => n.beat >= headBeat)
        .reduce((a, b) => (b.beat < a.beat ? b : a));
      if (head.beat === headBeat) downbeat++;

      if (m.pivotBar === null) {
        // 頂点のスロットと重なる長さ（16小節）では属和音を置けない。
        // そのときは A'' の頭を拍0から鳴らして境目を示す（下でまとめて検査）。
        withoutPivotBar++;
        assert.equal(song.bars, 16, `${label}: 16小節以外でつなぎ目が無い`);
        continue;
      }
      withPivotBar++;
      assert.equal(m.pivotBar, m.atBar - 1, `${label}: つなぎ目が A'' の直前でない`);
      assert.ok(['V', 'V7'].includes(m.pivotChord), `${label}: つなぎ目が ${m.pivotChord}`);
      assert.equal(m.pivotBar, song.sections[3].startBar - 1);
      // その小節は既に新しい調で鳴っていて、根音は新しい主音の5度上（＝新調のドミナント）。
      assertChordOnly(song, m.pivotBar, m.pivotChord, m.toTonicMidi,
        `${label}: つなぎ目が新しい調のドミナントで鳴っていない`);
      assert.equal(pcOf(song.bass[m.pivotBar].midi - m.toTonicMidi), 7,
        `${label}: つなぎ目のベースが新しい調の属音でない`);
      // 元の調のドミナントではないこと（＝ただの V ではなく、上がった先の V）。
      assert.notEqual(pcOf(song.bass[m.pivotBar].midi - m.fromTonicMidi), 7,
        `${label}: 元の調のドミナントのまま`);
      // その次の小節（A'' の頭）は、A'' の進行の1小節目を**新しい調で**鳴らす。
      // 進行はセクションごとに違うので必ず主和音とは限らないが、
      // 「新しい調で鳴っていること」だけは全曲で成り立つ。
      const prog = varyProgression(progById.get(song.sections[3].progressionId), SECTION_LEVELS[3]);
      const headChord = prog.bars[0].chord;
      assertChordOnly(song, m.atBar, headChord, m.toTonicMidi,
        `${label}: A'' の頭が新しい調で鳴っていない (${headChord})`);
      if (pcOf(song.bass[m.atBar].midi - m.toTonicMidi) === 0) toTonicChord++;
    }
  }
  assert.ok(withPivotBar >= 100, `つなぎ目を検査した曲が少ない: ${withPivotBar}`);
  assert.ok(withoutPivotBar > 0, '16小節の転調が1曲も無い（検査になっていない）');
  // どちらの形でも、A'' は弱起にせず1拍目からはっきり始める。
  assert.equal(downbeat, withPivotBar + withoutPivotBar,
    `A'' が弱起で始まる転調がある: ${downbeat}/${withPivotBar + withoutPivotBar}`);
  // V → I で着地できるのは A'' の進行が主和音で始まるときだけ。半分は超えていてほしい
  // （半分を割るなら、つなぎ目が置かれる場所そのものを疑うべき）。
  assert.ok(toTonicChord / withPivotBar >= 0.5,
    `つなぎ目が主和音へ解決する曲が少ない: ${toTonicChord}/${withPivotBar}`);
});

test('実データ: 転調した曲でも、既存の保証がすべて残っている', realOpts, () => {
  // fallback 0・無音の小節なし・音域・決定論・楽節の導出・クライマックスの舞い上がり。
  const byId = new Map(REAL.melodies.map((m) => [m.id, m]));
  let songs = 0;
  let derived = 0;
  let total = 0;
  let soaring = 0;
  const sources = {};
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS.slice(0, 80)) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      if (song.modulation === null) continue;
      songs++;
      const label = `${seed}/${bars} +${song.modulation.semitones}`;
      assertNoSilentBar(song, label);
      for (const midi of allMidis(song)) {
        assert.ok(midi >= 21 && midi <= 108, `${label}: 音域外 ${midi}`);
      }
      assert.equal(JSON.stringify(song), JSON.stringify(composeSong(seed, REAL, S({ songBars: bars }))),
        `${label}: 同じシードで同じ曲にならない`);

      const slots = slotsPerSection(song);
      const cs = climaxSlot(slots);
      const roles = phraseRoles(slots);
      song.sections.forEach((sec, si) => {
        sec.slots.forEach((slot, k) => {
          sources[slot.source] = (sources[slot.source] ?? 0) + 1;
          assert.notEqual(slot.fragmentId, 'fallback', `${label}: ${sec.name}:${k} で fallback`);
          if (si === 2 && k === cs) return;
          if (!roles[k].derive || slot.reusedFrom !== null) return;
          total++;
          if (slot.derivedFrom !== null) derived++;
        });
      });
      // クライマックスは跳び上がって届き、順次で降りる。
      const climax = fragmentOf(song.sections[2].slots[cs], byId);
      if (climax && soarsToPeak(climax)) soaring++;
    }
  }
  assert.ok(songs >= 60, `転調した曲が少ない: ${songs}`);
  const rate = derived / total;
  assert.ok(rate >= 0.95,
    `導出された割合が低い: ${(100 * rate).toFixed(1)}% (${derived}/${total}) ${JSON.stringify(sources)}`);
  assert.equal(sources.fallback ?? 0, 0, 'fallback が出ている');
  assert.ok(soaring / songs >= 0.95,
    `クライマックスの舞い上がりが減った: ${(100 * soaring / songs).toFixed(1)}%`);
});

test('実データ: 転調は A\'\' を実際に高く鳴らす', realOpts, () => {
  // 記録だけ書き換えて音が上がっていなければ意味がない。
  // 主音からの高さ（半音）の平均を、転調した曲と転調しない曲で比べる。
  const rel = { 0: [], 1: [], 2: [] };
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      const semitones = song.modulation ? song.modulation.semitones : 0;
      const from = song.sections[3].startBar * 4;
      const notes = song.melody.filter((n) => n.beat >= from);
      assert.ok(notes.length > 0, `${seed}/${bars}: A'' にメロディーが無い`);
      rel[semitones].push(meanOf(notes.map((n) => n.midi)) - song.tonicMidi);
    }
  }
  assert.ok(rel[1].length >= 50 && rel[2].length >= 50,
    `標本が少ない: +1 ${rel[1].length} / +2 ${rel[2].length}`);
  const base = meanOf(rel[0]);
  const up1 = meanOf(rel[1]) - base;
  const up2 = meanOf(rel[2]) - base;
  const show = `非転調 ${base.toFixed(2)} / +1 で ${up1.toFixed(2)} / +2 で ${up2.toFixed(2)} 半音`;
  assert.ok(up1 >= 0.5, `+1 で A'' が上がっていない: ${show}`);
  assert.ok(up2 >= 1.2, `+2 で A'' が上がっていない: ${show}`);
  assert.ok(up2 > up1, `+2 が +1 より上がっていない: ${show}`);
});

test('実データ: 転調で調号が飛ばない（五度圏の距離）', realOpts, () => {
  // 「変ニ長調(♭5) から +1半音 で ニ長調(♯2)」は五度圏を7つ動く最悪の跳び方で、
  // 楽譜では橋渡しの小節に臨時記号が9個並ぶ。同じ変ニ長調でも +2半音 なら
  // 変ホ長調(♭3)＝距離2で、フラット系に留まったまま持ち上がる。
  // 上げ幅は「調号が近いほう」を強く優先して引くので、遠い跳び方はめったに出ない。
  const dist = [];
  const baseline = [];
  const steps = new Map();
  let songs = 0;
  for (const bars of ['16', '32', '64']) {
    for (const seed of REAL_SEEDS) {
      const song = composeSong(seed, REAL, S({ songBars: bars }));
      songs++;
      const m = song.modulation;
      if (m === null) continue;
      steps.set(m.semitones, (steps.get(m.semitones) ?? 0) + 1);
      const from = keyFifths(m.fromTonicMidi, song.mode);
      const to = keyFifths(m.toTonicMidi, song.mode);
      // 記録した主音から計算した距離が、実際に選ばれた上げ幅の距離と一致すること。
      assert.equal(Math.abs(to - from), keyDistance(m.fromTonicMidi, m.semitones, song.mode));
      dist.push(Math.abs(to - from));
      // 半々で機械的に引いていたら、この曲が持ったはずの距離（比較用）。
      baseline.push(keyDistance(m.fromTonicMidi, 1, song.mode));
      baseline.push(keyDistance(m.fromTonicMidi, 2, song.mode));
    }
  }
  assert.ok(songs >= 200, `曲数が足りない: ${songs}`);
  assert.ok(dist.length >= 100, `転調した曲が少ない: ${dist.length}`);
  const mean = meanOf(dist);
  const baseMean = meanOf(baseline);
  const far7 = dist.filter((d) => d >= 7).length;
  const far10 = dist.filter((d) => d >= 10).length;
  const up1 = steps.get(1) ?? 0;
  const up2 = steps.get(2) ?? 0;
  const show = `平均 ${mean.toFixed(2)}（半々なら ${baseMean.toFixed(2)}）`
    + ` / 距離7以上 ${far7}/${dist.length} / +1:${up1} +2:${up2}`;
  assert.ok(mean <= 3.0, `調号が遠い転調が多い: ${show}`);
  assert.ok(mean < baseMean - 1, `半々で引くのと大差ない: ${show}`);
  // 最悪の跳び方（距離7）は5%以下、綴りごと飛ぶ距離10は1曲も出さない。
  //
  // 「距離5以上を5%以下」にはできない。1半音 = 五度圏で7つ（反対回りに5つ）で、
  // **+1半音の転調はどう綴っても距離5以上にしかならない**（上の keyDistance の
  // 単体テストで固定してある）。+1 を15%以上残すという要求と両立しないので、
  // ここで潰すのは「5で済むのに7も動く」ほうだけにしてある。
  assert.ok(far7 / dist.length <= 0.05, `最悪の跳び方が多い: ${show}`);
  assert.equal(far10, 0, `綴りごと飛ぶ転調がある: ${show}`);
  // 近さを優先しても、+1 と +2 の両方が残っていること。
  assert.ok(up1 / dist.length >= 0.15, `+1半音がほとんど出ない: ${show}`);
  assert.ok(up2 / dist.length >= 0.15, `+2半音がほとんど出ない: ${show}`);
});
