import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeSong } from '../src/compose.js';
import { composeVocalSongV9 } from '../src/vocalComposeV9.js';

const data = {
  melodies: JSON.parse(await readFile(new URL('../src/data/melodies.json', import.meta.url))),
  progressions: JSON.parse(await readFile(new URL('../src/data/progressions.json', import.meta.url))),
};
const settings = { songBars: '32', mood: 'wistful', tempoFeel: 'slow', instrument: 'piano', generatorVersion: '2' };

const seed = (index) => index.toString(36).padStart(6, '0');

test('v9 is a concise major-key vocal song, not an open-ended note stream', () => {
  for (let index = 0; index < 256; index += 1) {
    const song = composeVocalSongV9(seed(index), data, settings, composeSong);
    const q = song.quality;
    assert.equal(song.mode, 'major');
    assert.equal(song.bars, 24);
    assert.equal(song.totalBeats, 96);
    assert.equal(song.chords.length, 24);
    assert.equal(q.compositionOrder, 'vocal-phrase-and-harmony-together');
    assert.ok(q.noteCount >= 140 && q.noteCount <= 150, `${seed(index)}: ${q.noteCount}`);
    assert.ok(q.notesPerBar >= 5.8 && q.notesPerBar <= 6.3, `${seed(index)}: ${q.notesPerBar}`);
    assert.ok(q.range >= 14 && q.range <= 17, `${seed(index)}: range ${q.range}`);
    assert.ok(q.stepRatio >= 0.57, `${seed(index)}: steps ${q.stepRatio}`);
    assert.ok(q.leapRatio >= 0.03 && q.leapRatio <= 0.14, `${seed(index)}: leaps ${q.leapRatio}`);
    assert.ok(q.maxLeap <= 9, `${seed(index)}: max leap ${q.maxLeap}`);
    assert.equal(q.uniquePeak, true, `${seed(index)}: peak repeated`);
    assert.equal(q.peakBar, 14, `${seed(index)}: peak bar ${q.peakBar}`);
    assert.equal(q.literalReturnBars, 5, `${seed(index)}: return ${q.literalReturnBars}`);
    assert.equal(q.finalTonic, true, `${seed(index)}: no tonic ending`);
    assert.ok(q.harmonyFit >= 0.58, `${seed(index)}: harmony fit ${q.harmonyFit}`);
  }
});

test('v9 varies only between complete authored verses and remains deterministic', () => {
  const openings = new Set();
  for (let index = 0; index < 48; index += 1) {
    const first = composeVocalSongV9(seed(index), data, settings, composeSong);
    const again = composeVocalSongV9(seed(index), data, settings, composeSong);
    assert.deepEqual(first.melody, again.melody);
    openings.add(first.melody.slice(0, 28).map((note) => note.midi - first.tonicMidi).join(','));
  }
  assert.equal(openings.size, 3);
});
