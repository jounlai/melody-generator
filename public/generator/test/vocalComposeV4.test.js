import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeSong } from '../src/compose.js';
import { composeVocalSongV4 } from '../src/vocalComposeV4.js';

const data = {
  melodies: JSON.parse(await readFile(new URL('../src/data/melodies.json', import.meta.url))),
  progressions: JSON.parse(await readFile(new URL('../src/data/progressions.json', import.meta.url))),
};
const settings = { songBars: '32', mood: 'wistful', tempoFeel: 'slow', instrument: 'piano', generatorVersion: '2' };

test('v4 returns to its opening idea instead of drifting late in the song', () => {
  for (const seed of ['memory', 'farewel', 'shade01', 'lament1', 'return1', 'b7gtcv']) {
    const song = composeVocalSongV4(seed, data, settings, composeSong);
    const quality = song.quality;
    assert.ok(quality.recurrence >= 0.75, `${seed}: recurrence ${quality.recurrence}`);
    assert.ok(quality.lateRecurrence >= 0.58, `${seed}: late recurrence ${quality.lateRecurrence}`);
    assert.equal(quality.divergentLatePhrases, 0, `${seed}: late phrases lost the theme`);
    assert.ok(quality.uniqueRhythms >= 5, `${seed}: only ${quality.uniqueRhythms} rhythms`);
    assert.ok(quality.dominantRhythmRatio <= 0.38, `${seed}: dominant rhythm ${quality.dominantRhythmRatio}`);
    assert.ok(quality.maxLeap <= 7, `${seed}: max leap ${quality.maxLeap}`);
    assert.ok(quality.boundaries <= 1, `${seed}: ${quality.boundaries} bad phrase boundaries`);
    assert.ok(quality.score >= 70, `${seed}: score ${quality.score}`);
  }
});

test('v4 preserves the accepted harmonic foundation', () => {
  const foundation = composeSong('shade01', data, settings);
  const song = composeVocalSongV4('shade01', data, settings, composeSong);
  assert.deepEqual(song.chords, foundation.chords);
  assert.deepEqual(song.accomp, foundation.accomp);
  assert.deepEqual(song.bass, foundation.bass);
});
