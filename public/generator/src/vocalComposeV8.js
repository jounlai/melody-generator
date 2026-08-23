/**
 * Codex vocal composer v8 — long-form song sentences.
 *
 * Earlier versions selected or reduced local note cells.  They could satisfy
 * interval statistics while still sounding like a chain of unrelated ideas.
 * V8 starts from a complete, curated eight-bar vocal sentence.  It develops
 * that sentence as A–A′–B–A″, with one peak and a literal return of the opening
 * gesture.  Seeded variation chooses between complete sentences; it never
 * shuffles individual notes.
 */
import { makeRng, seedFromString } from './rng.js';
import { chooseHarmony, arrange, harmonyFit } from './vocalComposeV6.js';
import { chordPitchClasses } from './theory.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// Four distinct two-bar breaths.  Their different attacks and internal gaps
// follow lyric-like stress rather than repeating one accompaniment rhythm.
const BREATHS = [
  { at: [0.5, 1.5, 2, 2.75, 3.5, 4.5, 5.5, 6.5], dur: [0.75, 0.42, 0.6, 0.6, 0.75, 0.75, 0.8, 1.25] },
  { at: [0.25, 1, 1.75, 2.5, 3.25, 4.5, 5.5, 6.75], dur: [0.62, 0.55, 0.62, 0.62, 0.75, 0.75, 0.82, 1] },
  { at: [0, 0.75, 1.5, 2.25, 3.25, 4.25, 5.25, 6.25], dur: [0.62, 0.62, 0.55, 0.78, 0.75, 0.75, 0.75, 1.5] },
  { at: [0.5, 1.25, 2, 2.75, 3.5, 4.5, 5.5, 6], dur: [0.55, 0.62, 0.55, 0.62, 0.75, 0.75, 0.42, 1.5] },
];

// Each family is an authored eight-bar sentence, not a bag of fragments.
// Degrees are diatonic and live around the upper tonic (8).  The shared grammar
// is: opening reach, mostly stepwise release, an unfinished middle, and a final
// half cadence.  The families differ in identity, not merely transposition.
const SENTENCES = [
  [
    [5, 8, 7, 6, 5, 4, 3, 2],
    [5, 8, 7, 6, 5, 4, 3, 3],
    [4, 5, 6, 7, 6, 5, 4, 3],
    [5, 6, 8, 9, 8, 7, 6, 5],
  ],
  [
    [6, 6, 9, 8, 7, 6, 5, 3],
    [6, 8, 7, 6, 5, 4, 5, 4],
    [4, 5, 6, 8, 7, 6, 5, 4],
    [6, 7, 9, 8, 7, 6, 6, 5],
  ],
  [
    [5, 7, 8, 7, 6, 5, 4, 3],
    [5, 8, 8, 7, 6, 5, 3, 4],
    [4, 6, 7, 6, 5, 7, 5, 4],
    [5, 7, 8, 10, 9, 8, 6, 5],
  ],
  [
    [5, 8, 8, 7, 6, 5, 4, 3],
    [5, 7, 6, 8, 7, 6, 4, 4],
    [4, 5, 7, 6, 5, 6, 5, 3],
    [6, 8, 9, 8, 7, 8, 5, 5],
  ],
];

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const pc = (midi) => ((Math.round(midi) % 12) + 12) % 12;

function degreeToMidi(tonic, mode, degree) {
  const scale = mode === 'major' ? MAJOR : MINOR;
  const zero = degree - 1;
  const octave = Math.floor(zero / 7);
  const index = ((zero % 7) + 7) % 7;
  return tonic + octave * 12 + scale[index];
}

function makePhrase(degrees, phraseIndex, section, song, options = {}) {
  const breath = BREATHS[phraseIndex];
  const sourceBar = phraseIndex * 2;
  const sectionBeat = section * 32;
  return degrees.map((degree, sourceIndex) => {
    const rawDegree = options.degreeMap
      ? options.degreeMap(degree, sourceIndex)
      : degree;
    return {
      degree: clamp(rawDegree, 3, 13),
      midi: degreeToMidi(song.tonicMidi, song.mode, clamp(rawDegree, 3, 13)),
      beat: sectionBeat + phraseIndex * 8 + breath.at[sourceIndex],
      dur: breath.dur[sourceIndex],
      vel: options.velocity ?? (section === 2 ? 0.72 : 0.64),
      sourceBar: sourceBar + Math.floor(breath.at[sourceIndex] / 4),
      sourceIndex,
      phraseIndex,
      section,
    };
  });
}

function openingSection(sentence, song) {
  return sentence.flatMap((degrees, phraseIndex) => makePhrase(degrees, phraseIndex, 0, song));
}

function variedSection(sentence, song) {
  return sentence.flatMap((degrees, phraseIndex) => makePhrase(degrees, phraseIndex, 1, song, {
    degreeMap: (degree, index) => {
      // The listener gets the same sentence, with only two meaningful changed
      // words.  The opening remains literal so recognition is immediate.
      if (phraseIndex === 1 && index >= 6) return degree + (index === 7 ? 1 : 0);
      if (phraseIndex === 2 && index === 3) return degree + 1;
      if (phraseIndex === 3 && index === 3) return degree + 1;
      return degree;
    },
    velocity: 0.67,
  }));
}

function bridgeSection(sentence, song) {
  const first = sentence[0];
  const second = sentence[1];
  const bridge = [
    // The bridge remembers the opening reach but begins one degree higher.
    first.map((degree, index) => Math.min(11, degree + (index < 3 ? 1 : 0))),
    second.map((degree, index) => Math.min(11, degree + (index < 6 ? 2 : 1))),
    sentence[2].map((degree, index) => Math.min(11, degree + (index >= 2 && index <= 5 ? 2 : 1))),
    sentence[3].map((degree, index) => {
      if (index === 5) return 12; // the sole high, held emotional word
      if (index < 5) return Math.min(11, degree + 2);
      return [11, 10][index - 6];
    }),
  ];
  const notes = bridge.flatMap((degrees, phraseIndex) => makePhrase(degrees, phraseIndex, 2, song, {
    velocity: 0.72,
  }));
  const peak = notes.find((note) => note.phraseIndex === 3 && note.sourceIndex === 5);
  peak.dur = Math.max(peak.dur, 1.35);
  peak.vel = 0.86;
  return notes;
}

function returningSection(sentence, song) {
  const finalPhrase = sentence[0].map((degree) => Math.min(11, degree + 2));
  // Repeat the opening gesture, but this time let it reach the tonic.  This is
  // the narrative answer to the unresolved degree-2 ending heard at the start.
  finalPhrase.splice(5, 3, 10, 9, 8);

  return sentence.flatMap((degrees, phraseIndex) => {
    const source = phraseIndex === 3 ? finalPhrase : degrees;
    const notes = makePhrase(source, phraseIndex, 3, song, {
      velocity: phraseIndex === 3 ? 0.52 : 0.59,
    });
    if (phraseIndex === 3) {
      const ending = notes.at(-1);
      ending.beat = 126;
      ending.dur = 2;
      ending.vel = 0.4;
    }
    return notes;
  });
}

function intervalSignature(notes) {
  return notes.slice(1).map((note, index) => note.midi - notes[index].midi);
}

function contourSimilarity(a, b) {
  const aa = intervalSignature(a);
  const bb = intervalSignature(b);
  let same = 0;
  for (let index = 0; index < Math.min(aa.length, bb.length); index += 1) {
    if (Math.abs(aa[index] - bb[index]) <= 1) same += 1;
  }
  return same / Math.max(1, Math.min(aa.length, bb.length));
}

function phraseNotes(melody, section, phraseIndex) {
  return melody.filter((note) => note.section === section && note.phraseIndex === phraseIndex);
}

function critique(song, melody, chords) {
  const motions = [];
  for (let index = 1; index < melody.length; index += 1) {
    if (melody[index].phraseIndex !== melody[index - 1].phraseIndex
      || melody[index].section !== melody[index - 1].section) continue;
    motions.push(Math.abs(melody[index].midi - melody[index - 1].midi));
  }
  const pitches = melody.map((note) => note.midi);
  const peak = Math.max(...pitches);
  const phraseCounts = Array.from({ length: 16 }, (_, index) => phraseNotes(
    melody, Math.floor(index / 4), index % 4,
  ).length);
  const breathSpace = Array.from({ length: 16 }, (_, index) => {
    const section = Math.floor(index / 4);
    const phraseIndex = index % 4;
    const line = phraseNotes(melody, section, phraseIndex);
    const phraseEnd = section * 32 + phraseIndex * 8 + 8;
    return phraseEnd - (line.at(-1).beat + line.at(-1).dur);
  });
  const returnRecall = [0, 1, 2].reduce((sum, phraseIndex) => sum + contourSimilarity(
    phraseNotes(melody, 0, phraseIndex), phraseNotes(melody, 3, phraseIndex),
  ), 0) / 3;
  const aPrimeRecall = [0, 1, 2, 3].reduce((sum, phraseIndex) => sum + contourSimilarity(
    phraseNotes(melody, 0, phraseIndex), phraseNotes(melody, 1, phraseIndex),
  ), 0) / 4;
  const peakNote = melody.find((note) => note.midi === peak);
  const finalTonic = pc(melody.at(-1).midi) === pc(song.tonicMidi);
  const finalRecall = contourSimilarity(
    phraseNotes(melody, 0, 0).slice(0, 5),
    phraseNotes(melody, 3, 3).slice(0, 5),
  );
  const occupied = melody.reduce((sum, note) => sum + note.dur, 0);
  return {
    compositionOrder: 'complete-song-sentence-first',
    noteCount: melody.length,
    notesPerBar: melody.length / 32,
    phraseNoteCounts: phraseCounts,
    stepRatio: motions.filter((distance) => distance <= 2).length / motions.length,
    leapRatio: motions.filter((distance) => distance >= 5).length / motions.length,
    maxLeap: Math.max(...motions),
    range: peak - Math.min(...pitches),
    uniquePeak: pitches.filter((pitch) => pitch === peak).length === 1,
    peakSection: peakNote.section,
    peakPhrase: peakNote.phraseIndex,
    aPrimeRecall,
    returnRecall,
    finalRecall,
    finalTonic,
    silenceShare: 1 - occupied / 128,
    // The final phrase intentionally fills the last bar; all earlier phrases
    // must leave room to inhale.
    minBreathSpace: Math.min(...breathSpace.slice(0, -1)),
    harmonyFit: harmonyFit(song, melody, chords),
  };
}

function softenArrangement(arranged) {
  return {
    ...arranged,
    accomp: arranged.accomp.map((note) => ({ ...note, vel: note.vel * 0.78 })),
    bass: arranged.bass.map((note) => ({ ...note, vel: note.vel * 0.84 })),
    pad: arranged.pad.map((note) => ({ ...note, vel: note.vel * 0.66 })),
  };
}

const COLOUR_POOLS = {
  major: [
    ['I', 'IM7', 'Iadd9', 'vi'],
    ['iii7', 'V/3', 'I/3', 'vi/3'],
    ['III7', 'vi', 'IV', 'I7'],
    ['vi', 'V', 'iii', 'iv'],
    ['IV', 'IVM7', 'IVadd9', 'ii7', 'I'],
    ['I/3', 'vi', 'iv', 'VI7'],
    ['ii7', 'ii9', 'IV', 'iv', 'V'],
  ],
  minor: [
    ['i', 'i7', 'iadd9', 'III'],
    ['i/7', 'VII', 'i/3', 'III/3'],
    ['VI', 'III', 'iv', 'VII'],
    ['III', 'V', 'VII', 'iv'],
    ['iv', 'iv9', 'VI', 'i', 'III'],
    ['i/3', 'VI', 'iv', 'VII'],
    ['VI', 'iv', 'V', 'V7', 'V9'],
  ],
};

function chordFitScore(symbol, barNotes, song, keepOriginal) {
  const tones = chordPitchClasses(symbol, song.mode)
    .map((value) => pc(value + song.tonicMidi));
  let score = keepOriginal ? 0.35 : 0;
  for (const note of barNotes) {
    const local = note.beat % 4;
    const weight = note.dur >= 1 ? 3 : (Number.isInteger(local) ? 2 : 0.55);
    score += tones.includes(pc(note.midi)) ? weight : -weight * 0.5;
  }
  return score;
}

function polishHarmony(symbols, melody, song) {
  const pools = COLOUR_POOLS[song.mode] ?? COLOUR_POOLS.major;
  return symbols.map((original, bar) => {
    const localBar = bar % 8;
    const finalBar = bar === 31;
    const cadence = finalBar
      ? [song.mode === 'major' ? 'I' : 'i']
      : (localBar === 7 ? ['V7', 'V9'] : pools[localBar]);
    const barNotes = melody.filter((note) => Math.floor(note.beat / 4) === bar);
    return [...new Set([original, ...cadence])]
      .map((symbol) => ({
        symbol,
        score: chordFitScore(symbol, barNotes, song, symbol === original),
      }))
      .sort((a, b) => b.score - a.score)[0].symbol;
  });
}

export function composeVocalSongV8(seed, data, settings, foundationComposer) {
  const shell = foundationComposer(seed, data, { ...settings, generatorVersion: '2', songBars: '32' });
  const rng = makeRng(seedFromString(`${seed}:codex-vocal-8`));
  const sentence = SENTENCES[Math.floor(rng() * SENTENCES.length)];
  const authored = [
    ...openingSection(sentence, shell),
    ...variedSection(sentence, shell),
    ...bridgeSection(sentence, shell),
    ...returningSection(sentence, shell),
  ];
  const symbols = polishHarmony(chooseHarmony(shell, authored), authored, shell);
  const arranged = softenArrangement(arrange(shell, symbols, authored));
  const quality = critique(shell, authored, arranged.chords);
  const climax = authored.reduce((top, note) => (note.midi > top.midi ? note : top), authored[0]);
  const melody = authored.map(({
    degree, sourceBar, sourceIndex, phraseIndex, section, ...note
  }) => note);

  return {
    ...shell,
    bars: 32,
    totalBeats: 128,
    modulation: null,
    sections: [
      { name: 'A', startBar: 0, progressionId: 'v8-song-sentence' },
      { name: "A'", startBar: 8, progressionId: 'v8-song-sentence-var' },
      { name: 'B', startBar: 16, progressionId: 'v8-development' },
      { name: "A''", startBar: 24, progressionId: 'v8-return' },
    ],
    chords: arranged.chords,
    melody,
    accomp: arranged.accomp,
    bass: arranged.bass,
    pad: arranged.pad,
    arrangement: {
      accompPatterns: arranged.accompPatterns,
      bassPatterns: arranged.bassPatterns,
      anticipated: false,
    },
    composerEngine: 'codex8',
    climaxBeat: climax.beat,
    breathBar: 7,
    quality,
  };
}
