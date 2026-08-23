import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeSong } from '../src/compose.js';
import { composeVocalSongV3 } from '../src/vocalComposeV3.js';

const data = {
  melodies: JSON.parse(await readFile(new URL('../src/data/melodies.json', import.meta.url))),
  progressions: JSON.parse(await readFile(new URL('../src/data/progressions.json', import.meta.url))),
};
const settings = { songBars: '32', mood: 'wistful', tempoFeel: 'slow', instrument: 'piano', generatorVersion: '2' };

test('v3 has audible motif recurrence and rhythmic form', () => {
  for (const seed of ['memory', 'farewel', 'shade01', 'lament1', 'return1']) {
    const song = composeVocalSongV3(seed, data, settings, composeSong);
    const q = song.quality;
    assert.ok(q.recurrence >= 0.78, `${seed}: recurrence ${q.recurrence}`);
    assert.ok(q.uniqueRhythms >= 5, `${seed}: only ${q.uniqueRhythms} rhythms`);
    assert.ok(q.dominantRhythmRatio <= 0.38, `${seed}: dominant rhythm ${q.dominantRhythmRatio}`);
    assert.ok(q.maxLeap <= 9, `${seed}: max leap ${q.maxLeap}`);
    assert.ok(q.boundaries <= 1, `${seed}: ${q.boundaries} bad phrase boundaries`);
    assert.ok(q.score >= 70, `${seed}: score ${q.score}`);
  }
});
