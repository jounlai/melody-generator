/**
 * Codex vocal-phrase composer.
 *
 * The original composer remains untouched in compose.js.  This engine uses its
 * harmony/arrangement as a reliable frame, then writes a new top line and bass
 * from a phrase grammar measured from the supplied vocal MIDI: mostly repeated
 * notes and steps, short syllabic notes, one rare expressive leap, and a long
 * phrase-ending tone followed by breath.
 */
import { makeRng, seedFromString, pick } from './rng.js';

const RHYTHMS = [
  [0.5, 0.5, 0.25, 0.25, 0.5, 0.5, 1, 1.75],
  [0.5, 0.25, 0.25, 0.5, 0.5, 1, 0.5, 2],
  [0.25, 0.25, 0.5, 0.5, 0.5, 0.5, 1, 2],
  [0.5, 0.5, 0.5, 0.25, 0.25, 1, 0.5, 2],
];

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function pc(n) { return ((Math.round(n) % 12) + 12) % 12; }

function degreeMidi(tonic, mode, degree) {
  const scale = mode === 'major' ? MAJOR : MINOR;
  const octave = Math.floor(degree / 7);
  const index = ((degree % 7) + 7) % 7;
  return tonic + 12 + octave * 12 + scale[index];
}

function closestPc(target, pcs, lo, hi) {
  let best = clamp(Math.round(target), lo, hi);
  let cost = Infinity;
  for (let m = lo; m <= hi; m += 1) {
    if (!pcs.includes(pc(m))) continue;
    const c = Math.abs(m - target);
    if (c < cost) { best = m; cost = c; }
  }
  return best;
}

function contour(rng) {
  const steps = [0];
  for (let i = 1; i < 8; i += 1) {
    const roll = rng();
    let move = roll < 0.2 ? 0 : (roll < 0.62 ? (rng() < 0.5 ? -1 : 1) : (rng() < 0.64 ? -2 : 2));
    if (i === 1 && rng() < 0.22) move = 4; // one opening cry, never every phrase
    steps.push(clamp(steps[i - 1] + move, -3, 5));
  }
  // A sung sentence usually releases downward into its held final syllable.
  steps[6] = Math.min(steps[6], steps[5]);
  steps[7] = steps[6] - (rng() < 0.72 ? 1 : 0);
  return steps;
}

function vary(base, phrase, rng) {
  const section = Math.floor(phrase / 4);
  const out = base.slice();
  if (phrase % 4 === 1) out[3] += rng() < 0.5 ? 1 : -1;
  if (phrase % 4 === 2) { out[1] += 1; out[4] -= 1; }
  if (phrase % 4 === 3) { out[6] -= 1; out[7] -= 1; }
  if (section === 1) for (let i = 1; i < 6; i += 1) out[i] -= 1;
  if (section === 2) for (let i = 0; i < 7; i += 1) out[i] += 2;
  if (section === 3) for (let i = 1; i < out.length; i += 1) out[i] -= 1;
  return out;
}

function makeMelody(song, seed) {
  const rng = makeRng(seedFromString(`${seed}:codex-vocal-1`));
  const phrases = Math.floor(song.totalBeats / 8);
  const theme = contour(rng);
  const notes = [];
  let summit = null;

  for (let p = 0; p < phrases; p += 1) {
    const start = p * 8 + (p % 4 === 0 ? 0.5 : (rng() < 0.45 ? 0.25 : 0.5));
    const rhythm = pick(rng, RHYTHMS).slice();
    const degrees = vary(theme, p, rng);
    let beat = start;
    for (let i = 0; i < rhythm.length; i += 1) {
      const bar = Math.min(song.bars - 1, Math.floor(beat / 4));
      const chord = song.chords[bar];
      let midi = degreeMidi(song.tonicMidi, song.mode, degrees[i]);
      const isAnchor = i === rhythm.length - 1 || Math.abs(beat - Math.round(beat)) < 1e-9;
      if (isAnchor && chord?.pcs?.length) midi = closestPc(midi, chord.pcs, song.tonicMidi + 7, song.tonicMidi + 24);
      midi = clamp(midi, song.tonicMidi + 7, song.tonicMidi + 24);
      const vel = p >= 8 && p < 12 ? 0.76 : (p >= 12 ? 0.56 : 0.64);
      const note = { midi, beat, dur: rhythm[i], vel };
      notes.push(note);
      if (!summit || midi > summit.midi) summit = note;
      beat += rhythm[i];
    }
  }

  // Harmony anchors can pull a note away from its neighbours.  A singer usually
  // repairs that inside the phrase with a step, so smooth most remaining jumps.
  for (let i = 1; i < notes.length; i += 1) {
    const prev = notes[i - 1];
    const note = notes[i];
    const gap = note.beat - (prev.beat + prev.dur);
    const leap = note.midi - prev.midi;
    if (gap <= 0.75 && Math.abs(leap) > 2 && rng() < 0.82) {
      note.midi = prev.midi + (leap < 0 ? -2 : 2);
    }
  }

  // Give the dramatic section one unmistakable, non-repeated summit.
  const climax = notes.find((n) => n.beat >= song.totalBeats * 0.68 && n.dur <= 0.5);
  if (climax) {
    const peak = clamp(song.tonicMidi + 24, song.tonicMidi + 19, song.tonicMidi + 24);
    for (const n of notes) if (n !== climax && n.midi >= peak) n.midi = peak - 2;
    climax.midi = peak;
    climax.vel = 0.82;
  }

  // The final remembered syllable is the tonic and reaches the last bar line.
  const last = notes[notes.length - 1];
  if (last) {
    last.midi = song.tonicMidi + 12;
    last.dur = Math.max(1.5, song.totalBeats - last.beat);
    last.vel = 0.5;
  }
  return notes.filter((n) => n.beat < song.totalBeats);
}

function makeDescendingBass(song) {
  const out = [];
  for (let bar = 0; bar < song.bars; bar += 1) {
    const chord = song.chords[bar];
    if (!chord?.pcs?.length) continue;
    const targetPc = chord.bassPc ?? chord.rootPc ?? chord.pcs[0];
    let root = song.tonicMidi - 12;
    while (pc(root) !== pc(targetPc)) root -= 1;
    while (root < 32) root += 12;
    while (root > 47) root -= 12;
    out.push({ midi: root, beat: bar * 4, dur: 2, vel: 0.38 });
    const nextPc = song.chords[bar + 1]?.bassPc;
    let second = root - 1;
    if (nextPc !== undefined) {
      while (pc(second) !== pc(nextPc)) second -= 1;
      while (second < 30) second += 12;
    }
    out.push({ midi: second, beat: bar * 4 + 2, dur: 2, vel: 0.34 });
  }
  return out;
}

export function composeVocalSong(seed, data, settings, composeFoundation) {
  const foundation = composeFoundation(seed, data, { ...settings, generatorVersion: '2' });
  const melody = makeMelody(foundation, seed);
  return {
    ...foundation,
    melody,
    bass: makeDescendingBass(foundation),
    climaxBeat: melody.reduce((best, n) => (n.midi > best.midi ? n : best), melody[0] ?? { midi: 0, beat: 0 }).beat,
    composerEngine: 'codex',
  };
}
