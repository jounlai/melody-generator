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
  assert.equal(expandBass([{ beat: 0, kind: 'fifth', dur: 2 }], 0, 36, null, [0, 4, 7], 0.5, 55)[0].midi, 43);
  // 第1転回形で最低音が E2=40 なら、5度上 B2=47 は和音の音ではない。
  // 半音単位で押し込むと別の和音になるので、オクターブ上へ逃がす。
  assert.equal(expandBass([{ beat: 0, kind: 'fifth', dur: 2 }], 0, 40, null, [0, 4, 7], 0.5, 55)[0].midi, 52);
});

test('expandBass: next は次の小節の根音を先取りする。次が無ければ鳴らさない', () => {
  const steps = [{ beat: 0, kind: 'root', dur: 3.5 }, { beat: 3.5, kind: 'next', dur: 0.5 }];
  const withNext = expandBass(steps, 0, 36, 41, [0, 4, 7], 0.5, 55);
  assert.equal(withNext.length, 2);
  assert.deepEqual([withNext[1].midi, withNext[1].beat], [41, 3.5]);
  const noNext = expandBass(steps, 0, 36, null, [0, 4, 7], 0.5, 55);
  assert.equal(noNext.length, 1, '次の小節が無いのに先取りしている');
});

test('expandBass: next が上限を越えるなら、音名を保ったままオクターブ下げて収める', () => {
  // 次の小節の根音(50)がこの小節の上限(43)を越える。半拍とはいえ伴奏より上へ出ると
  // 層（ベース < 伴奏）が入れ替わって濁るので、1オクターブ下げて収める。
  const steps = [{ beat: 3.5, kind: 'next', dur: 0.5 }];
  const out = expandBass(steps, 0, 36, 50, [0, 4, 7], 0.5, 43);
  assert.equal(out[0].midi, 38, 'オクターブ下げて上限内に収まっていない');
  assert.ok(out[0].midi <= 43, '上限を越えている');
  assert.equal(((out[0].midi - 50) % 12 + 12) % 12, 0, 'オクターブ以外へ動いた（音名が変わった）');
});

test('expandBass: octave が音域の上限を越えるなら元の音のまま', () => {
  const out = expandBass([{ beat: 0, kind: 'octave', dur: 2 }], 0, 50, null, [0, 4, 7], 0.5, 55);
  assert.equal(out[0].midi, 50);
});

test('arpeggioIndex: 上行して下行する波で構成音を巡回する', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => arpeggioIndex(i, 3)), [0, 1, 2, 1, 0, 1, 2, 1]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => arpeggioIndex(i, 4)), [0, 1, 2, 3, 2, 1, 0, 1]);
  assert.equal(arpeggioIndex(3, 1), 0);
});

import {
  ACCOMP_PATTERNS, ACCOMP_PLAN, BASS_PATTERNS, BASS_PLAN, arrangeSong, anticipateMelody,
  sustainPhraseEnds,
} from '../src/arrange.js';
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

// 「厚さ」は step の数ではなく、その小節で実際に鳴る音の数で測る。
// upper と all は1ステップで和音が出るので、step の数と音の数は一致しない。
// 実例: syncope は step 6個だが5個が和音なので10音、arp8 は step 8個すべて
// 単音なので8音。step で測ると syncope のほうが薄いことになってしまう。
function accompNoteCount(pattern) {
  return expandAccomp(pattern.steps, [48, 52, 55], 0, pattern.vel)
    .reduce((n, e) => n + (e.midis ? e.midis.length : 1), 0);
}

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
      const a = accompNoteCount(ACCOMP_PATTERNS[first]);
      const b = accompNoteCount(ACCOMP_PATTERNS[second]);
      assert.ok(b >= a, `セクション${s}: 後半 ${second}(${b}音) が前半 ${first}(${a}音) より薄い`);
    }
  }
  for (const [first, second] of ACCOMP_PLAN[3]) {
    const a = accompNoteCount(ACCOMP_PATTERNS[first]);
    const b = accompNoteCount(ACCOMP_PATTERNS[second]);
    assert.ok(b <= a, `A'': 後半 ${second}(${b}音) が前半 ${first}(${a}音) より厚い`);
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
  // ベースは型によって1小節の音数が変わる（Task 5）。守るべきは「どの小節にも音がある」こと。
  for (let bar = 0; bar < 32; bar++) {
    const inBar = accomp.filter((n) => Math.floor(n.beat / 4) === bar);
    assert.ok(inBar.length > 0, `${bar}小節目の伴奏が無音`);
    assert.ok(bass.some((n) => Math.floor(n.beat / 4) === bar), `${bar}小節目のベースが無音`);
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

test('ベース型: どの型も1小節からはみ出さない', () => {
  for (const [name, p] of Object.entries(BASS_PATTERNS)) {
    const out = expandBass(p.steps, 0, 36, 41, [0, 4, 7], p.vel, 55);
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

test('食い: protectedBars に挙げた小節（転調の鍵の変わり目など）は食わない。しかも乱数を消費しない', () => {
  // 乱数列を [0, 0.999999] に固定する。保護された小節の音が乱数を1回でも
  // 消費していたら、そのあとの食える音が0.999999を引いてしまい、
  // 「本来は当たるはずの抽選」が外れる——という形で消費の有無を検出する。
  const seq = [0, 0.999999];
  let i = 0;
  const rng = () => seq[Math.min(i++, seq.length - 1)];
  const song = melodySong([
    { midi: 60, beat: 0, dur: 1 },
    { midi: 61, beat: 8, dur: 1 },    // 保護された小節（小節2）
    { midi: 63, beat: 16, dur: 1 },   // 食える音（小節4）
  ], { protectedBars: [2] });
  anticipateMelody(song, rng);
  const at = (midi) => song.melody.find((x) => x.midi === midi).beat;
  assert.equal(at(61), 8, '保護された小節を食っている');
  assert.equal(at(63), 15.5, '保護された小節が乱数を消費し、後続の抽選がずれた（乱数を消費してはいけない）');
});

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

test('タイ: 上限4拍を越えず、元より長い音を短くもしない', () => {
  const song = {
    bars: 8,
    melody: [
      { midi: 60, beat: 0, dur: 0.5 },
      { midi: 61, beat: 4, dur: 5 },    // フレーズ末。既に上限より長い
      { midi: 62, beat: 12, dur: 0.5 },
    ],
    breathBar: null,
    sections: [{ startBar: 0, slots: [{ phraseEnd: true }, { phraseEnd: false }] }],
  };
  sustainPhraseEnds(song);
  assert.equal(song.melody[1].dur, 5, '元より短くなっている');
});

test('タイ: 曲の最後の音は触らない（終止として既に伸ばしてある）', () => {
  const song = {
    bars: 8, melody: [{ midi: 60, beat: 0, dur: 0.5 }, { midi: 62, beat: 28, dur: 4 }],
    breathBar: null,
    sections: [{ startBar: 6, slots: [{ phraseEnd: true }] }],
  };
  assert.equal(sustainPhraseEnds(song), 0);
  assert.equal(song.melody[1].dur, 4, '終止の音を触っている');
});
