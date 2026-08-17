import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  keySignature,
  keyTimeline,
  spellNote,
  durationSymbol,
  splitAtBarlines,
  renderScore,
} from '../src/notation.js';
import { composeSong } from '../src/compose.js';
import { resolveSettings } from '../src/settings.js';

// ---------------------------------------------------------------------------
// フィクスチャ
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
const SEEDS = ['a3f91c', 'b7e210', 'c0d4a9', 'd5f382', 'e91b7c', 'f2a615', '0b8c3d', '17e9f4', '2c6a8b', '3d5e70'];

function song(seed, bars = '32') {
  return composeSong(seed, REAL, resolveSettings({ songBars: bars }));
}

/** marker で始まる <g> を、入れ子を数えながら丸ごと切り出す */
function groupChunk(svg, marker) {
  const start = svg.indexOf(marker);
  if (start < 0) return null;
  let depth = 0;
  let i = start;
  while (i < svg.length) {
    const open = svg.indexOf('<g', i);
    const close = svg.indexOf('</g>', i);
    if (close < 0) return null;
    if (open >= 0 && open < close) {
      depth++;
      i = open + 2;
      continue;
    }
    depth--;
    if (depth === 0) return svg.slice(start, close + 4);
    i = close + 4;
  }
  return null;
}

/** <g class="note"> のブロックを全部切り出して、層・拍・臨時記号を取り出す */
function noteGroups(svg) {
  const out = [];
  let i = 0;
  for (;;) {
    const start = svg.indexOf('<g class="note"', i);
    if (start < 0) break;
    let depth = 0;
    let p = start;
    let end = svg.length;
    while (p < svg.length) {
      const open = svg.indexOf('<g', p);
      const close = svg.indexOf('</g>', p);
      if (close < 0) break;
      if (open >= 0 && open < close) {
        depth++;
        p = open + 2;
        continue;
      }
      depth--;
      if (depth === 0) {
        end = close + 4;
        break;
      }
      p = close + 4;
    }
    const block = svg.slice(start, end);
    const head = /data-layer="([^"]*)" data-beat="([-\d.]+)"/.exec(block);
    assert.ok(head, `音符の属性が読めない: ${block.slice(0, 80)}`);
    out.push({
      layer: head[1],
      beat: Number(head[2]),
      accidentals: [...block.matchAll(/data-acc="([^"]*)"/g)].map((m) => m[1]),
    });
    i = end;
  }
  return out;
}

/** 小節 from 以降の音符を「層@拍:臨時記号」の並びにする。描き方の比較用 */
function fingerprint(svg, fromBar) {
  return noteGroups(svg)
    .filter((n) => n.beat >= fromBar * 4)
    .map((n) => `${n.layer}@${n.beat}:${n.accidentals.join('')}`);
}

function accidentalCount(svg, fromBar) {
  return noteGroups(svg)
    .filter((n) => n.beat >= fromBar * 4)
    .reduce((sum, n) => sum + n.accidentals.length, 0);
}

/** 転調する曲だけを集める。転調は抽選なので、集まらなければテスト側で気づけるようにする */
function modulatedSongs(bars = '32') {
  return SEEDS.map((seed) => song(seed, bars)).filter((s) => s.modulation);
}

/**
 * 合成した転調曲。実データが無くても動く。
 * atBar から先の音を shift 半音上げ、契約どおりの modulation / sections を付ける。
 */
function modSynth(tonicMidi, shift, mode = 'major', bars = 4, atBar = 2) {
  // 主和音の4音（1 3 5 7）。どの調でも音階内に収まるので、
  // 臨時記号が出たら「調の取り違え」だと分かる。
  const steps = mode === 'minor' ? [0, 3, 7, 10] : [0, 4, 7, 11];
  const notes = [];
  const lows = [];
  for (let b = 0; b < bars; b++) {
    const up = b >= atBar ? shift : 0;
    for (let k = 0; k < 4; k++) {
      notes.push({ midi: tonicMidi + 12 + steps[k] + up, beat: b * 4 + k, dur: 1, vel: 0.5 });
    }
    lows.push({ midi: tonicMidi - 12 + up, beat: b * 4, dur: 4, vel: 0.5 });
  }
  return {
    seed: 'modsynth',
    mode,
    tonicMidi,
    tempo: 80,
    bars,
    totalBeats: bars * 4,
    climaxBeat: 0,
    breathBar: null,
    sections: [
      { name: 'A', progressionId: 'x', startBar: 0, tonicMidi, slots: [] },
      { name: "A''", progressionId: 'x', startBar: atBar, tonicMidi: tonicMidi + shift, slots: [] },
    ],
    modulation: {
      atBar,
      semitones: shift,
      fromTonicMidi: tonicMidi,
      toTonicMidi: tonicMidi + shift,
    },
    melody: notes,
    accomp: [],
    bass: lows,
    pad: [],
  };
}

const KEY_C = keySignature(60, 'major');
const KEY_F = keySignature(65, 'major');

// ---------------------------------------------------------------------------
// 1. keySignature：代表的な調
// ---------------------------------------------------------------------------

test('keySignature: ハ長調は臨時記号なし', () => {
  const k = keySignature(60, 'major');
  assert.equal(k.tonicName, 'C');
  assert.equal(k.accidental, 'none');
  assert.equal(k.count, 0);
  assert.equal(k.label, 'ハ長調');
});

test('keySignature: ト長調はシャープ1つ', () => {
  const k = keySignature(67, 'major');
  assert.deepEqual([k.tonicName, k.accidental, k.count, k.label], ['G', 'sharp', 1, 'ト長調']);
});

test('keySignature: ヘ長調はフラット1つ', () => {
  const k = keySignature(65, 'major');
  assert.deepEqual([k.tonicName, k.accidental, k.count, k.label], ['F', 'flat', 1, 'ヘ長調']);
});

test('keySignature: 変ロ長調はフラット2つ（嬰イ長調ではない）', () => {
  const k = keySignature(58, 'major');
  assert.deepEqual([k.tonicName, k.accidental, k.count, k.label], ['Bb', 'flat', 2, '変ロ長調']);
});

test('keySignature: ニ長調はシャープ2つ', () => {
  const k = keySignature(62, 'major');
  assert.deepEqual([k.tonicName, k.accidental, k.count, k.label], ['D', 'sharp', 2, 'ニ長調']);
});

test('keySignature: 変ホ長調はフラット3つ', () => {
  const k = keySignature(63, 'major');
  assert.deepEqual([k.tonicName, k.accidental, k.count, k.label], ['Eb', 'flat', 3, '変ホ長調']);
});

test('keySignature: イ長調はシャープ3つ', () => {
  const k = keySignature(57, 'major');
  assert.deepEqual([k.tonicName, k.accidental, k.count, k.label], ['A', 'sharp', 3, 'イ長調']);
});

test('keySignature: イ短調は臨時記号なし', () => {
  const k = keySignature(57, 'minor');
  assert.deepEqual([k.tonicName, k.accidental, k.count, k.label], ['A', 'none', 0, 'イ短調']);
});

test('keySignature: ホ短調はシャープ1つ', () => {
  const k = keySignature(64, 'minor');
  assert.deepEqual([k.tonicName, k.accidental, k.count, k.label], ['E', 'sharp', 1, 'ホ短調']);
});

test('keySignature: ニ短調はフラット1つ（平行調のヘ長調と同じ）', () => {
  const k = keySignature(62, 'minor');
  assert.deepEqual([k.tonicName, k.accidental, k.count, k.label], ['D', 'flat', 1, 'ニ短調']);
});

test('keySignature: ハ短調はフラット3つ', () => {
  const k = keySignature(60, 'minor');
  assert.deepEqual([k.tonicName, k.accidental, k.count, k.label], ['C', 'flat', 3, 'ハ短調']);
});

test('keySignature: 嬰ハ短調はシャープ4つ', () => {
  const k = keySignature(61, 'minor');
  assert.deepEqual([k.tonicName, k.accidental, k.count, k.label], ['C#', 'sharp', 4, '嬰ハ短調']);
});

test('keySignature: オクターブが違っても同じ調', () => {
  assert.deepEqual(keySignature(48, 'major'), keySignature(72, 'major'));
});

// ---------------------------------------------------------------------------
// 2. keySignature：曲が使う範囲すべて
// ---------------------------------------------------------------------------

test('keySignature: tonicMidi 56〜63 × major/minor の全16通りが破綻しない', () => {
  for (let tonic = 56; tonic <= 63; tonic++) {
    for (const mode of ['major', 'minor']) {
      const k = keySignature(tonic, mode);
      assert.ok(Number.isInteger(k.count), `${tonic}/${mode} の count が整数でない`);
      assert.ok(k.count >= 0 && k.count <= 7, `${tonic}/${mode} の count=${k.count}`);
      assert.ok(['sharp', 'flat', 'none'].includes(k.accidental), `${tonic}/${mode}`);
      assert.equal(k.accidental === 'none', k.count === 0, `${tonic}/${mode} の none と count が不一致`);
      assert.match(k.tonicName, /^[A-G][#b]?$/, `${tonic}/${mode} の tonicName=${k.tonicName}`);
      assert.match(k.label, mode === 'major' ? /長調$/ : /短調$/);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. spellNote：綴りと臨時記号
// ---------------------------------------------------------------------------

test('spellNote: ハ長調の midi 60 は C4、臨時記号なし', () => {
  assert.deepEqual(spellNote(60, KEY_C), {
    letter: 'C', octave: 4, accidental: '', diatonicIndex: 28,
  });
});

test('spellNote: ハ長調の midi 61 は C#4', () => {
  const s = spellNote(61, KEY_C);
  assert.equal(s.letter, 'C');
  assert.equal(s.octave, 4);
  assert.equal(s.accidental, '#');
  assert.equal(s.diatonicIndex, 28);
});

test('spellNote: ヘ長調の midi 70 は Bb4、臨時記号は書かない（調号が担当）', () => {
  const s = spellNote(70, KEY_F);
  assert.equal(s.letter, 'B');
  assert.equal(s.octave, 4);
  assert.equal(s.accidental, '');
  assert.equal(s.diatonicIndex, 34);
});

test('spellNote: ヘ長調の midi 71 は B4 でナチュラル', () => {
  const s = spellNote(71, KEY_F);
  assert.equal(s.letter, 'B');
  assert.equal(s.octave, 4);
  assert.equal(s.accidental, 'n');
  assert.equal(s.diatonicIndex, 34);
});

test('spellNote: フラット系の音階外はフラットで綴る（変ロ長調の bVI = Gb）', () => {
  const s = spellNote(66, keySignature(58, 'major'));
  assert.equal(s.letter, 'G');
  assert.equal(s.accidental, 'b');
});

test('spellNote: シャープ系の借用音はナチュラルで戻す（イ長調の bVII = G）', () => {
  const s = spellNote(67, keySignature(57, 'major'));
  assert.equal(s.letter, 'G');
  assert.equal(s.accidental, 'n');
});

test('spellNote: 短調の導音はシャープで綴る（ニ短調は変ニではなく嬰ハ）', () => {
  const s = spellNote(61, keySignature(62, 'minor'));
  assert.equal(s.letter, 'C');
  assert.equal(s.accidental, '#');
});

test('spellNote: イ短調の導音 G# もシャープ', () => {
  const s = spellNote(68, keySignature(57, 'minor'));
  assert.equal(s.letter, 'G');
  assert.equal(s.accidental, '#');
});

test('spellNote: ハ短調の導音は B ナチュラル', () => {
  const s = spellNote(71, keySignature(60, 'minor'));
  assert.equal(s.letter, 'B');
  assert.equal(s.accidental, 'n');
});

test('spellNote: diatonicIndex は octave*7 + 音名の番号', () => {
  assert.equal(spellNote(60, KEY_C).diatonicIndex, 4 * 7 + 0); // C4
  assert.equal(spellNote(71, KEY_C).diatonicIndex, 4 * 7 + 6); // B4
  assert.equal(spellNote(72, KEY_C).diatonicIndex, 5 * 7 + 0); // C5
});

// ---------------------------------------------------------------------------
// 4. spellNote：diatonicIndex の単調性
// ---------------------------------------------------------------------------

test('spellNote: midi 48〜84 を通して diatonicIndex が単調非減少（全16調）', () => {
  for (let tonic = 56; tonic <= 63; tonic++) {
    for (const mode of ['major', 'minor']) {
      const key = keySignature(tonic, mode);
      let prev = -Infinity;
      for (let midi = 48; midi <= 84; midi++) {
        const s = spellNote(midi, key);
        assert.ok(
          s.diatonicIndex >= prev,
          `${key.label} の midi ${midi} で ${prev} → ${s.diatonicIndex} と下がった`,
        );
        // 綴りと実音が一致していること（オクターブの取り違えを防ぐ）
        const pcOfLetter = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[s.letter];
        const alter = { '#': 1, b: -1 }[s.accidental] ?? 0;
        const expected = (midi % 12 + 12) % 12;
        const spelledPc = (((s.octave + 1) * 12 + pcOfLetter + alter) % 12 + 12) % 12;
        if (s.accidental !== 'n' && s.accidental !== '') {
          assert.equal(spelledPc, expected, `${key.label} の midi ${midi} の綴りがずれている`);
        }
        prev = s.diatonicIndex;
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 5. durationSymbol
// ---------------------------------------------------------------------------

test('durationSymbol: 表の8ケース', () => {
  assert.deepEqual(durationSymbol(0.25), { head: 'sixteenth', dots: 0 });
  assert.deepEqual(durationSymbol(0.5), { head: 'eighth', dots: 0 });
  assert.deepEqual(durationSymbol(0.75), { head: 'eighth', dots: 1 });
  assert.deepEqual(durationSymbol(1), { head: 'quarter', dots: 0 });
  assert.deepEqual(durationSymbol(1.5), { head: 'quarter', dots: 1 });
  assert.deepEqual(durationSymbol(2), { head: 'half', dots: 0 });
  assert.deepEqual(durationSymbol(3), { head: 'half', dots: 1 });
  assert.deepEqual(durationSymbol(4), { head: 'whole', dots: 0 });
});

test('durationSymbol: 表に無い値は近い小さい方へ丸める', () => {
  assert.deepEqual(durationSymbol(2.5), { head: 'half', dots: 0 });
  assert.deepEqual(durationSymbol(0.9), { head: 'eighth', dots: 1 });
  assert.deepEqual(durationSymbol(6), { head: 'whole', dots: 0 });
  assert.deepEqual(durationSymbol(0.1), { head: 'sixteenth', dots: 0 });
});

// ---------------------------------------------------------------------------
// 6〜8. splitAtBarlines
// ---------------------------------------------------------------------------

test('splitAtBarlines: 拍3から1.5拍の音は 1拍＋0.5拍のタイになる', () => {
  const parts = splitAtBarlines([{ midi: 60, beat: 3, dur: 1.5, vel: 0.5 }], 4);
  assert.equal(parts.length, 2);
  assert.deepEqual(
    parts.map((p) => [p.beat, p.dur, p.tieToNext, p.tieFromPrev]),
    [[3, 1, true, false], [4, 0.5, false, true]],
  );
  // 元のプロパティは引き継ぐ
  assert.equal(parts[0].midi, 60);
  assert.equal(parts[1].vel, 0.5);
});

test('splitAtBarlines: 小節をまたがない音は分割されない', () => {
  const notes = [
    { midi: 60, beat: 0, dur: 4 },
    { midi: 62, beat: 4.5, dur: 0.5 },
    { midi: 64, beat: 10, dur: 2 },
  ];
  const parts = splitAtBarlines(notes, 4);
  assert.equal(parts.length, 3);
  for (const p of parts) {
    assert.equal(p.tieToNext, false);
    assert.equal(p.tieFromPrev, false);
  }
  assert.deepEqual(parts.map((p) => [p.beat, p.dur]), [[0, 4], [4.5, 0.5], [10, 2]]);
});

test('splitAtBarlines: 3小節にまたがる音は3つに割れる', () => {
  const parts = splitAtBarlines([{ midi: 60, beat: 3, dur: 9 }], 4);
  assert.equal(parts.length, 3);
  assert.deepEqual(
    parts.map((p) => [p.beat, p.dur, p.tieToNext, p.tieFromPrev]),
    [[3, 1, true, false], [4, 4, true, true], [8, 4, false, true]],
  );
  assert.equal(parts.reduce((s, p) => s + p.dur, 0), 9);
});

test('splitAtBarlines: 複数の音を渡しても順序と総長が保たれる', () => {
  const notes = [{ beat: 0, dur: 6 }, { beat: 6, dur: 3 }];
  const parts = splitAtBarlines(notes, 4);
  assert.deepEqual(parts.map((p) => [p.beat, p.dur]), [[0, 4], [4, 2], [6, 2], [8, 1]]);
});

// ---------------------------------------------------------------------------
// 9〜16. renderScore（実データ）
// ---------------------------------------------------------------------------

test('renderScore: 実データ10曲すべてでSVG文字列が返る', realOpts, () => {
  for (const seed of SEEDS) {
    const s = song(seed);
    const score = renderScore(s);
    assert.equal(typeof score.svg, 'string');
    assert.match(score.svg, /^<svg [^>]*>/);
    assert.ok(score.svg.endsWith('</svg>'), `${seed}: </svg> で終わっていない`);
    assert.ok(score.width > 0 && score.height > 0);
    assert.ok(score.svg.includes('data-clef="treble"'), `${seed}: ト音記号が無い`);
    assert.ok(score.svg.includes('data-clef="bass"'), `${seed}: ヘ音記号が無い`);
  }
});

test('renderScore: barX の長さは bars+1 で単調増加', realOpts, () => {
  for (const seed of SEEDS) {
    const s = song(seed);
    const { barX } = renderScore(s);
    assert.equal(barX.length, s.bars + 1);
    for (let i = 1; i < barX.length; i++) {
      assert.ok(barX[i] > barX[i - 1], `${seed}: barX[${i}] が増えていない`);
    }
  }
});

test('renderScore: beatToX の両端が barX の両端に一致する', realOpts, () => {
  for (const seed of SEEDS) {
    const s = song(seed);
    const { barX, beatToX } = renderScore(s);
    assert.equal(beatToX(0), barX[0]);
    assert.equal(beatToX(s.totalBeats), barX[s.bars]);
    // 途中も線形
    assert.equal(beatToX(4), barX[1]);
    assert.equal(beatToX(2), (barX[0] + barX[1]) / 2);
  }
});

test('renderScore: melody の音符はタイ分割で増えても減らない', realOpts, () => {
  for (const seed of SEEDS) {
    const s = song(seed);
    const { svg } = renderScore(s);
    const drawn = svg.match(/data-layer="melody"/g)?.length ?? 0;
    assert.ok(drawn >= s.melody.length, `${seed}: ${drawn} < ${s.melody.length}`);
    assert.ok(svg.includes('data-layer="accomp"'));
    assert.ok(svg.includes('data-layer="bass"'));
  }
});

test('renderScore: pad は描かない', realOpts, () => {
  for (const seed of SEEDS) {
    const { svg } = renderScore(song(seed));
    assert.ok(!svg.includes('data-layer="pad"'), `${seed}: pad が描かれている`);
  }
});

test('renderScore: & や < が未エスケープで出てこない', realOpts, () => {
  for (const seed of SEEDS) {
    const { svg } = renderScore(song(seed));
    // & は必ず実体参照の頭でなければならない
    assert.equal(svg.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+);)/g), null, `${seed}: 生の & がある`);
    // 属性値の中に < > & が無いこと
    for (const [, value] of svg.matchAll(/="([^"]*)"/g)) {
      assert.ok(!/[<>&]/.test(value), `${seed}: 属性値に生の記号: ${value}`);
    }
    // タグを剥がしたテキスト部分にも < & が無いこと
    const text = svg.replace(/<[^>]*>/g, '');
    assert.ok(!/[<&]/.test(text), `${seed}: テキストに生の記号がある`);
    // タグが閉じ切っていること（> の数と < の数が一致）
    assert.equal((svg.match(/</g) || []).length, (svg.match(/>/g) || []).length);
  }
});

test('renderScore: data-beat は 0 以上 totalBeats 未満', realOpts, () => {
  for (const seed of SEEDS) {
    const s = song(seed);
    const { svg } = renderScore(s);
    const beats = [...svg.matchAll(/data-beat="([-\d.]+)"/g)].map((m) => Number(m[1]));
    assert.ok(beats.length > 0);
    for (const beat of beats) {
      assert.ok(Number.isFinite(beat), `${seed}: data-beat が数値でない`);
      assert.ok(beat >= 0, `${seed}: data-beat=${beat} が負`);
      assert.ok(beat < s.totalBeats, `${seed}: data-beat=${beat} が totalBeats=${s.totalBeats} 以上`);
    }
    // data-dur も正の数
    const durs = [...svg.matchAll(/data-dur="([-\d.]+)"/g)].map((m) => Number(m[1]));
    for (const dur of durs) assert.ok(dur > 0, `${seed}: data-dur=${dur}`);
  }
});

test('renderScore: 16・32・64小節すべて描ける', realOpts, () => {
  for (const bars of ['16', '32', '64']) {
    for (const seed of SEEDS.slice(0, 4)) {
      const s = song(seed, bars);
      assert.equal(s.bars, Number(bars));
      const score = renderScore(s);
      assert.equal(score.barX.length, s.bars + 1);
      assert.ok(score.width > s.bars * 200);
      assert.ok(score.svg.length > 1000);
      // 小節線は各小節の頭と終止線ぶん
      const barlines = [...score.svg.matchAll(/class="barline" data-bar="(\d+)"/g)].map((m) => Number(m[1]));
      assert.equal(new Set(barlines).size, s.bars + 1);
      assert.equal(Math.max(...barlines), s.bars);
    }
  }
});

test('renderScore: 小節番号が全小節ぶん振られる', realOpts, () => {
  const s = song('a3f91c', '16');
  const { svg } = renderScore(s);
  const numbers = [...svg.matchAll(/class="bar-number"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
  assert.deepEqual(numbers, Array.from({ length: s.bars }, (_, i) => i + 1));
});

test('renderScore: 調号の数が曲の調と一致する', realOpts, () => {
  for (const seed of SEEDS) {
    const s = song(seed);
    const key = keySignature(s.tonicMidi, s.mode);
    const { svg } = renderScore(s);
    const block = groupChunk(svg, '<g class="key-signature">');
    if (key.count === 0) {
      assert.equal(block, null, `${seed}: 調号が無いはずなのに描かれている`);
      continue;
    }
    // ト音記号用とヘ音記号用で2セット
    const sign = key.accidental === 'flat' ? 'b' : '#';
    const marks = block.match(new RegExp(`data-acc="${sign}"`, 'g')).length;
    assert.equal(marks, key.count * 2, `${seed}: ${key.label} の調号の数が合わない`);
    assert.equal(block.match(/data-acc/g).length, marks, `${seed}: 別種の記号が混ざっている`);
  }
});

test('renderScore: 加線と休符が必要なところに出る', realOpts, () => {
  const s = song('a3f91c');
  const { svg } = renderScore(s);
  assert.ok(svg.includes('class="ledger"'), '加線が1本も無い');
  assert.ok(svg.includes('class="rest"'), '休符が1つも無い');
});

// ---------------------------------------------------------------------------
// renderScore（合成した小さな曲。実データが無くても動く）
// ---------------------------------------------------------------------------

// 2小節。3拍目から1.5拍のメロディーが小節線をまたぎ、
// 高い音（midi 84 = C6）が加線を要求し、5拍目以降は休符になる。
const SYNTH = {
  seed: 'synth', mode: 'major', tonicMidi: 60, tempo: 80, bars: 2, totalBeats: 8, climaxBeat: 0,
  sections: [],
  melody: [
    { midi: 84, beat: 0, dur: 2, vel: 0.6 },
    { midi: 72, beat: 3, dur: 1.5, vel: 0.6 },
    { midi: 71, beat: 6, dur: 2, vel: 0.6 },
  ],
  accomp: [
    { midi: 52, beat: 0, dur: 0.75, vel: 0.3 },
    { midi: 55, beat: 0.5, dur: 0.75, vel: 0.3 },
    { midi: 51, beat: 4, dur: 4, midis: [51, 55, 58], vel: 0.4 },
  ],
  bass: [
    { midi: 36, beat: 0, dur: 4, vel: 0.5 },
    { midi: 43, beat: 4, dur: 4, vel: 0.5 },
  ],
  pad: [{ midis: [60, 64, 67], beat: 0, dur: 4, vel: 0.3 }],
};

test('renderScore: 小節をまたぐ音はタイで結ばれた2つの音符になる', () => {
  const { svg } = renderScore(SYNTH);
  assert.ok(svg.includes('data-layer="melody" data-beat="3" data-dur="1"'), '前半（1拍）が無い');
  assert.ok(svg.includes('data-layer="melody" data-beat="4" data-dur="0.5"'), '後半（0.5拍）が無い');
  assert.equal((svg.match(/class="tie"/g) || []).length, 1);
});

test('renderScore: 合成曲でも加線・休符・和音・pad除外が正しい', () => {
  const { svg, barX, beatToX } = renderScore(SYNTH);
  assert.ok(svg.includes('class="ledger"'), 'midi 84 に加線が無い');
  assert.ok(!svg.includes('data-layer="pad"'), 'pad を描いている');
  // 2拍目から3拍目まではメロディーが休み
  assert.ok(/class="rest" data-staff="treble" data-beat="2"/.test(svg), '2拍目の休符が無い');
  // 伴奏の保持和音は3つの符頭を持つ
  const chord = groupChunk(svg, '<g class="note" data-layer="accomp" data-beat="4"');
  assert.ok(chord, '最終小節の和音が無い');
  assert.equal((chord.match(/class="notehead"/g) || []).length, 3);
  assert.equal(barX.length, 3);
  assert.equal(beatToX(8), barX[2]);
});

test('renderScore: 色を直接指定していない', realOpts, () => {
  const { svg } = renderScore(song('a3f91c'));
  assert.ok(!/#[0-9a-fA-F]{3,6}(?![^"]*var\()/.test(svg.replace('var(--score-ink, #ddd)', '')),
    '色が直書きされている');
  assert.ok(svg.includes('currentColor'));
  assert.ok(svg.includes('var(--score-ink'));
});

test('renderScore: options で小節幅を変えられる', realOpts, () => {
  const s = song('a3f91c', '16');
  const wide = renderScore(s, { barWidth: 320 });
  assert.equal(wide.barX[1] - wide.barX[0], 320);
  assert.equal(wide.beatToX(s.totalBeats), wide.barX[s.bars]);
});

// ---------------------------------------------------------------------------
// 17. keyTimeline：小節ごとの調
// ---------------------------------------------------------------------------

test('keyTimeline: 転調しない曲は全小節が同じ調で changes が空', () => {
  const { keys, changes } = keyTimeline(
    { tonicMidi: 57, mode: 'major', sections: [], modulation: null }, 8);
  assert.equal(keys.length, 8);
  assert.equal(changes.length, 0);
  for (const k of keys) assert.deepEqual(k, keySignature(57, 'major'));
});

test('keyTimeline: modulation.atBar から先だけ新しい調になる', () => {
  const s = modSynth(60, 2, 'major', 4, 2); // ハ長調 → ニ長調
  const { keys, changes } = keyTimeline(s, 4);
  assert.deepEqual(keys.map((k) => k.tonicName), ['C', 'C', 'D', 'D']);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].bar, 2);
  assert.equal(changes[0].from.tonicName, 'C');
  assert.equal(changes[0].to.tonicName, 'D');
});

test('keyTimeline: 旋法は転調しても変わらない', () => {
  const s = modSynth(57, 1, 'minor', 4, 2); // イ短調 → 変ロ短調
  const { keys } = keyTimeline(s, 4);
  assert.deepEqual(keys.map((k) => k.label), ['イ短調', 'イ短調', '変ロ短調', '変ロ短調']);
});

test('keyTimeline: 実データの転調曲で atBar に1回だけ変わる', realOpts, () => {
  const mods = modulatedSongs();
  assert.ok(mods.length > 0, '転調する曲が1つも無い（検査が空振り）');
  for (const s of mods) {
    const { keys, changes } = keyTimeline(s, s.bars);
    assert.equal(keys.length, s.bars, `${s.seed}: 小節数と合わない`);
    assert.equal(changes.length, 1, `${s.seed}: 調が変わる回数が1でない`);
    assert.equal(changes[0].bar, s.modulation.atBar, `${s.seed}: 変わる小節が atBar と違う`);
    assert.deepEqual(changes[0].to, keySignature(s.modulation.toTonicMidi, s.mode));
    assert.deepEqual(changes[0].from, keySignature(s.modulation.fromTonicMidi, s.mode));
    // atBar の前後がそれぞれ元の調・新しい調
    assert.deepEqual(keys[s.modulation.atBar - 1], keySignature(s.tonicMidi, s.mode));
    assert.deepEqual(keys[s.bars - 1], keySignature(s.modulation.toTonicMidi, s.mode));
  }
});

// ---------------------------------------------------------------------------
// 18. renderScore：転調を描く
// ---------------------------------------------------------------------------

test('renderScore: 転調ありの実データ曲が例外なく描ける', realOpts, () => {
  const mods = modulatedSongs();
  assert.ok(mods.length > 0, '転調する曲が1つも無い（検査が空振り）');
  for (const s of mods) {
    const score = renderScore(s);
    assert.match(score.svg, /^<svg [^>]*>/);
    assert.ok(score.svg.endsWith('</svg>'), `${s.seed}: </svg> で終わっていない`);
    assert.ok(score.width > 0 && score.height > 0);
    // 転調ありでも XML として壊れていない
    assert.equal(score.svg.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+);)/g), null, `${s.seed}: 生の &`);
    assert.equal((score.svg.match(/</g) || []).length, (score.svg.match(/>/g) || []).length);
  }
});

test('renderScore: 転調すると調号が2組（曲頭＋転調位置）出る', realOpts, () => {
  const mods = modulatedSongs();
  assert.ok(mods.length > 0, '転調する曲が1つも無い（検査が空振り）');
  for (const s of mods) {
    const { svg } = renderScore(s);
    assert.equal((svg.match(/<g class="key-signature"/g) || []).length, 2,
      `${s.seed}: 調号が2組でない`);
    assert.equal((svg.match(/<g class="key-change"/g) || []).length, 1,
      `${s.seed}: 転調の印が1つでない`);
    assert.ok(svg.includes(`<g class="key-change" data-bar="${s.modulation.atBar}">`),
      `${s.seed}: 転調が atBar=${s.modulation.atBar} に無い`);
    // 転調位置の調号の数と種類が新しい調と一致する
    const to = keySignature(s.modulation.toTonicMidi, s.mode);
    const block = groupChunk(svg, `<g class="key-signature" data-bar="${s.modulation.atBar}">`);
    assert.ok(block, `${s.seed}: 転調位置の調号が無い`);
    const sign = to.accidental === 'flat' ? 'b' : '#';
    const marks = (block.match(new RegExp(`data-acc="${sign}"`, 'g')) || []).length;
    assert.equal(marks, to.count * 2, `${s.seed}: ${to.label} の調号の数が合わない（2段ぶん）`);
  }
});

test('renderScore: 転調しない曲の調号は1組だけ', realOpts, () => {
  const plain = SEEDS.map((seed) => song(seed)).filter((s) => !s.modulation);
  assert.ok(plain.length > 0, '転調しない曲が1つも無い（検査が空振り）');
  for (const s of plain) {
    const { svg } = renderScore(s);
    const key = keySignature(s.tonicMidi, s.mode);
    assert.equal((svg.match(/<g class="key-signature"/g) || []).length, key.count === 0 ? 0 : 1,
      `${s.seed}: 調号の組数が違う`);
    assert.equal((svg.match(/<g class="key-change"/g) || []).length, 0, `${s.seed}: 転調の印がある`);
    assert.equal((svg.match(/<g class="key-cancel"/g) || []).length, 0, `${s.seed}: 打ち消しがある`);
  }
});

test('renderScore: 転調位置に複縦線（細い線2本）が引かれる', realOpts, () => {
  const mods = modulatedSongs();
  assert.ok(mods.length > 0, '転調する曲が1つも無い（検査が空振り）');
  for (const s of mods) {
    const { svg, barX } = renderScore(s);
    const at = s.modulation.atBar;
    // その小節の小節線が2本ある（1本目は通常の小節線、2本目が転調の印）
    const lines = [...svg.matchAll(
      new RegExp(`<line x1="([\\d.]+)"[^>]*class="barline" data-bar="${at}" stroke="currentColor" stroke-width="([\\d.]+)"`, 'g'),
    )].map((m) => [Number(m[1]), Number(m[2])]);
    assert.equal(lines.length, 2, `${s.seed}: 転調位置の縦線が2本でない`);
    // 1本目は小節の頭ちょうど、2本目はその少し右。どちらも細い（終止線の太線ではない）
    assert.equal(lines[0][0], barX[at], `${s.seed}: 1本目が小節の頭に無い`);
    assert.ok(lines[1][0] > lines[0][0], `${s.seed}: 2本目が右に無い`);
    assert.ok(lines[1][0] - lines[0][0] < 8, `${s.seed}: 複縦線の間隔が広すぎる`);
    assert.deepEqual([lines[0][1], lines[1][1]], [1, 1], `${s.seed}: 複縦線が細線2本でない`);
  }
});

test('renderScore: 転調後の音符は新しい調で綴られる（不要な臨時記号が付かない）', realOpts, () => {
  const mods = modulatedSongs();
  assert.ok(mods.length > 0, '転調する曲が1つも無い（検査が空振り）');
  for (const s of mods) {
    const at = s.modulation.atBar;
    const got = renderScore(s).svg;

    // 1. 転調後の区間は「はじめから新しい調の曲」として描いたものと完全に一致する
    const inNewKey = {
      ...s,
      tonicMidi: s.modulation.toTonicMidi,
      modulation: null,
      sections: s.sections.map((x) => ({ ...x, tonicMidi: s.modulation.toTonicMidi })),
    };
    assert.deepEqual(fingerprint(got, at), fingerprint(renderScore(inNewKey).svg, at),
      `${s.seed}: 転調後の綴りが「新しい調の曲」と違う`);

    // 2. 切り替えを忘れた場合（古い調のまま）より臨時記号が確実に少ない。
    //    これが無いと 1. は「両方とも古い調」でも通ってしまう。
    const inOldKey = {
      ...s,
      modulation: null,
      sections: s.sections.map((x) => ({ ...x, tonicMidi: s.tonicMidi })),
    };
    const after = accidentalCount(got, at);
    const stale = accidentalCount(renderScore(inOldKey).svg, at);
    assert.ok(after < stale,
      `${s.seed}: 転調後の臨時記号が減っていない（新しい調 ${after} 個 / 古い調のまま ${stale} 個）`);
  }
});

test('renderScore: 転調後の各音が spellNote(midi, 新しい調) と同じ綴りになる', () => {
  // 合成曲なら midi が分かるので、1音ずつ直接つき合わせられる。
  for (const [tonic, shift, mode] of [[60, 2, 'major'], [57, 1, 'minor'], [58, 2, 'major'], [61, 1, 'minor']]) {
    const s = modSynth(tonic, shift, mode);
    const at = s.modulation.atBar;
    const newKey = keySignature(s.modulation.toTonicMidi, mode);
    const drawn = noteGroups(renderScore(s).svg).filter((n) => n.beat >= at * 4);
    assert.ok(drawn.length > 0, '転調後の音符が無い');
    for (const n of drawn) {
      const src = [...s.melody, ...s.bass].find(
        (x) => Math.abs(x.beat - n.beat) < 1e-9
          && (n.layer === 'melody' ? s.melody.includes(x) : s.bass.includes(x)),
      );
      assert.ok(src, `拍 ${n.beat} の元の音が見つからない`);
      const expected = spellNote(src.midi, newKey).accidental;
      assert.deepEqual(n.accidentals, expected === '' ? [] : [expected],
        `${newKey.label} の midi ${src.midi}（拍 ${n.beat}）の臨時記号が違う`);
    }
  }
});

test('renderScore: 前の調を打ち消すナチュラルの規則', () => {
  const cancels = (svg) => {
    const block = groupChunk(svg, '<g class="key-cancel">');
    return block === null ? 0 : (block.match(/data-acc="n"/g) || []).length / 2; // 2段ぶん
  };
  const sig = (svg, bar) => {
    const block = groupChunk(svg, `<g class="key-signature" data-bar="${bar}">`);
    return block === null ? null : (block.match(/data-acc="[#b]"/g) || []).length / 2;
  };

  // シャープ3つ（イ長調）→ フラット2つ（変ロ長調）。系統が変わるので3つとも消す
  const cross = renderScore(modSynth(57, 1, 'major')).svg;
  assert.equal(cancels(cross), 3, 'シャープ3つを消していない');
  assert.equal(sig(cross, 2), 2, '変ロ長調のフラット2つが無い');
  // 打ち消しは新しい調号より前に置く（記譜の標準）
  assert.ok(cross.indexOf('<g class="key-cancel">') < cross.indexOf('<g class="key-signature" data-bar="2">'),
    'ナチュラルが新しい調号より後ろにある');

  // シャープ2つ（ニ長調）→ シャープ4つ（ホ長調）。増えるだけなのでナチュラル不要
  const grow = renderScore(modSynth(62, 2, 'major')).svg;
  assert.equal(cancels(grow), 0, '増えるだけなのにナチュラルを書いている');
  assert.equal(sig(grow, 2), 4, 'ホ長調のシャープ4つが無い');

  // 調号なし（ハ長調）→ シャープ2つ（ニ長調）。消すものが無い
  const fromNone = renderScore(modSynth(60, 2, 'major')).svg;
  assert.equal(cancels(fromNone), 0, '消すものが無いのにナチュラルを書いている');
  assert.equal(sig(fromNone, 2), 2, 'ニ長調のシャープ2つが無い');

  // フラット2つ（変ロ長調）→ 調号なし（ハ長調）。2つとも消し、新しい調号は空
  const toNone = renderScore(modSynth(58, 2, 'major')).svg;
  assert.equal(cancels(toNone), 2, 'フラット2つを消していない');
  assert.equal(sig(toNone, 2), 0, 'ハ長調に余計な記号がある');
});

test('renderScore: 転調しても barX と beatToX の整合が保たれる', realOpts, () => {
  const mods = modulatedSongs();
  assert.ok(mods.length > 0, '転調する曲が1つも無い（検査が空振り）');
  for (const s of mods) {
    const { barX, beatToX, width } = renderScore(s);
    const at = s.modulation.atBar;
    assert.equal(barX.length, s.bars + 1, `${s.seed}: barX の長さ`);
    for (let i = 1; i < barX.length; i++) {
      assert.ok(barX[i] > barX[i - 1], `${s.seed}: barX[${i}] が増えていない`);
    }
    assert.equal(beatToX(0), barX[0], `${s.seed}: beatToX(0)`);
    assert.equal(beatToX(s.totalBeats), barX[s.bars], `${s.seed}: beatToX(totalBeats)`);
    assert.ok(width > barX[s.bars], `${s.seed}: 右余白が無い`);
    // 調号を入れるぶん、転調する小節だけ広い
    const plain = barX[1] - barX[0];
    assert.ok(barX[at + 1] - barX[at] > plain, `${s.seed}: 転調する小節が広がっていない`);
    assert.equal(barX[at] - barX[at - 1], plain, `${s.seed}: 手前の小節まで広がっている`);
    // 音符は調号より右から始まる（前置きに拍を割り当てない）
    assert.ok(beatToX(at * 4) > barX[at], `${s.seed}: 音符が調号の上に乗る`);
    assert.ok(beatToX(at * 4) < barX[at + 1], `${s.seed}: 前置きが小節をはみ出す`);
    // 拍が進めば x も進む（スクロール追従が巻き戻らない）
    let prev = -Infinity;
    for (let beat = 0; beat <= s.totalBeats; beat += 0.5) {
      const x = beatToX(beat);
      assert.ok(x >= prev, `${s.seed}: 拍 ${beat} で x が戻った`);
      prev = x;
    }
  }
});

test('renderScore: 合成した転調曲でも小節線と音符が揃う', () => {
  const s = modSynth(60, 2, 'major', 4, 2);
  const score = renderScore(s);
  assert.equal(score.barX.length, 5);
  assert.equal(score.beatToX(0), score.barX[0]);
  assert.equal(score.beatToX(16), score.barX[4]);
  // 小節線は各小節の頭と終止線ぶん（複縦線の2本目も同じ data-bar）
  const bars = [...score.svg.matchAll(/class="barline" data-bar="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual([...new Set(bars)].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.equal(bars.filter((b) => b === 2).length, 2, '転調位置が複縦線になっていない');
  assert.equal(bars.filter((b) => b === 1).length, 1, '普通の小節が複縦線になっている');
});
