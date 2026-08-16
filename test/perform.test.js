import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPerformance } from '../src/perform.js';
import { makeRng, seedFromString } from '../src/rng.js';

const CLIMAX_BEAT = 12;
const CLIMAX_MIDI = 79; // 検証用に melody 内で一意にしてある

// 8小節（32拍）の小さな曲。リタルダンド開始は (8-2)*4 = 24拍目。
function makeSong(over = {}) {
  return {
    seed: 'a3f91c',
    mode: 'major',
    tonicMidi: 60,
    tempo: 68,
    bars: 8,
    totalBeats: 32,
    climaxBeat: CLIMAX_BEAT,
    sections: [],
    melody: [
      { midi: 72, beat: 0, dur: 1, vel: 0.70 },
      { midi: 74, beat: 1, dur: 1, vel: 0.62 },
      { midi: 76, beat: 4, dur: 2, vel: 0.66 },
      { midi: CLIMAX_MIDI, beat: CLIMAX_BEAT, dur: 2, vel: 0.85 },
      { midi: 77, beat: 24, dur: 1, vel: 0.60 },
      { midi: 74, beat: 28, dur: 2, vel: 0.52 },
      { midi: 71, beat: 30, dur: 2, vel: 0.45 },
    ],
    accomp: [
      { midi: 64, beat: 0, dur: 2, vel: 0.40 },
      { midi: 67, beat: 2, dur: 2, vel: 0.38 },
      { midi: 64, beat: 24, dur: 2, vel: 0.35 },
      { midi: 62, beat: 30, dur: 2, vel: 0.33 },
    ],
    bass: [
      { midi: 48, beat: 0, dur: 4, vel: 0.50 },
      { midi: 43, beat: 4, dur: 4, vel: 0.48 },
      { midi: 48, beat: 28, dur: 4, vel: 0.44 },
    ],
    pad: [
      { midis: [60, 64, 67], beat: 0, dur: 8, vel: 0.30 },
      { midis: [59, 62, 67], beat: 24, dur: 8, vel: 0.28 },
    ],
    ...over,
  };
}

const NOTE_COUNT = (() => {
  const s = makeSong();
  return s.melody.length + s.accomp.length + s.bass.length + s.pad.length;
})();

const NO_JITTER = { timingJitterMs: 0, velocityJitter: 0, tenuto: false, ritardando: false };

function spbOf(song) {
  return 60 / song.tempo;
}

function melodyOf(res) {
  return res.events.filter((e) => e.kind === 'piano' && e.layer === 'melody');
}

function layerOf(res, layer) {
  return res.events.filter((e) => e.kind === 'piano' && e.layer === layer);
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ---------------------------------------------------------------------------
// 強弱設計の参照実装。perform.js とは独立に、仕様からそのまま書き下したもの。
// 実装が仕様から滑ったらここと食い違って落ちる。
// ---------------------------------------------------------------------------

const PHRASE = 8; // 2小節 = 1フレーズ
const SEC_LEVEL = { A: [0.85, 0.85], "A'": [0.95, 0.95], B: [1.1, 1.1], "A''": [0.8, 0.55] };

// 第1層: セクションごとの基準レベル（A'' だけセクション内を線形に下降）
function refSection(song, beat) {
  const secs = song.sections ?? [];
  if (secs.length === 0) return 1;
  let idx = 0;
  for (let i = 0; i < secs.length; i++) if (beat >= secs[i].startBar * 4) idx = i;
  const lv = SEC_LEVEL[secs[idx].name];
  if (!lv) return 1;
  const start = secs[idx].startBar * 4;
  const end = idx + 1 < secs.length ? secs[idx + 1].startBar * 4 : song.totalBeats;
  const t = Math.min(1, Math.max(0, (beat - start) / (end - start)));
  return lv[0] + (lv[1] - lv[0]) * t;
}

// 第2層: フレーズ内のスウェル（そのフレーズの最高音を山にする）
function refSwell(song, beat) {
  const ph = Math.floor(beat / PHRASE);
  const inPhrase = song.melody.filter((n) => Math.floor(n.beat / PHRASE) === ph);
  if (inPhrase.length === 0) return 1;
  let peak = inPhrase[0];
  for (const n of inPhrase) if (n.midi > peak.midi) peak = n;
  const q = (peak.beat - ph * PHRASE) / PHRASE;
  const p = (beat - ph * PHRASE) / PHRASE;
  return 1 - (0.18 * Math.abs(p - q)) / Math.max(q, 1 - q, 0.25);
}

// 第3層: クライマックスへのクレッシェンドと、その直後の脱力
function refClimax(song, beat) {
  const c = song.climaxBeat;
  if (beat === c) return 1.2;
  if (beat >= c - 8 && beat < c) return 0.88 + (1.2 - 0.88) * ((beat - (c - 8)) / 8);
  if (beat > c && beat <= c + 4) return 1.2 + (0.75 - 1.2) * ((beat - c) / 4);
  return 1;
}

function refDyn(song, beat, layer) {
  const f = refSection(song, beat) * refSwell(song, beat) * refClimax(song, beat);
  return layer === 'melody' ? f : 1 + (f - 1) * 0.6;
}

// フレーズ末（＝そのフレーズで最後に鳴るメロディー音）の index 集合
function refPhraseLast(melody) {
  const last = new Map();
  melody.forEach((n, i) => {
    const ph = Math.floor(n.beat / PHRASE);
    const cur = last.get(ph);
    if (cur === undefined || n.beat >= melody[cur].beat) last.set(ph, i);
  });
  return new Set(last.values());
}

// クライマックス手前2拍のためらい（秒）
function refHesitate(song, beat, spb) {
  const c = song.climaxBeat;
  if (!(beat >= c - 2 && beat < c)) return 0;
  const u = (beat - (c - 2)) / 2;
  return u * u * 0.1 * spb;
}

function clampVel(v) {
  return Math.min(1.0, Math.max(0.05, v));
}

// ---------------------------------------------------------------------------
// 強弱の検証用の曲。4セクション×4小節（1セクション=16拍=2フレーズ）、
// 全拍にメロディーと伴奏を等ベロシティで置いてあるので、出てきた vel の比が
// そのまま強弱係数になる。フレーズ内の輪郭は p=0.5 が最高音になるよう並べてある。
// ---------------------------------------------------------------------------
const SEC_BEATS = 16;
const PHRASE_CONTOUR = [0, 2, 4, 7, 9, 7, 4, 2]; // index 4（p=0.5）が最高音
const SECTIONED_CLIMAX = 42; // B（32〜47拍）の中。前後の8拍/4拍が B に収まる位置
const BASE_VEL = 0.6;

function makeSectioned(over = {}) {
  const melody = [];
  const accomp = [];
  for (let beat = 0; beat < 64; beat++) {
    melody.push({ midi: 60 + PHRASE_CONTOUR[beat % PHRASE], beat, dur: 1, vel: BASE_VEL });
    accomp.push({ midi: 48 + PHRASE_CONTOUR[beat % PHRASE], beat, dur: 1, vel: BASE_VEL });
  }
  return {
    seed: 'sec001',
    mode: 'major',
    tonicMidi: 60,
    tempo: 68,
    bars: 16,
    totalBeats: 64,
    climaxBeat: SECTIONED_CLIMAX,
    sections: [
      { name: 'A', progressionId: 'p1', startBar: 0, slots: [] },
      { name: "A'", progressionId: 'p2', startBar: 4, slots: [] },
      { name: 'B', progressionId: 'p3', startBar: 8, slots: [] },
      { name: "A''", progressionId: 'p4', startBar: 12, slots: [] },
    ],
    melody,
    accomp,
    bass: [{ midi: 36, beat: 0, dur: 4, vel: 0.5 }],
    pad: [{ midis: [60, 64, 67], beat: 0, dur: 8, vel: 0.3 }],
    ...over,
  };
}

// makeSectioned は1拍に1音ずつなので、レイヤー内のイベント index がそのまま拍番号になる。
function velByBeat(res, layer) {
  return layerOf(res, layer).map((e) => e.vel);
}

// 拍の範囲 [lo, hi) の vel 平均
function meanBeats(vels, lo, hi) {
  return mean(vels.slice(lo, hi));
}

// セクション名 → そのセクションの vel 平均
function sectionMeans(res, layer) {
  const vels = velByBeat(res, layer);
  const out = {};
  ['A', "A'", 'B', "A''"].forEach((name, i) => {
    out[name] = meanBeats(vels, i * SEC_BEATS, (i + 1) * SEC_BEATS);
  });
  return out;
}

test('決定論性: 同じ曲・同じ設定なら2回呼んでも完全に一致する', () => {
  const song = makeSong();
  const settings = { timingJitterMs: 20, velocityJitter: 15, tenuto: true, ritardando: true };
  const a = buildPerformance(song, settings);
  const b = buildPerformance(song, settings);
  assert.deepEqual(a.events, b.events);
  assert.equal(a.durationSec, b.durationSec);
  assert.equal(a.events.length, NOTE_COUNT);
});

test('シードが違えば揺らぎが変わる', () => {
  const settings = { timingJitterMs: 20, velocityJitter: 15, tenuto: true, ritardando: true };
  const a = buildPerformance(makeSong({ seed: 'a3f91c' }), settings);
  const b = buildPerformance(makeSong({ seed: 'b7c204' }), settings);
  const atsA = a.events.map((e) => e.at);
  const atsB = b.events.map((e) => e.at);
  assert.equal(atsA.length, atsB.length);
  assert.notDeepEqual(atsA, atsB);
});

test('events は at の昇順にソートされている', () => {
  const res = buildPerformance(makeSong(), { timingJitterMs: 30, velocityJitter: 25 });
  for (let i = 1; i < res.events.length; i++) {
    assert.ok(
      res.events[i - 1].at <= res.events[i].at,
      `未ソート: index ${i - 1} の ${res.events[i - 1].at} > index ${i} の ${res.events[i].at}`,
    );
  }
});

test('durationSec は全イベントの at + dur の最大値', () => {
  const res = buildPerformance(makeSong(), { timingJitterMs: 20, velocityJitter: 10 });
  const expected = res.events.reduce((max, e) => Math.max(max, e.at + e.dur), 0);
  assert.equal(res.durationSec, expected);
  assert.ok(res.durationSec > 0);
});

// 強弱とルバートは「揺らぎ」ではなく音楽の骨格なので、設定に関係なく常に掛かる。
// したがって揺らぎ0でも at は beat*spb そのものではなく、
// 「beat*spb ＋ フレーズ末の呼吸 ＋ クライマックス手前のためらい」になる。
test('揺らぎ0なら at・dur・vel は強弱設計どおりの値に厳密一致する', () => {
  const song = makeSong();
  const spb = spbOf(song);
  const res = buildPerformance(song, NO_JITTER);

  const lastSet = refPhraseLast(song.melody);
  const expected = [];
  song.melody.forEach((n, i) => {
    const breathes = lastSet.has(i) && n.beat !== song.climaxBeat;
    expected.push({
      at: n.beat * spb + (breathes ? 0.015 : 0) + refHesitate(song, n.beat, spb),
      dur: n.dur * spb * (breathes ? 1.08 : 1),
      vel: clampVel(n.vel * refDyn(song, n.beat, 'melody')),
    });
  });
  for (const layer of ['accomp', 'bass']) {
    for (const n of song[layer]) {
      expected.push({
        at: n.beat * spb + refHesitate(song, n.beat, spb),
        dur: n.dur * spb,
        vel: clampVel(n.vel * refDyn(song, n.beat, layer)),
      });
    }
  }
  for (const p of song.pad) {
    expected.push({
      at: p.beat * spb + refHesitate(song, p.beat, spb),
      dur: p.dur * spb,
      vel: clampVel(p.vel * refDyn(song, p.beat, 'pad')),
    });
  }
  expected.sort((a, b) => a.at - b.at);

  assert.equal(res.events.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(res.events[i].at, expected[i].at, `index ${i} の at`);
    assert.equal(res.events[i].dur, expected[i].dur, `index ${i} の dur`);
    assert.equal(res.events[i].vel, expected[i].vel, `index ${i} の vel`);
  }
});

test('タイミングの揺らぎは ±timingJitterMs の範囲に収まる', () => {
  const song = makeSong();
  const spb = spbOf(song);
  const res = buildPerformance(song, { timingJitterMs: 30, velocityJitter: 0, tenuto: false, ritardando: false });

  const sorted = song.melody.slice().sort((a, b) => a.beat - b.beat);
  const lastSet = refPhraseLast(song.melody);
  const mel = melodyOf(res);
  assert.equal(mel.length, sorted.length);

  let moved = 0;
  for (let i = 0; i < mel.length; i++) {
    const n = sorted[i];
    // フレーズ末の呼吸（15ms）とクライマックス手前のためらいは揺らぎとは別物なので除く。
    const idx = song.melody.indexOf(n);
    const breath = lastSet.has(idx) && n.beat !== song.climaxBeat ? 0.015 : 0;
    const base = n.beat * spb + breath + refHesitate(song, n.beat, spb);
    const diff = Math.abs(mel[i].at - base);
    assert.ok(diff <= 0.03 + 1e-9, `揺らぎ過大: ${diff}`);
    if (diff > 0) moved++;
  }
  assert.ok(moved > 0, '揺らぎが全く掛かっていない');
});

test('テヌート: 頂点音は dur が1.15倍になり発音が30ms遅れる', () => {
  const song = makeSong();
  const on = buildPerformance(song, { ...NO_JITTER, tenuto: true });
  const off = buildPerformance(song, { ...NO_JITTER, tenuto: false });

  const climaxOn = melodyOf(on).find((e) => e.midi === CLIMAX_MIDI);
  const climaxOff = melodyOf(off).find((e) => e.midi === CLIMAX_MIDI);
  assert.ok(climaxOn && climaxOff);

  assert.ok(Math.abs(climaxOn.dur - climaxOff.dur * 1.15) < 1e-12, `dur: ${climaxOn.dur} vs ${climaxOff.dur}`);
  assert.ok(Math.abs(climaxOn.at - (climaxOff.at + 0.03)) < 1e-12, `at: ${climaxOn.at} vs ${climaxOff.at}`);
});

test('テヌートはクライマックスの音にしか効かない', () => {
  const song = makeSong();
  const on = melodyOf(buildPerformance(song, { ...NO_JITTER, tenuto: true }));
  const off = melodyOf(buildPerformance(song, { ...NO_JITTER, tenuto: false }));
  assert.equal(on.length, off.length);

  for (let i = 0; i < on.length; i++) {
    if (on[i].midi === CLIMAX_MIDI) continue;
    assert.equal(on[i].dur, off[i].dur, `melody index ${i} の dur が変わった`);
    assert.equal(on[i].at, off[i].at, `melody index ${i} の at が変わった`);
  }

  // 伴奏・ベース・パッドも一切影響を受けない
  const onOther = buildPerformance(song, { ...NO_JITTER, tenuto: true }).events.filter((e) => e.kind === 'pad' || e.layer !== 'melody');
  const offOther = buildPerformance(song, { ...NO_JITTER, tenuto: false }).events.filter((e) => e.kind === 'pad' || e.layer !== 'melody');
  assert.deepEqual(onOther, offOther);
});

test('リタルダンド: 最終小節の音が後ろにずれる', () => {
  const song = makeSong();
  const spb = spbOf(song);
  const on = buildPerformance(song, { ...NO_JITTER, ritardando: true });
  const off = buildPerformance(song, { ...NO_JITTER, ritardando: false });

  const lastOn = melodyOf(on).at(-1);
  const lastOff = melodyOf(off).at(-1);
  assert.equal(lastOn.midi, lastOff.midi);
  assert.ok(lastOn.at > lastOff.at, `ずれていない: ${lastOn.at} vs ${lastOff.at}`);

  // beat 30 → t = (30-24)/8 = 0.75 → delay = 0.75^2 * 0.5 * spb
  const expected = lastOff.at + 0.75 * 0.75 * 0.5 * spb;
  assert.ok(Math.abs(lastOn.at - expected) < 1e-12, `${lastOn.at} vs ${expected}`);

  // 開始拍ちょうど（beat 24）は t=0 なので遅れない
  const startOn = melodyOf(on).find((e) => e.midi === 77);
  const startOff = melodyOf(off).find((e) => e.midi === 77);
  assert.equal(startOn.at, startOff.at);

  // 全レイヤーに同じ遅れが掛かる（beat 30 の accomp も同じだけずれる）
  const accOn = on.events.find((e) => e.kind === 'piano' && e.layer === 'accomp' && e.midi === 62);
  const accOff = off.events.find((e) => e.kind === 'piano' && e.layer === 'accomp' && e.midi === 62);
  assert.ok(Math.abs((accOn.at - accOff.at) - (lastOn.at - lastOff.at)) < 1e-12);
});

test('リタルダンドは曲の前半に影響しない', () => {
  const song = makeSong();
  const ritStartSec = (song.bars - 2) * 4 * spbOf(song);
  const on = buildPerformance(song, { ...NO_JITTER, ritardando: true });
  const off = buildPerformance(song, { ...NO_JITTER, ritardando: false });
  assert.equal(on.events.length, off.events.length);

  let checked = 0;
  for (let i = 0; i < off.events.length; i++) {
    if (off.events[i].at >= ritStartSec) continue;
    assert.deepEqual(on.events[i], off.events[i], `index ${i} の前半イベントが変わった`);
    checked++;
  }
  assert.ok(checked > 0, '前半のイベントが1つも無い');
});

test('at は負にならない（beat 0 の音に最大の揺らぎを与えても0以上）', () => {
  let clamped = 0;
  for (let i = 0; i < 60; i++) {
    const song = makeSong({
      seed: `zz${i}`,
      melody: [
        { midi: 72, beat: 0, dur: 1, vel: 0.7 },
        { midi: 76, beat: 0, dur: 1, vel: 0.7 },
      ],
      accomp: [{ midi: 64, beat: 0, dur: 2, vel: 0.4 }],
      bass: [{ midi: 48, beat: 0, dur: 4, vel: 0.5 }],
      pad: [{ midis: [60, 64, 67], beat: 0, dur: 8, vel: 0.3 }],
    });
    const res = buildPerformance(song, { timingJitterMs: 30, velocityJitter: 25, tenuto: false, ritardando: false });
    for (const e of res.events) {
      assert.ok(e.at >= 0, `at が負: ${e.at}`);
      if (e.at === 0) clamped++;
    }
  }
  assert.ok(clamped > 0, '0でクランプされた形跡が無い（テストが揺らぎを踏んでいない）');
});

test('pad イベントは kind が pad で midis が配列', () => {
  const song = makeSong();
  const res = buildPerformance(song, { timingJitterMs: 20, velocityJitter: 10 });
  const pads = res.events.filter((e) => e.kind === 'pad');
  assert.equal(pads.length, song.pad.length);

  for (const p of pads) {
    assert.equal(p.kind, 'pad');
    assert.ok(Array.isArray(p.midis));
    assert.ok(p.midis.length > 0);
    for (const m of p.midis) assert.equal(typeof m, 'number');
    assert.equal(p.layer, undefined);
    assert.equal(typeof p.at, 'number');
    assert.equal(typeof p.dur, 'number');
  }
  assert.deepEqual(pads.map((p) => p.midis), song.pad.map((p) => p.midis));

  // ピアノ側は layer 付きで midi は単一の数値
  for (const e of res.events.filter((x) => x.kind === 'piano')) {
    assert.ok(['melody', 'accomp', 'bass'].includes(e.layer));
    assert.equal(typeof e.midi, 'number');
  }
});

test('乱数は melody → accomp → bass の順に、1音ごとタイミング→ベロシティで消費される', () => {
  // 消費順がずれると同じシードでも別の演奏になり、曲コードから再現できなくなる。
  // beat 0 を避けて 0 クランプの影響を除く。
  const song = makeSong({
    climaxBeat: -1,
    melody: [
      { midi: 72, beat: 4, dur: 1, vel: 0.70 },
      { midi: 76, beat: 8, dur: 1, vel: 0.60 },
    ],
    accomp: [{ midi: 64, beat: 4, dur: 2, vel: 0.40 }],
    bass: [{ midi: 48, beat: 4, dur: 4, vel: 0.50 }],
    pad: [{ midis: [60, 64, 67], beat: 4, dur: 8, vel: 0.30 }],
  });
  const spb = spbOf(song);
  const jitterMs = 30;
  const velJitter = 20;
  const res = buildPerformance(song, { timingJitterMs: jitterMs, velocityJitter: velJitter, tenuto: false, ritardando: false });

  const rng = makeRng(seedFromString(song.seed + ':perf'));
  // この曲は各フレーズにメロディーが1音ずつなので、2音ともフレーズ末＝呼吸15msが乗る。
  // 強弱係数はどの音も 1.0 になる配置にしてあるので vel は素の揺らぎだけ。
  const draw = (note, scale, breath = 0) => ({
    at: note.beat * spb + (rng() - 0.5) * 2 * (jitterMs / 1000) * scale + breath,
    vel: note.vel * (1 + (rng() - 0.5) * 2 * (velJitter / 100)),
  });
  const expected = [
    draw(song.melody[0], 1, 0.015),
    draw(song.melody[1], 1, 0.015),
    draw(song.accomp[0], 0.5),
    draw(song.bass[0], 0.5),
  ];

  const actual = [
    res.events.find((e) => e.kind === 'piano' && e.midi === 72),
    res.events.find((e) => e.kind === 'piano' && e.midi === 76),
    res.events.find((e) => e.kind === 'piano' && e.layer === 'accomp'),
    res.events.find((e) => e.kind === 'piano' && e.layer === 'bass'),
  ];

  for (let i = 0; i < expected.length; i++) {
    assert.equal(actual[i].at, expected[i].at, `イベント ${i} の at`);
    assert.equal(actual[i].vel, expected[i].vel, `イベント ${i} の vel`);
  }

  // パッドは乱数を消費せず揺らぎも受けない
  const pad = res.events.find((e) => e.kind === 'pad');
  assert.equal(pad.at, song.pad[0].beat * spb);
  assert.equal(pad.vel, song.pad[0].vel);
});

test('ベロシティは 0.05〜1.0 に収まる', () => {
  const res = buildPerformance(makeSong(), { timingJitterMs: 30, velocityJitter: 25 });
  for (const e of res.events) {
    assert.ok(e.vel >= 0.05 && e.vel <= 1.0, `範囲外: ${e.vel}`);
  }

  // 極端な入力でもクランプされる
  const extreme = makeSong({
    melody: [
      { midi: 72, beat: 0, dur: 1, vel: 0.01 },
      { midi: 74, beat: 1, dur: 1, vel: 1.0 },
    ],
    accomp: [{ midi: 64, beat: 0, dur: 2, vel: 0.0 }],
    bass: [{ midi: 48, beat: 0, dur: 4, vel: 1.0 }],
    pad: [{ midis: [60, 64, 67], beat: 0, dur: 8, vel: 0.3 }],
  });
  const res2 = buildPerformance(extreme, { timingJitterMs: 10, velocityJitter: 25 });
  for (const e of res2.events) {
    assert.ok(e.vel >= 0.05 && e.vel <= 1.0, `範囲外: ${e.vel}`);
  }
  assert.ok(res2.events.some((e) => e.vel === 0.05), '下限クランプが働いていない');
});

// ===========================================================================
// 強弱設計（dynamics）
// 平坦な強弱はどんなに良い旋律も殺す。ここが崩れたら曲の感動が消える。
// ===========================================================================

test('第1層: セクションごとの平均ベロシティが A < A\' < B になる', () => {
  const res = buildPerformance(makeSectioned(), NO_JITTER);
  const s = sectionMeans(res, 'melody');

  // 実測: A=0.46410 / A'=0.51870 / B=0.60054（基準レベル 0.85 / 0.95 / 1.10 を反映）
  assert.ok(s.A < s["A'"], `A(${s.A}) < A'(${s["A'"]}) でない`);
  assert.ok(s["A'"] < s.B, `A'(${s["A'"]}) < B(${s.B}) でない`);

  // 係数そのものも確認する（フレーズ内スウェルの平均は全セクション共通で 0.91）
  assert.ok(Math.abs(s.A / BASE_VEL - 0.85 * 0.91) < 1e-12, `A の係数: ${s.A / BASE_VEL}`);
  assert.ok(Math.abs(s["A'"] / BASE_VEL - 0.95 * 0.91) < 1e-12, `A' の係数: ${s["A'"] / BASE_VEL}`);
});

test("第1層: A'' は後半の方が静かになる（曲の終わりに向けて収める）", () => {
  const res = buildPerformance(makeSectioned(), NO_JITTER);
  const vels = velByBeat(res, 'melody');
  const first = meanBeats(vels, 48, 56);
  const second = meanBeats(vels, 56, 64);

  // 実測: 前半 0.40652 → 後半 0.33827
  assert.ok(second < first, `収束していない: 前半 ${first} / 後半 ${second}`);

  // 基準レベルは 0.80 → 0.55 の線形。先頭拍はちょうど 0.80。
  const headFactor = vels[48] / BASE_VEL;
  assert.ok(Math.abs(headFactor - 0.8 * 0.82) < 1e-12, `A'' 先頭の係数: ${headFactor}`);
  // A'' 全体でも A より静か
  assert.ok(meanBeats(vels, 48, 64) < meanBeats(vels, 0, 16));
});

test('第2層: フレーズ内で最高音が山になり、両端に向かって収まる', () => {
  const song = makeSectioned();
  const res = buildPerformance(song, NO_JITTER); // velocityJitter 0 で検証
  const vels = velByBeat(res, 'melody');

  // フレーズ0（0〜7拍）の最高音は p=0.5 の 4拍目。端は 0拍目と 7拍目。
  const peak = vels[4];
  assert.ok(peak > vels[0], `頂点(${peak}) が始端(${vels[0]}) 以下`);
  assert.ok(peak > vels[7], `頂点(${peak}) が終端(${vels[7]}) 以下`);
  // 山に向かって単調に増え、越えたら減る
  for (let b = 1; b <= 4; b++) assert.ok(vels[b] > vels[b - 1], `${b}拍目で登っていない`);
  for (let b = 5; b <= 7; b++) assert.ok(vels[b] < vels[b - 1], `${b}拍目で降りていない`);

  // 係数そのもの: 頂点で 1.0、端で 1-0.18*0.5/0.5 = 0.82
  const level = 0.85; // セクション A
  assert.ok(Math.abs(peak / BASE_VEL - level * 1.0) < 1e-12, `頂点の係数: ${peak / BASE_VEL}`);
  assert.ok(Math.abs(vels[0] / BASE_VEL - level * 0.82) < 1e-12, `端の係数: ${vels[0] / BASE_VEL}`);

  // 頂点が端に寄っていてもゼロ除算しない（q=0 のフレーズ）
  const edgeSong = makeSectioned({
    melody: [
      { midi: 84, beat: 0, dur: 1, vel: 0.6 }, // 最高音がフレーズ先頭
      { midi: 60, beat: 4, dur: 1, vel: 0.6 },
      { midi: 62, beat: 7, dur: 1, vel: 0.6 },
    ],
    accomp: [],
    climaxBeat: -1,
  });
  const edge = velByBeat(buildPerformance(edgeSong, NO_JITTER), 'melody');
  for (const v of edge) assert.ok(Number.isFinite(v), `NaN/Infinity が出た: ${v}`);
  // q=0 なので span = max(0, 1, 0.25) = 1。p=0.5 の音は 1-0.18*0.5 = 0.91 倍
  assert.ok(Math.abs(edge[1] / 0.6 - 0.85 * 0.91) < 1e-12, `q=0 のときの係数: ${edge[1] / 0.6}`);
});

test('第3層: クライマックス手前2小節でベロシティが上昇していく', () => {
  const res = buildPerformance(makeSectioned(), NO_JITTER);
  const vels = velByBeat(res, 'melody');
  const c = SECTIONED_CLIMAX;

  // 手前8拍を4等分（各2拍）
  const q = [0, 1, 2, 3].map((i) => meanBeats(vels, c - 8 + i * 2, c - 6 + i * 2));
  const firstHalf = mean([q[0], q[1]]);
  const secondHalf = mean([q[2], q[3]]);

  // 実測: 区間平均 0.55420 / 0.63195 / 0.62060 / 0.63419 → 前半 0.59308 < 後半 0.62740
  assert.ok(secondHalf > firstHalf, `盛り上がっていない: 前半 ${firstHalf} / 後半 ${secondHalf}`);
  assert.ok(q[3] > q[0], `最終区間(${q[3]}) が最初の区間(${q[0]}) 以下`);

  // クレッシェンドの入口は 0.88、頂点の音は 1.20
  const factorAt = (beat) => vels[beat] / (BASE_VEL * refSection(makeSectioned(), beat) * refSwell(makeSectioned(), beat));
  assert.ok(Math.abs(factorAt(c - 8) - 0.88) < 1e-12, `入口の係数: ${factorAt(c - 8)}`);
  assert.ok(Math.abs(factorAt(c) - 1.2) < 1e-12, `頂点の係数: ${factorAt(c)}`);
});

test('第3層: クライマックス直後は直前より脱力する（サビの後の解放）', () => {
  const res = buildPerformance(makeSectioned(), NO_JITTER);
  const vels = velByBeat(res, 'melody');
  const c = SECTIONED_CLIMAX;

  const before = meanBeats(vels, c - 4, c);   // 38〜41拍
  const after = meanBeats(vels, c + 1, c + 5); // 43〜46拍

  // 実測: 直前 0.62740 → 直後 0.58076
  assert.ok(after < before, `脱力していない: 直前 ${before} / 直後 ${after}`);

  // 落ち切った拍（クライマックス+4）の係数は 0.75
  const song = makeSectioned();
  const tail = vels[c + 4] / (BASE_VEL * refSection(song, c + 4) * refSwell(song, c + 4));
  assert.ok(Math.abs(tail - 0.75) < 1e-12, `解放後の係数: ${tail}`);
});

test('伴奏・ベース・パッドは同じ強弱カーブを深さ60%で追う', () => {
  const song = makeSectioned();
  const res = buildPerformance(song, NO_JITTER);

  // B の伴奏平均 > A の伴奏平均（メロディーと同じ方向に動く）
  const acc = sectionMeans(res, 'accomp');
  // 実測: A=0.51846 / B=0.60032
  assert.ok(acc.B > acc.A, `伴奏が追従していない: A=${acc.A} / B=${acc.B}`);
  assert.ok(acc["A'"] > acc.A, `伴奏 A' が A 以下: ${acc["A'"]} vs ${acc.A}`);
  assert.ok(acc["A''"] < acc.A, `伴奏 A'' が A 以上: ${acc["A''"]} vs ${acc.A}`);

  // 深さは melody 係数 f に対して 1 + (f-1)*0.6
  const mel = velByBeat(res, 'melody');
  const accVels = velByBeat(res, 'accomp');
  for (const beat of [0, 4, 20, 36, SECTIONED_CLIMAX, 50, 63]) {
    const f = mel[beat] / BASE_VEL;
    const expected = BASE_VEL * (1 + (f - 1) * 0.6);
    assert.ok(Math.abs(accVels[beat] - expected) < 1e-12, `${beat}拍目の伴奏: ${accVels[beat]} vs ${expected}`);
  }

  // 伴奏の振れ幅はメロディーより小さい（60%の深さ）
  const spread = (xs) => Math.max(...xs) - Math.min(...xs);
  assert.ok(spread(accVels) < spread(mel), '伴奏の振れ幅がメロディー以上になっている');

  // パッドも同じ係数で動く
  const padSong = makeSectioned({ pad: [{ midis: [60, 64, 67], beat: 36, dur: 8, vel: 0.3 }] });
  const padRes = buildPerformance(padSong, NO_JITTER);
  const pad = padRes.events.find((e) => e.kind === 'pad');
  assert.ok(Math.abs(pad.vel - 0.3 * refDyn(padSong, 36, 'pad')) < 1e-12, `パッド: ${pad.vel}`);
  assert.ok(pad.vel > 0.3, 'クレッシェンド中のパッドが持ち上がっていない');
});

// ===========================================================================
// ルバート
// ===========================================================================

test('クライマックス直前2拍の音がルバート無しの位置より後ろにずれる', () => {
  const song = makeSectioned();
  const spb = spbOf(song);
  const c = SECTIONED_CLIMAX;
  const res = buildPerformance(song, NO_JITTER);

  const mel = layerOf(res, 'melody');
  const acc = layerOf(res, 'accomp');

  // 手前2拍の入口（c-2）は u=0 なので遅れず、c-1 は u=0.5 で 0.5^2*0.10 = 0.025拍 遅れる。
  assert.equal(mel[c - 2].at, (c - 2) * spb, 'ためらいの入口が既に遅れている');
  const delay = mel[c - 1].at - (c - 1) * spb;
  assert.ok(delay > 0, `後ろにずれていない: ${delay}`);
  assert.ok(Math.abs(delay - 0.5 * 0.5 * 0.1 * spb) < 1e-12, `ためらいの量: ${delay}`);
  // 実測: spb=60/68 のとき 0.025拍 = 約22.06ms
  assert.ok(Math.abs(delay - 0.02205882352941177) < 1e-9, `${delay}`);

  // 全レイヤーに同じ delay が掛かる（メロディーだけ遅れるとバラバラに聴こえる）
  assert.ok(Math.abs(acc[c - 1].at - (c - 1) * spb - delay) < 1e-12, '伴奏に同じ遅れが掛かっていない');

  // 窓の外には掛からない（c-4 はフレーズ末でもないので素の位置のまま。
  // c-3 = 39拍はフレーズ末なので呼吸15msだけが乗る）
  assert.equal(mel[c - 4].at, (c - 4) * spb);
  assert.ok(Math.abs(mel[c - 3].at - ((c - 3) * spb + 0.015)) < 1e-12, `c-3 の at: ${mel[c - 3].at}`);
  assert.equal(mel[c].at, c * spb, 'クライマックスそのものが遅れている');
});

test('フレーズ末の音は15ms遅れて dur が1.08倍になる（クライマックスの音は除く）', () => {
  const song = makeSectioned();
  const spb = spbOf(song);
  const res = buildPerformance(song, NO_JITTER);
  const mel = layerOf(res, 'melody');

  // 1拍1音なので index = 拍。フレーズ末は 7, 15, 23, ... 拍。
  for (const beat of [7, 15, 23, 31, 39, 47, 55]) {
    assert.ok(Math.abs(mel[beat].at - (beat * spb + 0.015)) < 1e-12, `${beat}拍目の at: ${mel[beat].at}`);
    assert.ok(Math.abs(mel[beat].dur - spb * 1.08) < 1e-12, `${beat}拍目の dur: ${mel[beat].dur}`);
  }
  // フレーズ末でない音は素のまま
  for (const beat of [6, 14, 30, 46]) {
    assert.equal(mel[beat].at, beat * spb, `${beat}拍目が動いている`);
    assert.equal(mel[beat].dur, spb, `${beat}拍目の dur が変わっている`);
  }
  // 伴奏には掛からない（呼吸するのは旋律線）
  const acc = layerOf(res, 'accomp');
  assert.equal(acc[7].at, 7 * spb);
  assert.equal(acc[7].dur, spb);

  // クライマックスの音がフレーズ末でも、テヌートと二重には掛からない
  const climaxSong = makeSong(); // climaxBeat 12 はフレーズ1（8〜15拍）唯一の音＝フレーズ末
  const cSpb = spbOf(climaxSong);
  const plain = melodyOf(buildPerformance(climaxSong, NO_JITTER)).find((e) => e.midi === CLIMAX_MIDI);
  assert.equal(plain.at, CLIMAX_BEAT * cSpb, '頂点音に呼吸が掛かっている');
  assert.equal(plain.dur, 2 * cSpb, '頂点音の dur に呼吸が掛かっている');

  const tenuto = melodyOf(buildPerformance(climaxSong, { ...NO_JITTER, tenuto: true })).find((e) => e.midi === CLIMAX_MIDI);
  assert.ok(Math.abs(tenuto.at - (CLIMAX_BEAT * cSpb + 0.03)) < 1e-12, `テヌートと二重掛け: ${tenuto.at}`);
  assert.ok(Math.abs(tenuto.dur - 2 * cSpb * 1.15) < 1e-12, `テヌートと二重掛け: ${tenuto.dur}`);
});

// ===========================================================================
// 不変条件（強弱を足しても壊れてはいけないもの）
// ===========================================================================

test('強弱を足しても決定論性と乱数の消費順は変わらない', () => {
  const song = makeSectioned();
  const settings = { timingJitterMs: 20, velocityJitter: 15, tenuto: true, ritardando: true };
  const a = buildPerformance(song, settings);
  const b = buildPerformance(song, settings);
  assert.deepEqual(a.events, b.events);
  assert.equal(a.durationSec, b.durationSec);

  // 強弱の計算が乱数を1つも消費していないこと。
  // 消費していれば、強弱係数が違う曲（climaxBeat 違い）で「揺らぎ幅」まで変わってしまう。
  const shifted = buildPerformance(makeSectioned({ climaxBeat: 10 }), settings);
  const jitterOf = (res, song) => {
    const spb = spbOf(song);
    return layerOf(res, 'accomp').map((e, i) => e.at - i * spb - refHesitate(song, i, spb));
  };
  const base = jitterOf(a, song);
  const moved = jitterOf(shifted, makeSectioned({ climaxBeat: 10 }));
  for (let i = 0; i < base.length; i++) {
    assert.ok(Math.abs(base[i] - moved[i]) < 1e-12, `${i}拍目の揺らぎが強弱に汚染されている`);
  }
});

test('強弱を掛けてもベロシティは 0.05〜1.0 に収まる', () => {
  for (const settings of [NO_JITTER, { timingJitterMs: 30, velocityJitter: 25, tenuto: true, ritardando: true }]) {
    const res = buildPerformance(makeSectioned(), settings);
    for (const e of res.events) assert.ok(e.vel >= 0.05 && e.vel <= 1.0, `範囲外: ${e.vel}`);
  }

  // クライマックス直前の最大係数（1.10 * 1.0 * 1.20 = 1.32）でも上限を超えない
  const loud = makeSectioned({
    melody: [{ midi: 84, beat: SECTIONED_CLIMAX, dur: 1, vel: 0.95 }],
    accomp: [{ midi: 60, beat: SECTIONED_CLIMAX, dur: 1, vel: 0.95 }],
  });
  const res = buildPerformance(loud, { timingJitterMs: 0, velocityJitter: 25, tenuto: true, ritardando: true });
  for (const e of res.events) assert.ok(e.vel >= 0.05 && e.vel <= 1.0, `範囲外: ${e.vel}`);
  assert.ok(res.events.some((e) => e.vel === 1.0), '上限クランプが働いていない');

  // A'' の末尾でも下限を割らない
  const quiet = makeSectioned({
    melody: [{ midi: 60, beat: 63, dur: 1, vel: 0.02 }],
    accomp: [],
  });
  for (const e of buildPerformance(quiet, { timingJitterMs: 0, velocityJitter: 25 }).events) {
    assert.ok(e.vel >= 0.05, `下限割れ: ${e.vel}`);
  }
});

test('強弱とルバートを足しても at は非負で昇順のまま', () => {
  for (const settings of [NO_JITTER, { timingJitterMs: 30, velocityJitter: 25, tenuto: true, ritardando: true }]) {
    const res = buildPerformance(makeSectioned(), settings);
    for (const e of res.events) assert.ok(e.at >= 0, `at が負: ${e.at}`);
    for (let i = 1; i < res.events.length; i++) {
      assert.ok(res.events[i - 1].at <= res.events[i].at, `未ソート: index ${i}`);
    }
    // レイヤー内では拍の順序が保たれている（ルバートが順序を追い越さない）
    for (const layer of ['melody', 'accomp']) {
      const xs = layerOf(res, layer).map((e) => e.at);
      for (let i = 1; i < xs.length; i++) assert.ok(xs[i - 1] < xs[i], `${layer} の ${i} 番目で追い越し`);
    }
  }
});

test('sections が空でも climaxBeat が無くても落ちない', () => {
  const noSections = buildPerformance(makeSong({ sections: [] }), NO_JITTER);
  for (const e of noSections.events) assert.ok(Number.isFinite(e.vel) && Number.isFinite(e.at));

  const noClimax = buildPerformance(makeSectioned({ climaxBeat: undefined }), NO_JITTER);
  for (const e of noClimax.events) assert.ok(Number.isFinite(e.vel) && Number.isFinite(e.at));
  // クライマックスが無ければ第3層は掛からず、B の平均は 1.10 * 0.91 倍のまま
  const b = sectionMeans(noClimax, 'melody').B;
  assert.ok(Math.abs(b / BASE_VEL - 1.1 * 0.91) < 1e-12, `B の係数: ${b / BASE_VEL}`);

  // メロディーの無いフレーズがあってもスウェルは 1.0（NaN にならない）
  const sparse = buildPerformance(makeSectioned({ melody: [{ midi: 72, beat: 0, dur: 1, vel: 0.6 }] }), NO_JITTER);
  for (const e of sparse.events) assert.ok(Number.isFinite(e.vel), `NaN: ${e.vel}`);
});

test('強弱の起伏は tenuto / ritardando の ON/OFF とは独立に常に掛かる', () => {
  const song = makeSectioned();
  const combos = [
    { tenuto: false, ritardando: false },
    { tenuto: true, ritardando: true },
  ];
  for (const c of combos) {
    const vels = velByBeat(buildPerformance(song, { timingJitterMs: 0, velocityJitter: 0, ...c }), 'melody');
    const s = { A: meanBeats(vels, 0, 16), B: meanBeats(vels, 32, 48) };
    assert.ok(s.B > s.A, `tenuto=${c.tenuto} ritardando=${c.ritardando} で強弱が消えた`);
    // 平坦でないこと（起伏の幅が十分にある）
    assert.ok(Math.max(...vels) - Math.min(...vels) > 0.2, '強弱が平坦');
  }
});
