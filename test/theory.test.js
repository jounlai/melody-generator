import test from 'node:test';
import assert from 'node:assert/strict';
import {
  degToSemitone, degToMidi, parseChord, chordPitchClasses,
  isChordTone, chordVoicing, bassMidi, CHORD_VOCAB,
  splitBars, fitsBar, hasSuspension, nearestChordToneDeg,
} from '../src/theory.js';

test('degToSemitone: メジャースケール', () => {
  assert.equal(degToSemitone(1, 'major'), 0);
  assert.equal(degToSemitone(3, 'major'), 4);
  assert.equal(degToSemitone(7, 'major'), 11);
  assert.equal(degToSemitone(8, 'major'), 12);
  assert.equal(degToSemitone(15, 'major'), 24);
});

test('degToSemitone: 自然的短音階は3度・6度・7度が半音低い', () => {
  assert.equal(degToSemitone(3, 'minor'), 3);
  assert.equal(degToSemitone(6, 'minor'), 8);
  assert.equal(degToSemitone(7, 'minor'), 10);
  assert.equal(degToSemitone(8, 'minor'), 12);
});

test('degToMidi はトニックMIDIを起点にする', () => {
  assert.equal(degToMidi(1, 'major', 60), 60);
  assert.equal(degToMidi(5, 'major', 60), 67);
  assert.equal(degToMidi(8, 'minor', 57), 69);
});

test('parseChord: 転回形と品質を分解する', () => {
  assert.deepEqual(parseChord('I'), { flat: false, rootDeg: 1, minor: false, quality: '', inversion: 0 });
  assert.deepEqual(parseChord('vi'), { flat: false, rootDeg: 6, minor: true, quality: '', inversion: 0 });
  assert.deepEqual(parseChord('V/3'), { flat: false, rootDeg: 5, minor: false, quality: '', inversion: 3 });
  assert.deepEqual(parseChord('IVM7'), { flat: false, rootDeg: 4, minor: false, quality: 'M7', inversion: 0 });
  assert.deepEqual(parseChord('bVII'), { flat: true, rootDeg: 7, minor: false, quality: '', inversion: 0 });
  assert.deepEqual(parseChord('Vsus4'), { flat: false, rootDeg: 5, minor: false, quality: 'sus4', inversion: 0 });
});

test('parseChord: 解釈できない記号は例外', () => {
  assert.throws(() => parseChord('X'), /unparsable|unknown/);
});

test('chordPitchClasses: Cメジャーキーでの実音', () => {
  assert.deepEqual(chordPitchClasses('I', 'major'), [0, 4, 7]);       // C E G
  assert.deepEqual(chordPitchClasses('vi', 'major'), [0, 4, 9]);      // A C E
  assert.deepEqual(chordPitchClasses('iv', 'major'), [0, 5, 8]);      // F Ab C
  assert.deepEqual(chordPitchClasses('bVI', 'major'), [0, 3, 8]);     // Ab C Eb
  assert.deepEqual(chordPitchClasses('V7', 'major'), [2, 5, 7, 11]);  // G B D F
  assert.deepEqual(chordPitchClasses('Vsus4', 'major'), [0, 2, 7]);   // G C D
});

test('chordPitchClasses: マイナーキーの V は導音を含む', () => {
  // Aマイナー相当。V = E G# B
  assert.deepEqual(chordPitchClasses('V', 'minor'), [2, 7, 11]);
  assert.deepEqual(chordPitchClasses('VI', 'minor'), [0, 3, 8]);
});

test('isChordTone は非和声音を弾く', () => {
  assert.equal(isChordTone(3, 'major', 'I'), true);
  assert.equal(isChordTone(4, 'major', 'I'), false);
  assert.equal(isChordTone(10, 'major', 'I'), true);   // 1オクターブ上の3度
  assert.equal(isChordTone(7, 'minor', 'V'), false);   // 自然的短音階の7度はV(導音)に含まれない
});

test('chordVoicing は転回形の最低音を反映する', () => {
  assert.deepEqual(chordVoicing('I', 'major', 60, 48), [48, 52, 55]);
  // 第1転回形は3度が最低音になる
  const v = chordVoicing('I/3', 'major', 60, 48);
  assert.equal(v.length, 3);
  assert.equal(v[0] % 12, 4);
  assert.ok(v[0] >= 48 && v[0] < 60);
});

test('bassMidi は指定した最低音域に収まる', () => {
  const b = bassMidi('V/3', 'major', 60, 36);
  assert.ok(b >= 36 && b < 48, `範囲外: ${b}`);
});

test('CHORD_VOCAB の全記号が解釈できる', () => {
  for (const mode of ['major', 'minor']) {
    assert.ok(CHORD_VOCAB[mode].length >= 15);
    for (const sym of CHORD_VOCAB[mode]) {
      assert.doesNotThrow(() => chordPitchClasses(sym, mode), `解釈できない: ${sym}`);
    }
  }
});

const N = (deg, beat, dur, vel = 0.7) => ({ deg, beat, dur, vel });

test('splitBars は2小節に分け、beatを小節内ローカルに直す', () => {
  const [a, b] = splitBars([N(1, 0, 2), N(3, 2, 2), N(5, 4, 2), N(8, 6, 2)]);
  assert.deepEqual(a.map((n) => [n.deg, n.beat]), [[1, 0], [3, 2]]);
  assert.deepEqual(b.map((n) => [n.deg, n.beat]), [[5, 0], [8, 2]]);
});

test('fitsBar: 強拍がコードトーンなら適合', () => {
  assert.equal(fitsBar([N(1, 0, 2), N(5, 2, 2)], 'major', 'I'), true);
});

test('fitsBar: 強拍の非和声音が解決しなければ不適合', () => {
  assert.equal(fitsBar([N(4, 0, 2), N(6, 2, 2)], 'major', 'I'), false);
});

test('fitsBar: 強拍の非和声音でも順次下降で解決すれば適合', () => {
  assert.equal(fitsBar([N(4, 0, 1), N(3, 1, 1), N(1, 2, 2)], 'major', 'I'), true);
});

test('fitsBar: コードトーンが1つもなければ不適合', () => {
  assert.equal(fitsBar([N(2, 0, 0.5), N(4, 0.5, 0.5), N(6, 1, 0.5), N(2, 1.5, 0.5)], 'major', 'I'), false);
});

test('fitsBar: 空の小節は常に適合', () => {
  assert.equal(fitsBar([], 'major', 'V7'), true);
});

test('hasSuspension: 小節頭の非和声音が順次下降で解決すれば真', () => {
  // Iの上で4度→3度（4-3の掛留）
  assert.equal(hasSuspension([N(4, 0, 1.5), N(3, 1.5, 2.5)], 'major', 'I'), true);
});

test('hasSuspension: 小節頭がコードトーンなら偽', () => {
  assert.equal(hasSuspension([N(3, 0, 1.5), N(2, 1.5, 2.5)], 'major', 'I'), false);
});

test('hasSuspension: 上行で解決するものは掛留とみなさない', () => {
  assert.equal(hasSuspension([N(4, 0, 1.5), N(5, 1.5, 2.5)], 'major', 'I'), false);
});

test('nearestChordToneDeg は指定度数に最も近いコードトーンを返す', () => {
  assert.equal(nearestChordToneDeg('I', 'major', 4), 3);
  assert.equal(nearestChordToneDeg('I', 'major', 6), 5);
  assert.ok(isChordTone(nearestChordToneDeg('V7', 'major', 9), 'major', 'V7'));
});
