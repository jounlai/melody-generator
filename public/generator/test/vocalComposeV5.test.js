import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeSong } from '../src/compose.js';
import { composeVocalSongV5 } from '../src/vocalComposeV5.js';

const data = {
  melodies: JSON.parse(await readFile(new URL('../src/data/melodies.json', import.meta.url))),
  progressions: JSON.parse(await readFile(new URL('../src/data/progressions.json', import.meta.url))),
};
const settings = { songBars: '32', mood: 'wistful', tempoFeel: 'slow', instrument: 'piano', generatorVersion: '2' };

test('v5 has controlled longing, one vocal climax and a final release', () => {
  for (const seed of ['memory', 'farewel', 'shade01', 'lament1', 'return1', 'b7gtcv']) {
    const song = composeVocalSongV5(seed, data, settings, composeSong);
    const quality = song.quality;
    assert.equal(quality.sighCount, 4, `${seed}: only ${quality.sighCount} sigh resolutions`);
    assert.ok(quality.openCadences >= 12, `${seed}: resolves too readily (${quality.openCadences})`);
    assert.equal(quality.climaxLeap, 7, `${seed}: climax leap ${quality.climaxLeap}`);
    assert.equal(quality.uniquePeak, true, `${seed}: climax is not unique`);
    assert.equal(quality.finalTonic, true, `${seed}: final note does not come home`);
    assert.ok(quality.longToneCount >= 18, `${seed}: not enough held vocal tones`);
    assert.ok(quality.lateRecurrence >= 0.58, `${seed}: lost v4 coherence`);
  }
});

test('v5 changes only the vocal line, preserving the accepted foundation', () => {
  const foundation = composeSong('shade01', data, settings);
  const song = composeVocalSongV5('shade01', data, settings, composeSong);
  assert.deepEqual(song.chords, foundation.chords);
  assert.deepEqual(song.accomp, foundation.accomp);
  assert.deepEqual(song.bass, foundation.bass);
});
