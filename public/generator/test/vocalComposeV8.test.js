import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeSong } from '../src/compose.js';
import { composeVocalSongV8 } from '../src/vocalComposeV8.js';

const data = {
  melodies: JSON.parse(await readFile(new URL('../src/data/melodies.json', import.meta.url))),
  progressions: JSON.parse(await readFile(new URL('../src/data/progressions.json', import.meta.url))),
};
const settings = { songBars: '32', mood: 'wistful', tempoFeel: 'slow', instrument: 'piano', generatorVersion: '2' };

function seed(index) {
  return index.toString(36).padStart(6, '0');
}

test('v8 keeps a complete vocal sentence coherent across 512 generated songs', () => {
  for (let index = 0; index < 512; index += 1) {
    const song = composeVocalSongV8(seed(index), data, settings, composeSong);
    const q = song.quality;
    assert.equal(q.compositionOrder, 'complete-song-sentence-first');
    assert.equal(q.noteCount, 128, `${seed(index)}: ${q.noteCount} notes`);
    assert.equal(q.notesPerBar, 4, `${seed(index)}: density ${q.notesPerBar}`);
    assert.ok(q.phraseNoteCounts.every((count) => count === 8), `${seed(index)}: phrase counts`);
    assert.ok(q.stepRatio >= 0.66, `${seed(index)}: step ratio ${q.stepRatio}`);
    assert.ok(q.leapRatio <= 0.16, `${seed(index)}: leap ratio ${q.leapRatio}`);
    assert.ok(q.maxLeap <= 8, `${seed(index)}: max leap ${q.maxLeap}`);
    assert.ok(q.range >= 12 && q.range <= 17, `${seed(index)}: range ${q.range}`);
    assert.equal(q.uniquePeak, true, `${seed(index)}: repeated peak`);
    assert.equal(q.peakSection, 2, `${seed(index)}: peak is not in B`);
    assert.equal(q.peakPhrase, 3, `${seed(index)}: peak is not in the last B phrase`);
    assert.ok(q.aPrimeRecall >= 0.8, `${seed(index)}: A' recall ${q.aPrimeRecall}`);
    assert.ok(q.returnRecall >= 0.95, `${seed(index)}: return recall ${q.returnRecall}`);
    assert.ok(q.finalRecall >= 0.75, `${seed(index)}: final recall ${q.finalRecall}`);
    assert.equal(q.finalTonic, true, `${seed(index)}: no final tonic`);
    assert.ok(q.silenceShare >= 0.2, `${seed(index)}: silence ${q.silenceShare}`);
    assert.ok(q.minBreathSpace >= 0.25, `${seed(index)}: breath ${q.minBreathSpace}`);
    assert.ok(q.harmonyFit >= 0.59, `${seed(index)}: harmony fit ${q.harmonyFit}`);
  }
});

test('v8 is deterministic and seed variation selects complete sentences', () => {
  const signatures = new Set();
  for (let index = 0; index < 40; index += 1) {
    const first = composeVocalSongV8(seed(index), data, settings, composeSong);
    const again = composeVocalSongV8(seed(index), data, settings, composeSong);
    assert.deepEqual(first.melody, again.melody);
    signatures.add(first.melody.slice(0, 18).map((note) => note.midi - first.tonicMidi).join(','));
  }
  assert.ok(signatures.size >= 4, `only ${signatures.size} sentence families appeared`);
});
