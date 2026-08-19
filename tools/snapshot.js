#!/usr/bin/env node
// 旋律の midi 列のスナップショットを作る。版1（＝共有済みの曲コードが指す版）で。
//
// 編曲層(arrange.js)は「いつ鳴らすか」だけを変え、「どの音を鳴らすか」には
// 触らない。その保証を機械で守るための基準線がこのファイル。
// 一度作ったら書き換えない。書き換えたくなったときは、旋律が変わっている。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeSong } from '../src/compose.js';
import { defaultSettings } from '../src/settings.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../test/data/melody-snapshot.json');

export const SNAPSHOT_SEEDS = Array.from({ length: 20 }, (_, i) => `snap-${i}`);
export const SNAPSHOT_BARS = ['16', '32', '64'];

export function loadData() {
  const dir = resolve(HERE, '../src/data');
  return {
    melodies: JSON.parse(readFileSync(resolve(dir, 'melodies.json'), 'utf8')),
    progressions: JSON.parse(readFileSync(resolve(dir, 'progressions.json'), 'utf8')),
  };
}

/** 1曲の旋律を「拍の早い順に並べた midi の列」にする。拍と音価はわざと見ない。 */
export function melodyKey(song) {
  return song.melody
    .slice()
    .sort((a, b) => a.beat - b.beat || a.midi - b.midi)
    .map((n) => n.midi)
    .join(',');
}

export function buildSnapshot(data) {
  const out = {};
  for (const seed of SNAPSHOT_SEEDS) {
    for (const songBars of SNAPSHOT_BARS) {
      // 版1で作る。このスナップショットが守るのは「共有済みの曲コードから
      // 出る曲が変わらないこと」で、桁の無い曲コードは版1として解かれるため。
      const song = composeSong(seed, data, { ...defaultSettings(), songBars, generatorVersion: '1' });
      out[`${seed}|${songBars}`] = melodyKey(song);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snapshot = buildSnapshot(loadData());
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 0)}\n`);
  console.log(`${Object.keys(snapshot).length} 曲を ${OUT} へ書き出した`);
}
