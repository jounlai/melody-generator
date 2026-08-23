/** Codex vocal composer v7: distil the melody until silence becomes part of it. */
import { composeVocalSongV6 } from './vocalComposeV6.js';

const INDEXES = [0, 1, 2, 3, 4, 5, 6];
const PHRASE_END_START = [2.5, 3, 2, 2.5];

function combinations(values, length, start = 0, prefix = []) {
  if (prefix.length === length) return [prefix];
  let out = [];
  for (let index = start; index < values.length; index += 1) {
    out = out.concat(combinations(values, length, index + 1, [...prefix, values[index]]));
  }
  return out;
}

function distances(notes) {
  return notes.slice(1).map((note, index) => Math.abs(note.midi - notes[index].midi));
}

function choosePhraseNotes(evenBar, oddBar, phraseIndex) {
  let best = null;
  for (const even of combinations(INDEXES, 5)) {
    if (!even.includes(0) || !even.includes(6)) continue;
    // The fourth phrase carries the section's high point; retain its reaching note.
    if (phraseIndex === 3 && !even.includes(5)) continue;
    for (const odd of combinations(INDEXES, 2)) {
      if (!odd.includes(6)) continue;
      const line = [...even.map((index) => evenBar[index]), ...odd.map((index) => oddBar[index])];
      const motion = distances(line);
      const steps = motion.filter((distance) => distance <= 2).length;
      const leaps = motion.filter((distance) => distance >= 5).length;
      const targetLeaps = phraseIndex === 0 ? 1 : 0;
      let score = steps * 3 - Math.abs(leaps - targetLeaps) * 8;
      score -= Math.max(0, Math.max(...motion) - 9) * 10;
      if (odd[0] >= 3) score += 1; // a real breath before the two-note answer
      if (!best || score > best.score) best = { even, odd, score };
    }
  }
  return best;
}

function selectionPlan(melody) {
  const opening = melody.slice(0, 56);
  return Array.from({ length: 4 }, (_, phraseIndex) => choosePhraseNotes(
    opening.slice(phraseIndex * 14, phraseIndex * 14 + 7),
    opening.slice(phraseIndex * 14 + 7, phraseIndex * 14 + 14),
    phraseIndex,
  ));
}

function distilMelody(melody) {
  const plan = selectionPlan(melody);
  const out = [];
  for (let bar = 0; bar < 32; bar += 1) {
    const barNotes = melody.slice(bar * 7, bar * 7 + 7);
    const phraseIndex = Math.floor((bar % 8) / 2);
    const selected = bar % 2 === 0 ? plan[phraseIndex].even : plan[phraseIndex].odd;
    for (const index of selected) out.push({ ...barNotes[index] });

    if (bar % 2 === 1) {
      // Every two-bar thought ends in a held word, followed by audible space.
      const arrival = out.at(-1);
      const start = PHRASE_END_START[phraseIndex];
      arrival.beat = bar * 4 + start;
      arrival.dur = 4 - start;
      arrival.vel *= phraseIndex === 3 ? 0.82 : 0.9;
    }
  }
  return out;
}

function quietArrangement(song) {
  const accomp = [];
  const pad = [];
  const accompPatterns = [];
  for (let bar = 0; bar < 32; bar += 1) {
    const section = Math.floor(bar / 8);
    const localBar = bar % 8;
    const barBeat = bar * 4;
    const voices = song.pad[bar]?.midis?.slice() ?? [];
    if (!voices.length) continue;
    const low = voices[0];
    const upper = voices.slice(1);

    if (section === 0 || (section === 3 && localBar >= 6)) {
      accomp.push({ midi: low, midis: voices, beat: barBeat, dur: 4, vel: 0.18 });
      accompPatterns.push('sustain');
    } else if (section === 2) {
      for (let beat = 0; beat < 4; beat += 1) {
        accomp.push({ midi: voices[beat % voices.length], beat: barBeat + beat, dur: 1.15, vel: 0.23 });
      }
      accompPatterns.push('quarter-arp');
    } else {
      accomp.push({ midi: low, beat: barBeat, dur: 2, vel: 0.2 });
      if (upper.length) accomp.push({ midi: upper[0], midis: upper, beat: barBeat + 1, dur: 1, vel: 0.2 });
      accomp.push({ midi: low, beat: barBeat + 2, dur: 2, vel: 0.2 });
      if (upper.length) accomp.push({ midi: upper[0], midis: upper, beat: barBeat + 3, dur: 1, vel: 0.2 });
      accompPatterns.push('broken');
    }
    pad.push({ midis: voices, beat: barBeat, dur: 4, vel: section === 2 ? 0.14 : 0.11 });
  }
  return { accomp, pad, accompPatterns };
}

function critique(melody) {
  const motion = [];
  for (let index = 1; index < melody.length; index += 1) {
    if (Math.floor(melody[index].beat / 8) !== Math.floor(melody[index - 1].beat / 8)) continue;
    motion.push(Math.abs(melody[index].midi - melody[index - 1].midi));
  }
  const occupiedBeats = melody.reduce((sum, note) => sum + note.dur, 0);
  const pitches = melody.map((note) => note.midi);
  const top = Math.max(...pitches);
  return {
    noteCount: melody.length,
    notesPerBar: melody.length / 32,
    notesPerPhrase: Array(16).fill(7),
    stepRatio: motion.filter((distance) => distance <= 2).length / motion.length,
    leapRatio: motion.filter((distance) => distance >= 5).length / motion.length,
    maxLeap: Math.max(...motion),
    silenceShare: 1 - occupiedBeats / 128,
    longArrivals: melody.filter((note) => note.dur >= 1.5).length,
    uniquePeak: pitches.filter((pitch) => pitch === top).length === 1,
  };
}

export function composeVocalSongV7(seed, data, settings, foundationComposer) {
  const base = composeVocalSongV6(seed, data, settings, foundationComposer);
  const melody = distilMelody(base.melody);
  const quiet = quietArrangement(base);
  const quality = { ...base.quality, ...critique(melody), compositionOrder: 'melody-first-distilled' };
  const climax = melody.reduce((top, note) => (note.midi > top.midi ? note : top), melody[0]);
  return {
    ...base,
    melody,
    accomp: quiet.accomp,
    pad: quiet.pad,
    bass: base.bass.map((note) => ({ ...note, vel: note.vel * 0.88 })),
    arrangement: {
      ...base.arrangement,
      accompPatterns: quiet.accompPatterns,
    },
    composerEngine: 'codex7',
    climaxBeat: climax.beat,
    quality,
  };
}
