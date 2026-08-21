#!/usr/bin/env node
// 「別れ」の曲を1つ作り、MIDI と MusicXML と、単体で開ける HTML を書き出す。
//
//   node tools/makeElegy.js
//
// 生成は決定論的で、検査を通った最初の種を使う。
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose, inspect } from '../src/elegySong.js';
import { toMidi, toMusicXML } from '../src/export.js';
import { defaultSettings } from '../src/settings.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../out');

const { song, issues, seed, tries } = compose(1, 400);
console.log(`試行 ${tries} 回 / 採用した種 ${seed}`);
if (issues.length) {
  console.log('検査で残った違反:');
  for (const x of issues) console.log(`  - ${x}`);
} else {
  console.log('検査: すべて通過');
}

const settings = { ...defaultSettings(), instrument: 'piano' };
try {
  const midi = toMidi(song, settings);
  writeFileSync(resolve(OUT, 'elegy.mid'), Buffer.from(midi));
  console.log('out/elegy.mid');
} catch (e) {
  console.log('MIDI 書き出し失敗:', e.message);
}
try {
  const xml = String(toMusicXML(song, settings));
  writeFileSync(resolve(OUT, 'elegy.musicxml'), xml, 'utf8');
  console.log('out/elegy.musicxml');
} catch (e) {
  console.log('MusicXML 書き出し失敗:', e.message);
}
