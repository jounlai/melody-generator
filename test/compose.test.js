import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CHORD_VOCAB, chordIndex, isChordTone, splitBars, fitsBar, hasSuspension,
} from '../src/theory.js';
import { defaultSettings } from '../src/settings.js';
import {
  SECTION_NAMES, climaxSlot, curveFor, rawTension, varyProgression,
  passesFilters, selectFragment, composeSong,
  transposeFragment, deriveFragment, phraseRoles, phraseOffsets, rhythmKey,
  progressionWeight, arpeggioIndex, isDarkChord,
} from '../src/compose.js';

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

// セクションが実際に使っている小節ごとのコードを復元する。
function barChordsOf(song, sectionIdx) {
  const sec = song.sections[sectionIdx];
  const base = FIX_PROGRESSIONS.find((p) => p.id === sec.progressionId);
  assert.ok(base, `未知の進行: ${sec.progressionId}`);
  const prog = varyProgression(base, SECTION_LEVELS[sectionIdx]);
  const out = [];
  for (let r = 0; r < song.bars / 4 / 4; r++) for (const b of prog.bars) out.push(b.chord);
  return out;
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

test('無音の小節が1つも無い', () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ songBars: bars }));
      const filled = new Set(song.melody.map((n) => Math.floor(n.beat / 4)));
      for (let bar = 0; bar < song.bars; bar++) {
        assert.ok(filled.has(bar), `${seed}/${bars}: ${bar}小節目が無音`);
      }
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
        const filled = new Set(song.melody.map((n) => Math.floor(n.beat / 4)));
        for (let bar = 0; bar < song.bars; bar++) {
          assert.ok(filled.has(bar), `${bar}小節目が無音`);
        }
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
    assert.deepEqual(climax, { tension: 5, maxPeak: 15, minPeak: 12 });

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
  // 語彙に無い転回形（iii/3）は諦めて原形を残す。
  const q = FIX_PROGRESSIONS.find((x) => x.id === 'fx-M3');
  assert.deepEqual(varyProgression(q, 1).bars.map((b) => b.chord), ['I', 'iii', 'IV', 'V']);
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
      assert.ok(song.pad[bar].midis.length >= 3);
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
      assert.ok(song.bass[bar].midi < Math.min(...inBar.map((n) => n.midi)));
      assert.ok(Math.min(...inBar.map((n) => n.midi)) <= Math.min(...song.pad[bar].midis));
    }
  }
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
  assert.deepEqual(phraseOffsets(0, "a'"), [0, 1, 2, -1, 3, -2]);
  assert.deepEqual(phraseOffsets(0, "a''"), [1, 2, 0, 3, -1, -2]);
  assert.deepEqual(phraseOffsets(1, "a'"), [1, 2, 3, 0, -1]);
  assert.deepEqual(phraseOffsets(1, "a''"), [2, 3, 1, 0, -1]);
  assert.deepEqual(phraseOffsets(2, "a'"), [2, 3, 1, 4, 0]);
  assert.deepEqual(phraseOffsets(2, "a''"), [3, 4, 2, 1, 0]);
  assert.deepEqual(phraseOffsets(3, "a'"), [0, -1, -2, 1, -3]);
  assert.deepEqual(phraseOffsets(3, "a''"), [-2, -3, -1, 0, -4]);

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
        const chords = [];
        for (let r = 0; r < song.bars / 4 / 4; r++) for (const b of prog.bars) chords.push(b.chord);
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
      const filled = new Set(song.melody.map((n) => Math.floor(n.beat / 4)));
      for (let bar = 0; bar < song.bars; bar++) assert.ok(filled.has(bar), `${seed}: ${bar}小節が無音`);
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
        const chords = [];
        for (let r = 0; r < song.bars / 16; r++) for (const b of prog.bars) chords.push(b.chord);
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
      if ((((tail.midi - song.tonicMidi) % 12) + 12) % 12 === 0) melodyTonic++;
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
