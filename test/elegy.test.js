// エレジー（固定曲）の検査。
//
// 仕様は「生成後に機械で検査し、違反があれば別の種で作り直す」なので、
// ここでは inspect() が通ることに加えて、集計では見えない欠陥
// ——同時打鍵・音の重なり・空の小節——も直接見る。
// 過去にこの3つは、統計だけ見ていたせいで見落とした。

import test from 'node:test';
import assert from 'node:assert/strict';
import { compose, inspect, DEFAULT_ATTEMPTS } from '../src/elegySong.js';
import { RANGE, HARMONY } from '../src/elegy.js';

const { MEL_LO, MEL_HI, LH_LO, LH_HI, BEATS_PER_BAR } = RANGE;
const BARS = 32;

const built = compose(1, DEFAULT_ATTEMPTS);
const { song } = built;
const mel = song.melody.slice().sort((a, b) => a.beat - b.beat);

test('検査項目にひとつも違反しない種が見つかる', () => {
  assert.notEqual(built.seed, null, `違反: ${(built.issues ?? []).join(' / ')}`);
  assert.deepEqual(inspect(song), []);
});

test('旋律は Eb4〜Ab5 に収まる', () => {
  for (const n of mel) {
    assert.ok(n.midi >= MEL_LO && n.midi <= MEL_HI, `音域外 ${n.midi} @ 拍${n.beat}`);
  }
});

test('左手は C2〜C4 に収まり、旋律より上へ出ない', () => {
  const lh = [...song.bass, ...song.accomp].flatMap((e) => e.midis ?? [e.midi]);
  for (const m of lh) assert.ok(m >= LH_LO && m <= LH_HI, `左手が音域外 ${m}`);
  for (const e of [...song.bass, ...song.accomp]) {
    const under = mel.filter((n) => n.beat < e.beat + e.dur && n.beat + n.dur > e.beat);
    if (under.length === 0) continue;
    const top = Math.max(...(e.midis ?? [e.midi]));
    assert.ok(top < Math.min(...under.map((n) => n.midi)), `拍${e.beat}で声部が交差`);
  }
});

test('旋律に同時打鍵も音の重なりも無い', () => {
  for (let i = 1; i < mel.length; i += 1) {
    assert.notEqual(mel[i].beat, mel[i - 1].beat, `拍${mel[i].beat}で2音が同時`);
    assert.ok(mel[i].beat >= mel[i - 1].beat + mel[i - 1].dur - 1e-9,
      `拍${mel[i].beat}で前の音と重なる`);
  }
});

test('空の小節が無い', () => {
  for (let bar = 0; bar < BARS; bar += 1) {
    assert.ok(mel.some((n) => Math.floor(n.beat / BEATS_PER_BAR) === bar),
      `第${bar + 1}小節が空`);
  }
});

test('最高音 Ab5 は第21〜24小節にただ1回だけ鳴り、下行解決する', () => {
  const peaks = mel.filter((n) => n.midi >= MEL_HI);
  assert.equal(peaks.length, 1);
  const bar = Math.floor(peaks[0].beat / BEATS_PER_BAR);
  assert.ok(bar >= 20 && bar <= 23, `第${bar + 1}小節に出た`);
  const after = mel[mel.indexOf(peaks[0]) + 1];
  assert.ok(after && after.midi < peaks[0].midi, '下行解決していない');
});

test('音域の山が 提示 < クライマックス、回想 ≦ 提示 になる', () => {
  const avg = [0, 8, 16, 24].map((from) => {
    const l = mel.filter((n) => n.beat >= from * BEATS_PER_BAR
      && n.beat < (from + 8) * BEATS_PER_BAR);
    return l.reduce((a, b) => a + b.midi, 0) / l.length;
  });
  assert.ok(avg[2] > avg[0] + 2, `提示 ${avg[0].toFixed(1)} / 頂点 ${avg[2].toFixed(1)}`);
  assert.ok(avg[3] < avg[0] + 1, `回想 ${avg[3].toFixed(1)} が提示より低くない`);
});

test('リズムが単調にならない', () => {
  const count = new Map();
  for (let bar = 0; bar < BARS; bar += 1) {
    const k = mel.filter((n) => Math.floor(n.beat / BEATS_PER_BAR) === bar)
      .map((n) => `${(n.beat % BEATS_PER_BAR).toFixed(2)}:${n.dur}`).join(',');
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  assert.ok(count.size >= 13, `${count.size} 種類しかない`);
  assert.ok(Math.max(...count.values()) <= 8, '同じリズムが9小節以上ある');
});

test('息継ぎは8小節の終わりに来る（2小節ごとに切れない）', () => {
  // 各8小節の最後の音が、そのフレーズでいちばん長いこと
  for (const from of [0, 8, 16, 24]) {
    const l = mel.filter((n) => n.beat >= from * BEATS_PER_BAR
      && n.beat < (from + 8) * BEATS_PER_BAR);
    const last = l[l.length - 1];
    assert.ok(last.dur >= Math.max(...l.map((n) => n.dur)),
      `第${from + 1}〜${from + 8}小節が途中で息切れしている`);
  }
});

test('和声は指定どおり32小節', () => {
  assert.equal(HARMONY.length, BARS);
});
