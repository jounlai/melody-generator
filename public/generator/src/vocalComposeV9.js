/**
 * Codex vocal composer v9 — lyric phrases written together with their harmony.
 *
 * V8 proved that formal recurrence alone is not emotion.  V9 is deliberately
 * shorter and less generative: it chooses one of three fully written vocal
 * verses, develops it once, then returns.  Notes are never shuffled.  Harmony
 * is fixed as a 24-bar dramatic path, so a locally convenient chord cannot
 * derail the song's emotional direction.
 */
import { makeRng, seedFromString } from './rng.js';
import { arrange, harmonyFit } from './vocalComposeV6.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

const RHYTHMS = [
  { at: [0.5, 1, 1.5, 2, 2.75, 3.25, 3.5], dur: [0.35, 0.35, 0.35, 0.6, 0.25, 0.2, 0.5] },
  { at: [0.25, 0.5, 1, 1.5, 2.25, 2.75, 3.25], dur: [0.18, 0.35, 0.35, 0.55, 0.3, 0.35, 0.75] },
  { at: [0.5, 1.25, 1.75, 2.5, 3, 3.5], dur: [0.55, 0.35, 0.55, 0.35, 0.3, 0.5] },
  { at: [0.75, 1.5, 2.25, 3, 3.5], dur: [0.55, 0.55, 0.55, 0.3, 0.5] },
  { at: [0, 0.5, 1, 1.75, 2.25, 2.75, 3.25], dur: [0.35, 0.35, 0.6, 0.3, 0.3, 0.35, 0.75] },
  { at: [0.25, 1, 1.5, 2, 3, 3.5], dur: [0.55, 0.35, 0.35, 0.75, 0.3, 0.5] },
  { at: [0.5, 1, 1.25, 2, 2.5, 3, 3.5], dur: [0.35, 0.18, 0.55, 0.35, 0.35, 0.3, 0.5] },
  { at: [0.5, 1.5, 2.5, 3.25], dur: [0.75, 0.75, 0.55, 0.75] },
];

const FINAL_RHYTHM = {
  at: [0.5, 1, 1.5, 2, 2.5, 2.75],
  dur: [0.35, 0.35, 0.35, 0.35, 0.2, 1.25],
};

// The arrays contain scale degrees around the upper tonic (8).  A string such
// as "13b" is a chromatic inflection: the borrowed minor-subdominant colour.
const VERSES = [
  [
    [5, 10, 9, 10, 8, 9, 8],
    [9, 8, 9, 7, 8, 7, 7],
    [6, 10, 9, 10, 8, 10],
    [10, 9, 10, 8, 7],
    [8, 11, 10, 11, 9, 10, 11],
    [10, 9, 10, 8, 9, 8],
    [9, 11, 10, 9, 11, 9, 11],
    [10, 9, 7, 9],
  ],
  [
    [6, 6, 10, 9, 8, 10, 8],
    [10, 9, 10, 8, 9, 7, 7],
    [8, 11, 10, 9, 8, 10],
    [10, 9, 8, 10, 7],
    [8, 9, 11, 10, 9, 8, 11],
    [10, 8, 9, 10, 9, 8],
    [9, 11, 9, 10, 11, 9, 11],
    [10, 9, 7, 9],
  ],
  [
    [5, 8, 10, 9, 8, 10, 8],
    [9, 10, 9, 7, 8, 7, 7],
    [6, 8, 10, 9, 8, 10],
    [10, 9, 10, 8, 7],
    [8, 11, 11, 10, 9, 11, 11],
    [10, 9, 8, 10, 9, 8],
    [9, 10, 11, 12, 11, 10, 11],
    [10, 9, 7, 9],
  ],
];

const DEVELOPMENT = [
  [8, 10, 12, 11, 10, 9, 10],
  [10, 9, 10, 12, 11, 10, 10],
  [11, 12, 12, 11, 10, 11],
  [10, 12, 11, 10, 8],
  [9, 11, 12, 12, 11, 9, 11],
  [9, 11, 12, 11, 10, 9],
  [8, 10, 12, 13, 12, 10, 8],
  [10, 9, 7, 9],
];

const PROGRESSION = [
  // A: a single descending bass argument, C–B–A–G–F–E–D–G in C.
  'I', 'V/3', 'vi', 'iii/3', 'IV', 'I/3', 'ii7', 'V7',
  // B: leave home, intensify, reach one peak, then withhold resolution.
  'vi', 'iii', 'IV', 'I/3', 'ii7', 'V7', 'I', 'V7',
  // A′: literal return, followed by the borrowed iv and a quiet tonic answer.
  'I', 'V/3', 'vi', 'iii/3', 'IV', 'iv', 'I/3', 'I',
];

const pc = (midi) => ((Math.round(midi) % 12) + 12) % 12;

function parseDegree(token) {
  if (typeof token === 'number') return { degree: token, accidental: 0 };
  const match = /^(\d+)([b#])?$/.exec(String(token));
  if (!match) throw new Error(`invalid degree: ${token}`);
  return {
    degree: Number(match[1]),
    accidental: match[2] === 'b' ? -1 : (match[2] === '#' ? 1 : 0),
  };
}

function degreeToMidi(tonic, token) {
  const { degree, accidental } = parseDegree(token);
  const zero = degree - 1;
  const octave = Math.floor(zero / 7);
  const index = ((zero % 7) + 7) % 7;
  return tonic + octave * 12 + MAJOR[index] + accidental;
}

function barNotes(tokens, bar, song, rhythm, section, velocity) {
  if (tokens.length !== rhythm.at.length || tokens.length !== rhythm.dur.length) {
    throw new Error(`bar ${bar}: pitch/rhythm length mismatch`);
  }
  return tokens.map((token, sourceIndex) => ({
    midi: degreeToMidi(song.tonicMidi, token),
    beat: bar * 4 + rhythm.at[sourceIndex],
    dur: rhythm.dur[sourceIndex],
    vel: velocity,
    section,
    sourceBar: bar % 8,
    sourceIndex,
  }));
}

function returningVerse(verse) {
  return [
    ...verse.slice(0, 5).map((bar) => bar.slice()),
    [11, '13b', 12, 11, 10, 8],
    [8, 10, 9, 8, 10, 8, 8],
    [5, 10, 9, 8, 9, 8],
  ];
}

function composeLine(verse, song) {
  const returnVerse = returningVerse(verse);
  const line = [];
  for (let bar = 0; bar < 24; bar += 1) {
    const section = Math.floor(bar / 8);
    const localBar = bar % 8;
    const pitches = section === 0
      ? verse[localBar]
      : (section === 1 ? DEVELOPMENT[localBar] : returnVerse[localBar]);
    const rhythm = section === 2 && localBar === 7 ? FINAL_RHYTHM : RHYTHMS[localBar];
    const velocity = section === 0 ? 0.63 : (section === 1 ? 0.71 : 0.57);
    line.push(...barNotes(pitches, bar, song, rhythm, section, velocity));
  }
  const climax = line.find((note) => note.beat === 14 * 4 + RHYTHMS[6].at[3]);
  if (climax) {
    climax.dur = Math.max(0.9, climax.dur);
    climax.vel = 0.84;
  }
  line.at(-1).vel = 0.39;
  return line;
}

function phraseSignature(notes, bar) {
  const line = notes.filter((note) => Math.floor(note.beat / 4) === bar);
  return line.slice(1).map((note, index) => note.midi - line[index].midi);
}

function sameContour(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function objectiveDescription(song, melody, chords) {
  const withinBar = [];
  for (let index = 1; index < melody.length; index += 1) {
    if (Math.floor(melody[index].beat / 4) !== Math.floor(melody[index - 1].beat / 4)) continue;
    withinBar.push(Math.abs(melody[index].midi - melody[index - 1].midi));
  }
  const pitches = melody.map((note) => note.midi);
  const highest = Math.max(...pitches);
  return {
    compositionOrder: 'vocal-phrase-and-harmony-together',
    noteCount: melody.length,
    notesPerBar: melody.length / 24,
    range: highest - Math.min(...pitches),
    stepRatio: withinBar.filter((distance) => distance <= 2).length / withinBar.length,
    leapRatio: withinBar.filter((distance) => distance >= 5).length / withinBar.length,
    maxLeap: Math.max(...withinBar),
    uniquePeak: pitches.filter((pitch) => pitch === highest).length === 1,
    peakBar: Math.floor(melody.find((note) => note.midi === highest).beat / 4),
    literalReturnBars: Array.from({ length: 5 }, (_, bar) => sameContour(
      phraseSignature(melody, bar), phraseSignature(melody, bar + 16),
    )).filter(Boolean).length,
    finalTonic: pc(melody.at(-1).midi) === pc(song.tonicMidi),
    harmonyFit: harmonyFit(song, melody, chords),
  };
}

function rebalance(arranged) {
  return {
    ...arranged,
    accomp: arranged.accomp.map((note) => ({ ...note, vel: note.vel * 0.72 })),
    bass: arranged.bass.map((note) => ({ ...note, vel: note.vel * 0.82 })),
    pad: arranged.pad.map((note) => ({ ...note, vel: note.vel * 0.58 })),
  };
}

export function composeVocalSongV9(seed, data, settings, foundationComposer) {
  const foundation = foundationComposer(seed, data, {
    ...settings,
    generatorVersion: '2',
    songBars: '32',
    majorRatio: 100,
  });
  const song = { ...foundation, mode: 'major', bars: 24, totalBeats: 96 };
  const rng = makeRng(seedFromString(`${seed}:codex-vocal-9`));
  const verse = VERSES[Math.floor(rng() * VERSES.length)];
  const authored = composeLine(verse, song);
  const arranged = rebalance(arrange(song, PROGRESSION, authored));
  const quality = objectiveDescription(song, authored, arranged.chords);
  const climax = authored.reduce((top, note) => (note.midi > top.midi ? note : top), authored[0]);
  const melody = authored.map(({ section, sourceBar, sourceIndex, ...note }) => note);

  return {
    ...song,
    modulation: null,
    sections: [
      { name: 'A', startBar: 0, progressionId: 'v9-descending-verse' },
      { name: 'B', startBar: 8, progressionId: 'v9-development' },
      { name: "A''", startBar: 16, progressionId: 'v9-return-and-release' },
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
    composerEngine: 'codex9',
    climaxBeat: climax.beat,
    breathBar: 7,
    quality,
  };
}
