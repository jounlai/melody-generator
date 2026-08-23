/** Codex vocal composer v4: contrast never loses the identity of the opening theme. */
import { makeRng, seedFromString, pick } from './rng.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// Six-note vocal cells. Every cell has a clear crest and returns toward home.
const MOTIFS = [
  [0, 0, 1, 2, 1, -1],
  [0, 2, 1, 0, -1, 0],
  [0, 1, 2, 1, 0, -1],
  [0, -1, 0, 2, 1, 0],
  [0, 1, 3, 2, 1, 0],
];

const RHYTHMS = {
  theme: { at: [0.5, 1, 1.5, 2.5, 3, 3.5], dur: [0.5, 0.5, 1, 0.5, 0.5, 1.75] },
  reply: { at: [0, 1, 1.5, 2.5, 3.5, 4.5], dur: [1, 0.5, 1, 1, 1, 1.5] },
  suspended: { at: [0.25, 0.75, 1.75, 2.25, 3.75, 4.75], dur: [0.5, 1, 0.5, 1.5, 1, 1.75] },
  bridge: { at: [0, 0.5, 1.5, 2.5, 3, 5], dur: [0.5, 1, 1, 0.5, 2, 1.5] },
  urgent: { at: [0.5, 1, 1.5, 2, 3, 4], dur: [0.5, 0.5, 0.5, 1, 1, 2] },
  cadence: { at: [0, 1.5, 2, 3.5, 4.5, 5.5], dur: [1.5, 0.5, 1.5, 1, 1, 2] },
};

// Development is deliberately shallow. The last four phrases return almost
// literally to the opening, instead of introducing progressively stranger ideas.
const FORM = [
  ['theme', 'theme', 0], ['reply', 'reply', 0],
  ['theme', 'theme', 0], ['cadence', 'cadence', -1],
  ['suspended', 'soften', -1], ['reply', 'reply', -1],
  ['urgent', 'theme', 0], ['cadence', 'cadence', -1],
  ['bridge', 'lift', 1], ['suspended', 'reply', 1],
  ['urgent', 'lift', 2], ['bridge', 'climax', 2],
  ['theme', 'theme', 0], ['reply', 'reply', 0],
  ['suspended', 'soften', -1], ['cadence', 'final', -1],
];

const pitchClass = (n) => ((Math.round(n) % 12) + 12) % 12;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function midiFor(tonic, mode, degree) {
  const scale = mode === 'major' ? MAJOR : MINOR;
  const octave = Math.floor(degree / 7);
  const index = ((degree % 7) + 7) % 7;
  return tonic + 12 + octave * 12 + scale[index];
}

function stable(target, chord, lo, hi) {
  if (!chord?.pcs?.length) return clamp(target, lo, hi);
  const root = chord.rootPc ?? chord.pcs[0];
  const stablePcs = chord.pcs.filter((p) => [0, 3, 4, 7].includes((p - root + 12) % 12));
  const allowed = stablePcs.length ? stablePcs : chord.pcs;
  let best = null;
  for (let midi = lo; midi <= hi; midi += 1) {
    if (!allowed.includes(pitchClass(midi))) continue;
    if (best === null || Math.abs(midi - target) < Math.abs(best - target)) best = midi;
  }
  return best ?? clamp(target, lo, hi);
}

function phraseShape(kind, motif) {
  const shape = motif.slice();
  // Variations alter at most one or two late notes; the identifying opening survives.
  if (kind === 'reply') {
    shape[4] -= 1;
    shape[5] -= 1;
  } else if (kind === 'cadence') {
    shape[5] -= 1;
  } else if (kind === 'soften') {
    shape[3] -= 1;
  } else if (kind === 'lift') {
    shape[2] += 1;
  } else if (kind === 'climax') {
    shape[3] += 1;
    shape[4] += 1;
  } else if (kind === 'final') {
    shape[3] = 0;
    shape[4] = -1;
    shape[5] = -2;
  }
  return shape;
}

function nearestRegister(raw, previousEnd, targetCenter, lo, hi) {
  const candidates = [-12, 0, 12]
    .map((offset) => raw.map((midi) => midi + offset))
    .filter((line) => line.every((midi) => midi >= lo && midi <= hi));
  if (!candidates.length) return raw.map((midi) => clamp(midi, lo, hi));
  const cost = (line) => {
    const center = line.reduce((sum, midi) => sum + midi, 0) / line.length;
    return (previousEnd === null ? 0 : Math.abs(line[0] - previousEnd) * 1.6)
      + Math.abs(center - targetCenter) * 0.45;
  };
  return candidates.sort((a, b) => cost(a) - cost(b))[0];
}

function build(song, rng) {
  const motif = pick(rng, MOTIFS);
  const startDegree = 1 + Math.floor(rng() * 3);
  const lo = song.tonicMidi + 7;
  const hi = song.tonicMidi + 23;
  const notes = [];
  let previousEnd = null;

  for (let phrase = 0; phrase < FORM.length; phrase += 1) {
    const [rhythmName, kind, shift] = FORM[phrase];
    const rhythm = RHYTHMS[rhythmName];
    const shape = phraseShape(kind, motif);
    const raw = shape.map((degree) => midiFor(song.tonicMidi, song.mode, startDegree + shift + degree));
    const archLift = phrase >= 8 && phrase <= 11 ? 2 : 0;
    const line = nearestRegister(raw, previousEnd, song.tonicMidi + 15 + archLift, lo, hi);

    for (let index = 0; index < line.length; index += 1) {
      const beat = phrase * 8 + rhythm.at[index];
      let midi = line[index];
      if (index === line.length - 1) midi = stable(midi, song.chords[Math.floor(beat / 4)], lo, hi);
      notes.push({
        midi,
        beat,
        dur: rhythm.dur[index],
        vel: phrase >= 8 && phrase < 12 ? 0.75 : (phrase >= 12 ? 0.57 : 0.65),
        phrase,
        index,
        rhythmName,
      });
    }
    previousEnd = notes.at(-1).midi;
  }

  // A single modest crest, not an unrelated forced high note.
  const crest = notes.find((note) => note.phrase === 11 && note.index === 3);
  const outsideCrest = notes.filter((note) => note !== crest);
  const otherTop = Math.max(...outsideCrest.map((note) => note.midi));
  crest.midi = Math.min(hi, Math.max(crest.midi, otherTop + 1));
  crest.vel = 0.82;

  const last = notes.at(-1);
  last.midi = song.tonicMidi + 12;
  last.dur = Math.max(0.5, song.totalBeats - last.beat);
  last.vel = 0.46;
  return notes;
}

function intervals(notes, phrase) {
  const phraseNotes = notes.filter((note) => note.phrase === phrase);
  return phraseNotes.slice(1).map((note, i) => note.midi - phraseNotes[i].midi);
}

function similarity(a, b) {
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (Math.abs(a[i] - b[i]) <= 1) same += 1;
  }
  return same / Math.max(1, Math.min(a.length, b.length));
}

function critique(song, notes) {
  const opening = intervals(notes, 0);
  const phraseSimilarity = FORM.map((_, phrase) => similarity(opening, intervals(notes, phrase)));
  const recurrence = (phraseSimilarity[2] + phraseSimilarity[6] + phraseSimilarity[12]) / 3;
  const lateRecurrence = phraseSimilarity.slice(8).reduce((sum, value) => sum + value, 0) / 8;
  const divergentLatePhrases = phraseSimilarity.slice(8).filter((value) => value < 0.4).length;
  const phraseRhythms = FORM.map(([rhythm]) => rhythm);
  const uniqueRhythms = new Set(phraseRhythms).size;
  const dominantRhythmRatio = Math.max(...[...new Set(phraseRhythms)]
    .map((rhythm) => phraseRhythms.filter((item) => item === rhythm).length)) / phraseRhythms.length;
  let close = 0;
  let leaps = 0;
  let maxLeap = 0;
  let boundaries = 0;
  for (let i = 1; i < notes.length; i += 1) {
    const distance = Math.abs(notes[i].midi - notes[i - 1].midi);
    if (notes[i].phrase === notes[i - 1].phrase) {
      if (distance <= 2) close += 1;
      if (distance >= 5) leaps += 1;
      maxLeap = Math.max(maxLeap, distance);
    } else if (distance > 7) boundaries += 1;
  }
  const withinPhraseTransitions = notes.length - FORM.length;
  const closeRatio = close / withinPhraseTransitions;
  const leapRatio = leaps / withinPhraseTransitions;
  const pitches = notes.map((note) => note.midi);
  const range = Math.max(...pitches) - Math.min(...pitches);
  let score = 45 + recurrence * 20 + lateRecurrence * 28 + uniqueRhythms * 2;
  score -= divergentLatePhrases * 10 + boundaries * 5;
  score -= Math.abs(closeRatio - 0.68) * 25 + Math.abs(leapRatio - 0.08) * 25;
  if (maxLeap > 7) score -= (maxLeap - 7) * 7;
  if (range < 9 || range > 16) score -= 12;
  return {
    score, recurrence, lateRecurrence, divergentLatePhrases, uniqueRhythms,
    dominantRhythmRatio, closeRatio, leapRatio, maxLeap, range, boundaries,
  };
}

export function composeVocalSongV4(seed, data, settings, foundationComposer) {
  const foundation = foundationComposer(seed, data, { ...settings, generatorVersion: '2' });
  const master = makeRng(seedFromString(`${seed}:codex-vocal-4`));
  let best = null;
  for (let candidate = 0; candidate < 40; candidate += 1) {
    const notes = build(foundation, makeRng(Math.floor(master() * 0xffffffff)));
    const quality = critique(foundation, notes);
    if (!best || quality.score > best.quality.score) best = { notes, quality };
  }
  const melody = best.notes.map(({ phrase, index, rhythmName, ...note }) => note);
  return {
    ...foundation,
    melody,
    composerEngine: 'codex4',
    quality: best.quality,
    climaxBeat: melody.reduce((top, note) => (note.midi > top.midi ? note : top), melody[0]).beat,
  };
}
