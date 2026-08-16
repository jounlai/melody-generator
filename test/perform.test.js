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

test('揺らぎ0なら at は beat * spb に厳密一致する', () => {
  const song = makeSong();
  const spb = spbOf(song);
  const res = buildPerformance(song, NO_JITTER);

  const expected = [];
  for (const layer of ['melody', 'accomp', 'bass']) {
    for (const n of song[layer]) expected.push({ at: n.beat * spb, dur: n.dur * spb, vel: n.vel });
  }
  for (const p of song.pad) expected.push({ at: p.beat * spb, dur: p.dur * spb, vel: p.vel });
  expected.sort((a, b) => a.at - b.at);

  assert.equal(res.events.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(res.events[i].at, expected[i].at);
    assert.equal(res.events[i].dur, expected[i].dur);
    assert.equal(res.events[i].vel, expected[i].vel);
  }
});

test('タイミングの揺らぎは ±timingJitterMs の範囲に収まる', () => {
  const song = makeSong();
  const spb = spbOf(song);
  const res = buildPerformance(song, { timingJitterMs: 30, velocityJitter: 0, tenuto: false, ritardando: false });

  const beats = song.melody.map((n) => n.beat).sort((a, b) => a - b);
  const mel = melodyOf(res);
  assert.equal(mel.length, beats.length);

  let moved = 0;
  for (let i = 0; i < mel.length; i++) {
    const diff = Math.abs(mel[i].at - beats[i] * spb);
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
  const draw = (note, scale) => ({
    at: note.beat * spb + (rng() - 0.5) * 2 * (jitterMs / 1000) * scale,
    vel: note.vel * (1 + (rng() - 0.5) * 2 * (velJitter / 100)),
  });
  const expected = [
    draw(song.melody[0], 1),
    draw(song.melody[1], 1),
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
