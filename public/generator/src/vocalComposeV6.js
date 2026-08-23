/**
 * Codex vocal composer v6.
 *
 * Unlike v1-v5, this writes one complete eight-bar vocal sentence before it
 * chooses any harmony. The sentence is then remembered as A-A'-B-A, and the
 * chords and accompaniment are selected afterwards to support its exposed notes.
 */
import { makeRng, seedFromString, pick } from './rng.js';
import { chordPitchClasses, chordSemitones, chordVoicing, bassMidi } from './theory.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// Seven-note cells: an opening reach, mostly stepwise descent, and a held arrival.
// They encode a vocal technique, not pitches from either reference song.
const SENTENCE_FAMILIES = [
  [
    [0, 4, 3, 2, 3, 1, 0], [0, 2, 1, 1, -1, 0, -2],
    [0, 3, 2, 1, 2, 0, -1], [0, 2, 1, 0, -2, -1, -3],
    [0, 3, 4, 3, 2, 1, 0], [0, -1, 0, -1, 0, -1, -2],
    [0, 1, 3, 3, 2, 4, 1], [0, 2, 1, 0, -1, -2, -3],
  ],
  [
    [0, 3, 2, 4, 3, 1, 0], [0, -1, 1, 0, -2, 0, -1],
    [0, 4, 3, 2, 1, 2, 0], [0, 1, 0, -1, 0, -2, -3],
    [0, 2, 3, 4, 2, 1, 0], [0, 1, 0, 1, -1, 0, -2],
    [0, 2, 4, 3, 4, 2, 1], [0, 1, 0, -1, -2, -1, -3],
  ],
  [
    [0, 4, 2, 3, 1, 0, -1], [0, 2, 0, 1, -1, -2, -1],
    [0, 3, 1, 2, 0, 1, -1], [0, 1, -1, 0, -2, -1, -3],
    [0, 3, 4, 2, 3, 1, 0], [0, -1, 1, -1, 0, -2, -1],
    [0, 2, 3, 1, 2, 4, 1], [0, 2, 0, -1, 0, -2, -3],
  ],
];

const RHYTHMS = [
  { at: [0, 0.5, 0.75, 1, 1.75, 2, 2.5], dur: [0.25, 0.25, 0.25, 0.75, 0.25, 0.5, 1.25] },
  { at: [0.25, 0.5, 1, 1.5, 2.25, 2.5, 3], dur: [0.25, 0.25, 0.25, 0.5, 0.25, 0.25, 1] },
  { at: [0, 0.25, 0.75, 1.25, 2, 2.25, 2.75], dur: [0.25, 0.25, 0.5, 0.25, 0.25, 0.5, 1] },
  { at: [0.5, 0.75, 1.25, 1.5, 2, 2.75, 3], dur: [0.25, 0.25, 0.25, 0.5, 0.75, 0.25, 1] },
  { at: [0, 0.5, 1, 1.25, 1.75, 2.5, 3], dur: [0.5, 0.25, 0.25, 0.25, 0.5, 0.25, 1] },
  { at: [0.25, 0.75, 1, 1.5, 2, 2.5, 3], dur: [0.5, 0.25, 0.5, 0.25, 0.5, 0.25, 1] },
];

const RHYTHM_FORM = [0, 1, 2, 3, 0, 4, 2, 5];

const HARMONY = {
  major: [
    ['I', 'iii7', 'III7', 'vi', 'IV', 'I/3', 'ii7', 'V7'],
    ['I', 'V/3', 'vi', 'iii', 'IV', 'I/3', 'iv', 'V7'],
    ['IM7', 'IM7/3', 'IV', 'iv', 'I', 'VI7', 'ii7', 'V7'],
    ['I', 'vi', 'IV', 'V', 'iii7', 'vi', 'ii7', 'V7'],
    ['I', 'I7', 'IV', 'iv', 'I/3', 'vi', 'ii7', 'V7'],
    ['I', 'V/3', 'vi', 'I/5', 'IVM7', 'iv', 'I', 'V7'],
  ],
  minor: [
    ['i', 'i/7', 'VI', 'III', 'iv', 'i/3', 'V7', 'V7'],
    ['i', 'VII', 'VI', 'V', 'i', 'iv', 'VI', 'V7'],
    ['i', 'iv', 'VII', 'III', 'VI', 'iv', 'V7', 'V7'],
    ['i', 'III', 'VII', 'iv', 'VI', 'i/3', 'V7', 'V7'],
    ['i', 'VI', 'III', 'VII', 'iv', 'VI', 'V7', 'V7'],
    ['i', 'i/3', 'iv', 'VII', 'III', 'VI', 'iv', 'V7'],
  ],
};

// Functional alternatives for each bar of the eight-bar sentence. The complete
// progression is chosen first; these pools then let exposed melody notes decide
// between harmonically equivalent colours at the same formal position.
const HARMONY_COLOURS = {
  major: [
    ['I', 'IM7', 'vi'], ['iii7', 'V/3', 'I/3', 'vi/3'],
    ['III7', 'vi', 'IV', 'I7'], ['vi', 'V', 'iii', 'iv'],
    ['IV', 'IVM7', 'ii7', 'I'], ['I/3', 'vi', 'iv', 'VI7'],
    ['ii7', 'IV', 'iv', 'V'], ['V7'],
  ],
  minor: [
    ['i', 'i7', 'III'], ['i/7', 'VII', 'i/3', 'III/3'],
    ['VI', 'III', 'iv', 'VII'], ['III', 'V', 'VII', 'iv'],
    ['iv', 'VI', 'i', 'III'], ['i/3', 'VI', 'iv', 'VII'],
    ['VI', 'iv', 'V', 'V7'], ['V7'],
  ],
};

const pc = (midi) => ((Math.round(midi) % 12) + 12) % 12;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

function degreeToMidi(tonic, mode, degree) {
  const scale = mode === 'major' ? MAJOR : MINOR;
  const zero = degree - 1;
  const octave = Math.floor(zero / 7);
  const index = ((zero % 7) + 7) % 7;
  return tonic + octave * 12 + scale[index];
}

function rhythmSignature(rhythm) {
  return rhythm.at.slice(1).map((at, index) => at - rhythm.at[index]).join(',');
}

function buildTheme(song, rng) {
  const family = pick(rng, SENTENCE_FAMILIES);
  const startDegree = 6 + Math.floor(rng() * 2);
  const rhythmRotation = Math.floor(rng() * RHYTHMS.length);
  const anchors = [0, 0, 0, 0, 0, 0, 1, 0];
  const notes = [];
  for (let bar = 0; bar < 8; bar += 1) {
    const rhythmIndex = (RHYTHM_FORM[bar] + rhythmRotation) % RHYTHMS.length;
    const rhythm = RHYTHMS[rhythmIndex];
    for (let index = 0; index < 7; index += 1) {
      const degree = clamp(startDegree + anchors[bar] + family[bar][index], 4, 11);
      notes.push({
        degree,
        midi: degreeToMidi(song.tonicMidi, song.mode, degree),
        beat: bar * 4 + rhythm.at[index],
        dur: rhythm.dur[index],
        vel: 0.62,
        sourceBar: bar,
        sourceIndex: index,
        rhythmIndex,
      });
    }
  }
  return notes;
}

function copySection(theme, section, song) {
  const offset = section * 32;
  return theme.map((note) => ({ ...note, beat: note.beat + offset, section }));
}

function varyA(section) {
  for (const note of section) {
    if (note.sourceBar < 4) continue;
    if (note.sourceBar === 4 && note.sourceIndex === 3) note.degree += 1;
    if (note.sourceBar === 5 && note.sourceIndex === 0) note.degree -= 1;
    if (note.sourceBar === 6 && note.sourceIndex === 5) note.degree += 1;
    if (note.sourceBar === 7 && note.sourceIndex >= 5) note.degree -= 1;
  }
}

function buildBridge(theme, song) {
  const section = copySection(theme, 2, song);
  for (const note of section) {
    note.degree += note.sourceBar < 4 ? 1 : 2;
    note.degree = clamp(note.degree, 4, 12);
    const altRhythm = RHYTHMS[(note.rhythmIndex + 2) % RHYTHMS.length];
    note.beat = 64 + note.sourceBar * 4 + altRhythm.at[note.sourceIndex];
    note.dur = altRhythm.dur[note.sourceIndex];
    note.vel = 0.7;
  }
  const climax = section.find((note) => note.sourceBar === 6 && note.sourceIndex === 5);
  const approach = section.find((note) => note.sourceBar === 6 && note.sourceIndex === 4);
  climax.degree = 13;
  approach.degree = Math.max(3, climax.degree - 4);
  climax.dur = Math.max(1.25, climax.dur);
  climax.vel = 0.84;
  return section;
}

function finishReturn(section) {
  for (const note of section) {
    if (note.sourceBar === 6 && note.sourceIndex >= 5) note.degree -= 1;
    if (note.sourceBar === 7 && note.sourceIndex === 4) note.degree = 10;
    if (note.sourceBar === 7 && note.sourceIndex === 5) note.degree = 9;
    if (note.sourceBar === 7 && note.sourceIndex === 6) {
      note.degree = 8;
      note.dur = 4 - (note.beat % 4);
      note.vel = 0.43;
    }
  }
}

function materialise(song, notes) {
  for (const note of notes) {
    note.degree = clamp(note.degree, 4, 13);
    note.midi = degreeToMidi(song.tonicMidi, song.mode, note.degree);
  }
}

function intervalSignature(notes, section, bar) {
  const line = notes.filter((note) => note.section === section && note.sourceBar === bar);
  return line.slice(1).map((note, index) => note.midi - line[index].midi);
}

function similarity(a, b) {
  let same = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (Math.abs(a[index] - b[index]) <= 1) same += 1;
  }
  return same / Math.max(1, Math.min(a.length, b.length));
}

function melodyCritique(notes) {
  const transitions = [];
  for (let index = 1; index < notes.length; index += 1) {
    if (notes[index].sourceIndex === 0) continue;
    transitions.push(Math.abs(notes[index].midi - notes[index - 1].midi));
  }
  const stepRatio = transitions.filter((distance) => distance <= 2).length / transitions.length;
  const leapRatio = transitions.filter((distance) => distance >= 5).length / transitions.length;
  const maxLeap = Math.max(...transitions);
  const recurrence = [1, 3].reduce((sum, section) => sum
    + Array.from({ length: 8 }, (_, bar) => similarity(
      intervalSignature(notes, 0, bar), intervalSignature(notes, section, bar),
    )).reduce((a, b) => a + b, 0) / 8, 0) / 2;
  const sectionMeans = Array.from({ length: 4 }, (_, section) => {
    const line = notes.filter((note) => note.section === section);
    return line.reduce((sum, note) => sum + note.midi, 0) / line.length;
  });
  const pitches = notes.map((note) => note.midi);
  const top = Math.max(...pitches);
  const uniquePeak = pitches.filter((pitch) => pitch === top).length === 1;
  const range = top - Math.min(...pitches);
  const rhythmVariety = new Set(notes.filter((note) => note.section === 0)
    .map((note) => note.rhythmIndex)).size;
  const returnDistance = Math.abs(sectionMeans[3] - sectionMeans[0]);
  const bridgeLift = sectionMeans[2] - sectionMeans[0];
  let score = 55 + recurrence * 25 + rhythmVariety * 2;
  score -= Math.abs(stepRatio - 0.62) * 35 + Math.abs(leapRatio - 0.11) * 45;
  score -= returnDistance * 5 + Math.abs(bridgeLift - 2.5) * 3;
  if (!uniquePeak) score -= 15;
  if (maxLeap > 9) score -= (maxLeap - 9) * 8;
  if (range < 11 || range > 17) score -= 12;
  return {
    score, stepRatio, leapRatio, maxLeap, recurrence, sectionMeans,
    returnDistance, bridgeLift, uniquePeak, range, rhythmVariety,
  };
}

function composeMelody(song, rng) {
  let best = null;
  for (let candidate = 0; candidate < 96; candidate += 1) {
    const theme = buildTheme(song, rng);
    const a = copySection(theme, 0, song);
    const aPrime = copySection(theme, 1, song);
    varyA(aPrime);
    const bridge = buildBridge(theme, song);
    const returning = copySection(theme, 3, song);
    finishReturn(returning);
    const notes = [...a, ...aPrime, ...bridge, ...returning];
    materialise(song, notes);
    const quality = melodyCritique(notes);
    if (!best || quality.score > best.quality.score) best = { notes, quality };
  }
  return best;
}

function actualChordPcs(symbol, song) {
  return chordPitchClasses(symbol, song.mode).map((value) => pc(value + song.tonicMidi));
}

function progressionScore(progression, sectionNotes, song) {
  let score = 0;
  for (const note of sectionNotes) {
    const bar = Math.floor((note.beat % 32) / 4);
    const chordPcs = actualChordPcs(progression[bar], song);
    const localBeat = note.beat % 4;
    const weight = note.dur >= 1 ? 3 : (Number.isInteger(localBeat) ? 2 : 0.7);
    score += chordPcs.includes(pc(note.midi)) ? weight : -weight * 0.34;
  }
  return score;
}

function selectProgression(sectionNotes, song, excluded = null) {
  const candidates = HARMONY[song.mode] ?? HARMONY.major;
  return candidates
    .filter((candidate) => candidate !== excluded)
    .map((candidate) => ({ candidate, score: progressionScore(candidate, sectionNotes, song) }))
    .sort((a, b) => b.score - a.score)[0].candidate;
}

function barHarmonyScore(symbol, notes, song) {
  const chordPcs = actualChordPcs(symbol, song);
  let score = 0;
  for (const note of notes) {
    const localBeat = note.beat % 4;
    const weight = note.dur >= 1 ? 3 : (Number.isInteger(localBeat) ? 2 : 0.7);
    score += chordPcs.includes(pc(note.midi)) ? weight : -weight * 0.4;
  }
  return score;
}

function refineProgression(base, sectionNotes, song) {
  const pools = HARMONY_COLOURS[song.mode] ?? HARMONY_COLOURS.major;
  return base.map((original, bar) => {
    if (bar === 7) return original;
    const notes = sectionNotes.filter((note) => Math.floor((note.beat % 32) / 4) === bar);
    return [...new Set([original, ...pools[bar]])]
      .map((symbol) => ({
        symbol,
        score: barHarmonyScore(symbol, notes, song) + (symbol === original ? 0.6 : 0),
      }))
      .sort((a, b) => b.score - a.score)[0].symbol;
  });
}

export function chooseHarmony(song, melody) {
  const aNotes = melody.filter((note) => note.section === 0);
  const aPrimeNotes = melody.filter((note) => note.section === 1);
  const bridgeNotes = melody.filter((note) => note.section === 2);
  const returnNotes = melody.filter((note) => note.section === 3);
  const a = refineProgression(selectProgression(aNotes, song), aNotes, song);
  const b = refineProgression(selectProgression(bridgeNotes, song, a), bridgeNotes, song);
  const aPrime = refineProgression(a.slice(), aPrimeNotes, song);
  aPrime[7] = song.mode === 'major' ? 'V7' : 'V7';
  const returning = refineProgression(a.slice(), returnNotes, song);
  returning[6] = song.mode === 'major' ? 'iv' : 'VI';
  returning[7] = song.mode === 'major' ? 'I' : 'i';
  return [...a, ...aPrime, ...b, ...returning];
}

function voiceLeading(raw, previous, ceiling) {
  const candidates = [-12, 0, 12]
    .map((offset) => raw.map((midi) => midi + offset))
    .filter((line) => Math.min(...line) >= 38 && Math.max(...line) <= Math.min(64, ceiling));
  if (!candidates.length) {
    const line = raw.slice();
    while (Math.max(...line) > ceiling) line.pop();
    return line.length ? line : raw.map((midi) => midi - 12);
  }
  if (!previous) return candidates.sort((a, b) => Math.abs(a[0] - 48) - Math.abs(b[0] - 48))[0];
  return candidates.sort((a, b) => Math.abs(a[0] - previous[0]) - Math.abs(b[0] - previous[0]))[0];
}

function chordDescription(symbol, bar, song) {
  const root = song.tonicMidi + chordSemitones(symbol, song.mode)[0];
  const bass = bassMidi(symbol, song.mode, song.tonicMidi, 36);
  return {
    bar,
    symbol,
    rootPc: pc(root),
    bassPc: pc(bass),
    pcs: actualChordPcs(symbol, song),
  };
}

function addAccompaniment(out, voicing, barBeat, pattern, vel) {
  const low = voicing[0];
  const upper = voicing.slice(1);
  if (pattern === 'sustain') {
    out.push({ midi: low, midis: voicing, beat: barBeat, dur: 4, vel });
  } else if (pattern === 'broken') {
    out.push({ midi: low, beat: barBeat, dur: 2, vel });
    if (upper.length) out.push({ midi: upper[0], midis: upper, beat: barBeat + 1, dur: 1, vel });
    out.push({ midi: low, beat: barBeat + 2, dur: 2, vel });
    if (upper.length) out.push({ midi: upper[0], midis: upper, beat: barBeat + 3, dur: 1, vel });
  } else if (pattern === 'dotted') {
    out.push({ midi: low, beat: barBeat, dur: 1.5, vel });
    if (upper.length) out.push({ midi: upper[0], midis: upper, beat: barBeat + 1.5, dur: 0.5, vel });
    out.push({ midi: low, beat: barBeat + 2, dur: 1, vel });
    if (upper.length) out.push({ midi: upper[0], midis: upper, beat: barBeat + 3, dur: 1, vel });
  } else {
    const order = [0, 1, 2, 1, 0, 1, 2, 1];
    for (let index = 0; index < 8; index += 1) {
      out.push({ midi: voicing[Math.min(order[index], voicing.length - 1)], beat: barBeat + index * 0.5, dur: 0.65, vel });
    }
  }
}

function arrangementPattern(section, localBar) {
  if (section === 0) return localBar < 2 ? 'sustain' : (localBar % 3 === 0 ? 'dotted' : 'broken');
  if (section === 1) return localBar % 3 === 1 ? 'arp' : (localBar % 2 ? 'dotted' : 'broken');
  if (section === 2) return localBar % 2 ? 'arp' : 'broken';
  if (localBar >= 6) return 'sustain';
  return localBar % 2 ? 'dotted' : 'broken';
}

export function arrange(song, symbols, melody) {
  const chords = [];
  const accomp = [];
  const bass = [];
  const pad = [];
  const accompPatterns = [];
  const bassPatterns = [];
  let previousVoicing = null;
  let previousBass = null;

  for (let bar = 0; bar < 32; bar += 1) {
    const symbol = symbols[bar];
    const barMelody = melody.filter((note) => Math.floor(note.beat / 4) === bar);
    const ceiling = Math.min(...barMelody.map((note) => note.midi), song.tonicMidi + 19) - 2;
    const raw = chordVoicing(symbol, song.mode, song.tonicMidi, 45);
    const voicing = voiceLeading(raw, previousVoicing, ceiling);
    previousVoicing = voicing;
    chords.push(chordDescription(symbol, bar, song));

    const section = Math.floor(bar / 8);
    const localBar = bar % 8;
    const pattern = arrangementPattern(section, localBar);
    const vel = section === 2 ? 0.27 : (section === 0 ? 0.21 : 0.24);
    addAccompaniment(accomp, voicing, bar * 4, pattern, vel);
    accompPatterns.push(pattern);

    let bassNote = bassMidi(symbol, song.mode, song.tonicMidi, 34);
    if (previousBass !== null) {
      const options = [bassNote - 12, bassNote, bassNote + 12].filter((midi) => midi >= 28 && midi <= 48);
      bassNote = options.sort((a, b) => Math.abs(a - previousBass) - Math.abs(b - previousBass))[0];
    }
    previousBass = bassNote;
    if (section === 2 || section === 1) {
      bass.push({ midi: bassNote, beat: bar * 4, dur: 2, vel: 0.42 });
      bass.push({ midi: bassNote, beat: bar * 4 + 2, dur: 2, vel: 0.37 });
      bassPatterns.push('pedal');
    } else {
      bass.push({ midi: bassNote, beat: bar * 4, dur: 4, vel: 0.4 });
      bassPatterns.push('whole');
    }
    pad.push({ midis: voicing, beat: bar * 4, dur: 4, vel: section === 2 ? 0.22 : 0.18 });
  }
  return { chords, accomp, bass, pad, accompPatterns, bassPatterns };
}

export function harmonyFit(song, melody, chords) {
  let matched = 0;
  let total = 0;
  for (const note of melody) {
    if (!(note.dur >= 0.75 || Number.isInteger(note.beat % 4))) continue;
    total += 1;
    if (chords[Math.floor(note.beat / 4)].pcs.includes(pc(note.midi))) matched += 1;
  }
  return matched / Math.max(1, total);
}

export function composeVocalSongV6(seed, data, settings, foundationComposer) {
  // The legacy composer supplies key, mode and tempo only. Its melody, chords and
  // arrangement are deliberately discarded; v6 composes those in a new order.
  const shell = foundationComposer(seed, data, { ...settings, generatorVersion: '2', songBars: '32' });
  const rng = makeRng(seedFromString(`${seed}:codex-vocal-6`));
  const selected = composeMelody(shell, rng);
  const symbols = chooseHarmony(shell, selected.notes);
  const arranged = arrange(shell, symbols, selected.notes);
  const melody = selected.notes.map(({ degree, sourceBar, sourceIndex, rhythmIndex, section, ...note }) => note);
  const climax = selected.notes.reduce((top, note) => (note.midi > top.midi ? note : top), selected.notes[0]);
  return {
    ...shell,
    bars: 32,
    totalBeats: 128,
    modulation: null,
    sections: [
      { name: 'A', startBar: 0, progressionId: 'v6-theme' },
      { name: "A'", startBar: 8, progressionId: 'v6-theme-var' },
      { name: 'B', startBar: 16, progressionId: 'v6-bridge' },
      { name: "A''", startBar: 24, progressionId: 'v6-return' },
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
    composerEngine: 'codex6',
    climaxBeat: climax.beat,
    breathBar: 7,
    quality: {
      ...selected.quality,
      harmonyFit: harmonyFit(shell, melody, arranged.chords),
      themeNoteCount: 56,
      phraseNoteCounts: Array(8).fill(7),
      compositionOrder: 'melody-first',
    },
  };
}
