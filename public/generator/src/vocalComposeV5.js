/** Codex vocal composer v5: coherent song form with controlled emotional tension. */
import { composeVocalSongV4 } from './vocalComposeV4.js';

const pc = (midi) => ((Math.round(midi) % 12) + 12) % 12;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

function phrase(melody, index) {
  return melody.slice(index * 6, index * 6 + 6);
}

function chordAt(song, beat) {
  return song.chords[Math.min(song.chords.length - 1, Math.floor(beat / 4))];
}

function tensionAbove(target, chord, hi) {
  for (let distance = 1; distance <= 3; distance += 1) {
    const candidate = target + distance;
    if (candidate <= hi && !chord?.pcs?.includes(pc(candidate))) return candidate;
  }
  return Math.min(hi, target + 1);
}

function chordToneNear(target, chord, lo, hi, avoidPc = null) {
  if (!chord?.pcs?.length) return clamp(target, lo, hi);
  let best = null;
  for (let midi = lo; midi <= hi; midi += 1) {
    if (!chord.pcs.includes(pc(midi)) || pc(midi) === avoidPc) continue;
    if (best === null || Math.abs(midi - target) < Math.abs(best - target)) best = midi;
  }
  return best ?? clamp(target, lo, hi);
}

function addSigh(song, melody, phraseIndex, hi) {
  const line = phrase(melody, phraseIndex);
  const resolution = line[1];
  line[0].midi = tensionAbove(resolution.midi, chordAt(song, line[0].beat), hi);
  line[0].dur = Math.max(line[0].dur, line[1].beat - line[0].beat);
  line[0].vel += 0.025;
  line[1].vel -= 0.035;
}

function leaveCadencesOpen(song, melody, tonicPc, lo, hi) {
  for (let phraseIndex = 0; phraseIndex < 15; phraseIndex += 1) {
    const ending = phrase(melody, phraseIndex).at(-1);
    if (pc(ending.midi) !== tonicPc) continue;
    ending.midi = chordToneNear(ending.midi, chordAt(song, ending.beat), lo, hi, tonicPc);
  }
}

function shapeClimax(song, melody, lo, hi) {
  const line = phrase(melody, 11);
  const currentTop = Math.max(...melody.map((note) => note.midi));
  const peak = Math.min(hi, Math.max(line[4].midi, currentTop));

  // One—and only one—large vocal reach. It lands on a long tone, then releases.
  line[3].midi = peak - 7;
  line[3].dur = Math.min(line[3].dur, line[4].beat - line[3].beat);
  line[3].vel = 0.74;
  line[4].midi = peak;
  line[4].dur = Math.max(line[4].dur, 2);
  line[4].vel = 0.88;
  line[5].midi = chordToneNear(peak - 2, chordAt(song, line[5].beat), lo, peak - 1);
  line[5].vel = 0.68;

  // Keep the crest unique without rewriting the surrounding melodic argument.
  for (const note of melody) {
    if (note !== line[4] && note.midi >= peak) note.midi = peak - 1;
  }
}

function finalRelease(song, melody) {
  const line = phrase(melody, 15);
  line[3].vel = 0.53;
  line[4].vel = 0.47;
  line[5].midi = song.tonicMidi + 12;
  line[5].vel = 0.4;
  line[5].dur = Math.max(line[5].dur, song.totalBeats - line[5].beat);
}

function emotionalCritique(song, melody, baseQuality) {
  const tonicPc = pc(song.tonicMidi);
  const sighPhrases = [1, 5, 9, 13];
  const sighCount = sighPhrases.filter((index) => {
    const line = phrase(melody, index);
    const distance = line[0].midi - line[1].midi;
    return distance >= 1 && distance <= 3 && !chordAt(song, line[0].beat)?.pcs?.includes(pc(line[0].midi));
  }).length;
  const openCadences = Array.from({ length: 15 }, (_, index) => phrase(melody, index).at(-1))
    .filter((note) => pc(note.midi) !== tonicPc).length;
  const climax = phrase(melody, 11);
  const climaxLeap = climax[4].midi - climax[3].midi;
  const top = Math.max(...melody.map((note) => note.midi));
  const uniquePeak = melody.filter((note) => note.midi === top).length === 1;
  const finalTonic = pc(melody.at(-1).midi) === tonicPc;
  const longToneCount = melody.filter((note) => note.dur >= 1.5).length;
  const score = baseQuality.score + sighCount * 3 + openCadences * 0.35
    + (climaxLeap >= 5 && climaxLeap <= 8 ? 10 : -10)
    + (uniquePeak ? 6 : -6) + (finalTonic ? 4 : -8) + Math.min(8, longToneCount * 0.25);
  return {
    ...baseQuality,
    score,
    sighCount,
    openCadences,
    climaxLeap,
    uniquePeak,
    finalTonic,
    longToneCount,
  };
}

export function composeVocalSongV5(seed, data, settings, foundationComposer) {
  const base = composeVocalSongV4(seed, data, settings, foundationComposer);
  const melody = base.melody.map((note) => ({ ...note }));
  const lo = base.tonicMidi + 7;
  const hi = base.tonicMidi + 23;
  const tonicPc = pc(base.tonicMidi);

  for (const phraseIndex of [1, 5, 9, 13]) addSigh(base, melody, phraseIndex, hi);
  leaveCadencesOpen(base, melody, tonicPc, lo, hi);
  shapeClimax(base, melody, lo, hi);
  finalRelease(base, melody);

  const quality = emotionalCritique(base, melody, base.quality);
  return {
    ...base,
    melody,
    composerEngine: 'codex5',
    quality,
    climaxBeat: phrase(melody, 11)[4].beat,
  };
}
