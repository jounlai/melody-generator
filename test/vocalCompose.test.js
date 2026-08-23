import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeSong as composeClaudeSong } from '../src/compose.js';
import { composeVocalSong } from '../src/vocalCompose.js';

const melodies = JSON.parse(await readFile(new URL('../src/data/melodies.json', import.meta.url)));
const progressions = JSON.parse(await readFile(new URL('../src/data/progressions.json', import.meta.url)));
const data = { melodies, progressions };
const settings = {
  songBars: '32', mood: 'wistful', tempoFeel: 'slow', instrument: 'piano',
  generatorVersion: '2', composerEngine: 'codex',
};

test('Codex engine is deterministic and distinct from the retained engine', () => {
  const a = composeVocalSong('vocal1', data, settings, composeClaudeSong);
  const b = composeVocalSong('vocal1', data, settings, composeClaudeSong);
  const legacy = composeClaudeSong('vocal1', data, settings);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.melody, legacy.melody);
});

test('vocal line is predominantly repeated notes and steps', () => {
  const song = composeVocalSong('vocal2', data, settings, composeClaudeSong);
  let close = 0;
  for (let i = 1; i < song.melody.length; i += 1) {
    if (Math.abs(song.melody[i].midi - song.melody[i - 1].midi) <= 2) close += 1;
  }
  assert.ok(close / (song.melody.length - 1) >= 0.55);
});

test('phrases breathe and the final note resolves to tonic', () => {
  const song = composeVocalSong('vocal3', data, settings, composeClaudeSong);
  const last = song.melody.at(-1);
  assert.equal((last.midi - song.tonicMidi) % 12, 0);
  assert.ok(last.beat + last.dur >= song.totalBeats);
  for (let beat = 8; beat < song.totalBeats; beat += 8) {
    const crossing = song.melody.filter((n) => n.beat < beat && n.beat + n.dur > beat);
    assert.equal(crossing.length, 0, `phrase crosses beat ${beat}`);
  }
});
