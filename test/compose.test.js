import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CHORD_VOCAB, chordIndex, isChordTone, splitBars, fitsBar, hasSuspension,
} from '../src/theory.js';
import { defaultSettings } from '../src/settings.js';
import {
  SECTION_NAMES, climaxSlot, curveFor, varyProgression,
  passesFilters, selectFragment, composeSong,
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
function variantsOfBar(prog, index) {
  const sym = prog.bars[index].chord;
  const out = [sym];
  if (index === 1 && !sym.includes('/') && chordIndex(prog.mode, `${sym}/3`) >= 0) {
    out.push(`${sym}/3`);
  }
  if (index === prog.bars.length - 1) {
    const sub = prog.mode === 'major' ? 'iv' : 'VI';
    if (chordIndex(prog.mode, sub) >= 0 && sub !== sym) out.push(sub);
  }
  return out;
}

// スロットが覆う2小節は (0,1) と (2,3) の組み合わせだけ。
function requiredPairs() {
  const seen = new Map();
  for (const p of FIX_PROGRESSIONS) {
    for (const [ia, ib] of [[0, 1], [2, 3]]) {
      for (const chordA of variantsOfBar(p, ia)) {
        for (const chordB of variantsOfBar(p, ib)) {
          seen.set(`${p.mode}|${chordA}|${chordB}`, { mode: p.mode, chordA, chordB });
        }
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
    for (const start of [4, 5, 6, 7, 8]) {
      assert.ok(list.some((m) => m.startDeg === start), `${mode} ${chordA}->${chordB}: 開始音 ${start} が無い`);
    }
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

test('隣り合うスロットの接続が滑らか', () => {
  for (const maxLeap of [2, 3]) {
    for (const seed of SEEDS) {
      const song = composeSong(seed, DATA, S({ maxLeap, motifRecall: false }));
      const slots = slotsPerSection(song);
      const cs = climaxSlot(slots);
      let prevEnd = null;
      song.sections.forEach((sec, si) => {
        sec.slots.forEach((slot, k) => {
          const frag = BY_ID.get(slot.fragmentId);
          assert.ok(frag, `断片が見つからない: ${slot.fragmentId}`);
          const exempt = k === 0 || (si === 2 && k === cs);
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
          const frag = BY_ID.get(slot.fragmentId);
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
        // A'' は着地なので、他より低い天井にする。
        assert.equal(c.maxPeak, si === 3 ? 10 : 11);
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

test('varyProgression: level 2 は最終小節をサブドミナントマイナーに差し替える', () => {
  const p = FIX_PROGRESSIONS.find((x) => x.id === 'fx-M1');
  assert.deepEqual(varyProgression(p, 2).bars.map((b) => b.chord), ['I', 'V/3', 'vi', 'iv']);
  const m = FIX_PROGRESSIONS.find((x) => x.id === 'fx-m2');
  assert.deepEqual(varyProgression(m, 2).bars.map((b) => b.chord), ['i', 'iv/3', 'VI', 'VI']);
  for (const mode of ['major', 'minor']) {
    assert.ok(chordIndex(mode, mode === 'major' ? 'iv' : 'VI') >= 0);
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
    assert.equal(song.accomp.length, song.bars * 4);
    for (let bar = 0; bar < song.bars; bar++) {
      assert.equal(song.pad[bar].beat, bar * 4);
      assert.equal(song.pad[bar].dur, 4);
      assert.ok(song.pad[bar].midis.length >= 3);
      assert.equal(song.bass[bar].beat, bar * 4);
      const inBar = song.accomp.filter((n) => Math.floor(n.beat / 4) === bar);
      assert.equal(inBar.length, 4);
      assert.deepEqual(inBar.map((n) => n.beat - bar * 4), [0, 1.5, 2, 3.5]);
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
