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

test('expandBass: octave が音域の上限を越えるなら元の音のまま', () => {
  const out = expandBass([{ beat: 0, kind: 'octave', dur: 2 }], 0, 50, null, [0, 4, 7], 0.5, 55);
  assert.equal(out[0].midi, 50);
});

test('arpeggioIndex: 上行して下行する波で構成音を巡回する', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => arpeggioIndex(i, 3)), [0, 1, 2, 1, 0, 1, 2, 1]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => arpeggioIndex(i, 4)), [0, 1, 2, 3, 2, 1, 0, 1]);
  assert.equal(arpeggioIndex(3, 1), 0);
});
