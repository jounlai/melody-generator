import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeSong } from '../src/compose.js';
import { composeVocalSongV6 } from '../src/vocalComposeV6.js';

const data = {
  melodies: JSON.parse(await readFile(new URL('../src/data/melodies.json', import.meta.url))),
  progressions: JSON.parse(await readFile(new URL('../src/data/progressions.json', import.meta.url))),
};
const settings = { songBars: '32', mood: 'wistful', tempoFeel: 'slow', instrument: 'piano', generatorVersion: '2' };

test('v6 writes a full vocal sentence and remembers it across A-A-prime-B-A', () => {
  for (const seed of ['memory', 'farewel', 'shade01', 'lament1', 'return1', 'b7gtcv']) {
    const song = composeVocalSongV6(seed, data, settings, composeSong);
    const quality = song.quality;
    assert.equal(quality.compositionOrder, 'melody-first');
    assert.equal(quality.themeNoteCount, 56);
    assert.deepEqual(quality.phraseNoteCounts, Array(8).fill(7));
    assert.ok(quality.recurrence >= 0.75, `${seed}: recurrence ${quality.recurrence}`);
    assert.ok(quality.stepRatio >= 0.48 && quality.stepRatio <= 0.76, `${seed}: steps ${quality.stepRatio}`);
    assert.ok(quality.leapRatio >= 0.05 && quality.leapRatio <= 0.18, `${seed}: leaps ${quality.leapRatio}`);
    assert.ok(quality.maxLeap <= 9, `${seed}: max leap ${quality.maxLeap}`);
    assert.ok(quality.returnDistance <= 1.2, `${seed}: return drift ${quality.returnDistance}`);
    assert.ok(quality.bridgeLift >= 1, `${seed}: bridge did not lift ${quality.bridgeLift}`);
    assert.equal(quality.uniquePeak, true, `${seed}: peak is not unique`);
    assert.ok(quality.rhythmVariety >= 5, `${seed}: rhythm variety ${quality.rhythmVariety}`);
    assert.ok(quality.harmonyFit >= 0.5, `${seed}: harmony fit ${quality.harmonyFit}`);
  }
});

test('v6 rebuilds harmony and arrangement after the melody', () => {
  const old = composeSong('shade01', data, settings);
  const song = composeVocalSongV6('shade01', data, settings, composeSong);
  assert.notDeepEqual(song.chords, old.chords);
  assert.notDeepEqual(song.accomp, old.accomp);
  assert.equal(song.chords.length, 32);
  assert.equal(song.sections.length, 4);
  assert.equal(song.melody.at(-1).midi % 12, song.tonicMidi % 12);
});
