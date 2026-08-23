import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeSong } from '../src/compose.js';
import { composeVocalSongV7 } from '../src/vocalComposeV7.js';

const data = {
  melodies: JSON.parse(await readFile(new URL('../src/data/melodies.json', import.meta.url))),
  progressions: JSON.parse(await readFile(new URL('../src/data/progressions.json', import.meta.url))),
};
const settings = { songBars: '32', mood: 'wistful', tempoFeel: 'slow', instrument: 'piano', generatorVersion: '2' };

test('v7 replaces complexity with seven-note thoughts and audible space', () => {
  for (const seed of ['memory', 'farewel', 'shade01', 'lament1', 'return1', 'b7gtcv']) {
    const song = composeVocalSongV7(seed, data, settings, composeSong);
    const quality = song.quality;
    assert.equal(quality.compositionOrder, 'melody-first-distilled');
    assert.equal(quality.noteCount, 112);
    assert.equal(quality.notesPerBar, 3.5);
    assert.deepEqual(quality.notesPerPhrase, Array(16).fill(7));
    assert.ok(quality.stepRatio >= 0.55, `${seed}: step motion ${quality.stepRatio}`);
    assert.ok(quality.leapRatio <= 0.19, `${seed}: too many leaps ${quality.leapRatio}`);
    assert.ok(quality.maxLeap <= 9, `${seed}: max leap ${quality.maxLeap}`);
    assert.ok(quality.silenceShare >= 0.4, `${seed}: not enough space ${quality.silenceShare}`);
    assert.ok(quality.longArrivals >= 10, `${seed}: only ${quality.longArrivals} long arrivals`);
    assert.equal(quality.uniquePeak, true, `${seed}: peak is not unique`);
  }
});

test('v7 keeps v6 harmony but makes the texture quieter', () => {
  const song = composeVocalSongV7('shade01', data, settings, composeSong);
  assert.equal(song.chords.length, 32);
  assert.ok(song.accomp.length < 32 * 5);
  assert.equal(song.pad.length, 32);
  assert.equal(song.melody.at(-1).midi % 12, song.tonicMidi % 12);
});
