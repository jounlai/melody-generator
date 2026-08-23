import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeSong as composeClaudeSong } from '../src/compose.js';
import { composeVocalSongV2 } from '../src/vocalComposeV2.js';

const melodies = JSON.parse(await readFile(new URL('../src/data/melodies.json', import.meta.url)));
const progressions = JSON.parse(await readFile(new URL('../src/data/progressions.json', import.meta.url)));
const data = { melodies, progressions };
const settings = { songBars: '32', mood: 'wistful', tempoFeel: 'slow', instrument: 'piano', generatorVersion: '2' };

test('v2 generates many candidates deterministically and retains a scored winner', () => {
  const a = composeVocalSongV2('critic1', data, settings, composeClaudeSong);
  const b = composeVocalSongV2('critic1', data, settings, composeClaudeSong);
  assert.deepEqual(a, b);
  assert.equal(a.composerEngine, 'codex2');
  assert.ok(Number.isFinite(a.quality.score));
});

test('selected songs pass the structural musicality gate', () => {
  for (const seed of ['grief01', 'grief02', 'memory', 'farewel', 'yesterd', 'shade01', 'lament1', 'return1']) {
    const song = composeVocalSongV2(seed, data, settings, composeClaudeSong);
    const q = song.quality;
    assert.ok(q.score >= 70, `${seed}: score ${q.score}`);
    assert.ok(q.closeRatio >= 0.52 && q.closeRatio <= 0.84, `${seed}: close ${q.closeRatio}`);
    assert.ok(q.leapRatio <= 0.18, `${seed}: leaps ${q.leapRatio}`);
    assert.ok(q.maxLeap <= 9, `${seed}: max leap ${q.maxLeap}`);
    assert.ok(q.stableEnds >= 15, `${seed}: stable ends ${q.stableEnds}`);
    assert.ok(q.range >= 9 && q.range <= 17, `${seed}: range ${q.range}`);
    const highest = Math.max(...song.melody.map((n) => n.midi));
    assert.equal(song.melody.filter((n) => n.midi === highest).length, 1, `${seed}: peak repeated`);
    assert.equal((song.melody.at(-1).midi - song.tonicMidi) % 12, 0, `${seed}: unresolved ending`);
  }
});
