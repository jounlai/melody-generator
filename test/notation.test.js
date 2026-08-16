import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  keySignature,
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
