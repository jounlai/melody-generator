/**
 * Codex vocal composer v2: compose many complete top lines, criticise them,
 * and keep only the strongest.  The unit is a four-bar sung sentence, not a
 * bar or an isolated note.
 */
import { makeRng, seedFromString, pick } from './rng.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const CANDIDATES = 96;

const PHRASE_RHYTHMS = [
  { at: [0.5, 1, 1.5, 2.5, 3, 3.5], dur: [0.5, 0.5, 1, 0.5, 0.5, 1.75] },
  { at: [0.5, 1, 2, 2.5, 3, 4], dur: [0.5, 1, 0.5, 0.5, 1, 1.5] },
  { at: [0.25, 0.75, 1.25, 2.25, 3.25, 4.25], dur: [0.5, 0.5, 1, 1, 1, 1.75] },
];

const pc = (n) => ((Math.round(n) % 12) + 12) % 12;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function degreeMidi(tonic, mode, degree) {
  const scale = mode === 'major' ? MAJOR : MINOR;
  const octave = Math.floor(degree / 7);
  const index = ((degree % 7) + 7) % 7;
  return tonic + 12 + octave * 12 + scale[index];
}

function nearestStable(target, chord, lo, hi) {
  if (!chord?.pcs?.length) return clamp(target, lo, hi);
  const root = chord.rootPc ?? chord.pcs[0];
  const stable = chord.pcs.filter((p) => [0, 3, 4, 7].includes((p - root + 12) % 12));
  const allowed = stable.length ? stable : chord.pcs;
  let best = null;
  for (let m = lo; m <= hi; m += 1) {
    if (!allowed.includes(pc(m))) continue;
    if (best === null || Math.abs(m - target) < Math.abs(best - target)) best = m;
  }
  return best ?? clamp(target, lo, hi);
}

function makeTheme(rng) {
  const out = [1 + Math.floor(rng() * 3)];
  let lastDir = 0;
  for (let i = 1; i < 12; i += 1) {
    let move;
    if (i === 1 && rng() < 0.42) move = rng() < 0.75 ? 3 : 4;
    else {
      const r = rng();
      move = r < 0.22 ? 0 : (r < 0.65 ? (rng() < 0.56 ? -1 : 1) : (rng() < 0.7 ? -2 : 2));
      // A leap behaves like a sung reach: the next motion normally recovers it.
      if (Math.abs(lastDir) >= 3) move = lastDir > 0 ? -1 : 1;
    }
    out.push(clamp(out[i - 1] + move, -2, 6));
    lastDir = move;
  }
  // Both clauses release rather than point upward forever.
  out[5] = Math.min(out[5], out[4]);
  out[11] = Math.min(out[11], out[10]);
  return out;
}

function sentenceDegrees(theme, sentence, rng) {
  const d = theme.slice();
  if (sentence === 1) { d[3] += 1; d[9] -= 1; }
  if (sentence === 2) { for (let i = 0; i < 12; i += 1) d[i] -= 1; d[8] += 1; }
  if (sentence === 3) { for (let i = 0; i < 12; i += 1) d[i] -= 1; d[4] += 1; }
  if (sentence === 4) { for (let i = 0; i < 12; i += 1) d[i] = 4 - d[i] + 2; }
  if (sentence === 5) { for (let i = 0; i < 12; i += 1) d[i] += 2; d[7] += 2; }
  if (sentence === 6) { d[2] -= 1; d[8] -= 1; }
  if (sentence === 7) {
    for (let i = 0; i < 12; i += 1) d[i] -= 1;
    d[9] = Math.min(d[9], d[8]); d[10] = d[9] - 1; d[11] = 0;
  }
  if ([1, 3, 6].includes(sentence) && rng() < 0.5) d[4] += rng() < 0.5 ? -1 : 1;
  return d.map((x) => clamp(x, -3, 8));
}

function composeCandidate(song, rng) {
  const theme = makeTheme(rng);
  const rhythmA = pick(rng, PHRASE_RHYTHMS);
  const rhythmB = pick(rng, PHRASE_RHYTHMS);
  const notes = [];
  const lo = song.tonicMidi + 7;
  const hi = song.tonicMidi + 24;

  for (let sentence = 0; sentence < song.bars / 4; sentence += 1) {
    const degrees = sentenceDegrees(theme, sentence, rng);
    for (let clause = 0; clause < 2; clause += 1) {
      const rhythm = clause ? rhythmB : rhythmA;
      const phraseBeat = sentence * 16 + clause * 8;
      for (let i = 0; i < 6; i += 1) {
        const degree = degrees[clause * 6 + i];
        const beat = phraseBeat + rhythm.at[i];
        let midi = degreeMidi(song.tonicMidi, song.mode, degree);
        // Only the held last syllable is harmonically anchored. Passing tones
        // remain melodic instead of being snapped into jagged chord tones.
        if (i === 5) {
          const bar = Math.min(song.bars - 1, Math.floor(beat / 4));
          midi = nearestStable(midi, song.chords[bar], lo, hi);
        }
        notes.push({
          midi: clamp(midi, lo, hi), beat, dur: rhythm.dur[i],
          vel: sentence === 5 ? 0.78 : (sentence >= 6 ? 0.56 : 0.65),
          phrase: sentence * 2 + clause,
          sourceIndex: clause * 6 + i,
        });
      }
    }
  }

  // One peak, late enough to feel earned. Neighbours approach and leave by step.
  const peak = notes.find((n) => n.phrase === 11 && n.sourceIndex === 1) ?? notes[0];
  peak.midi = hi;
  peak.vel = 0.84;
  for (const n of notes) if (n !== peak && n.midi >= hi) n.midi = hi - 2;
  const pi = notes.indexOf(peak);
  if (notes[pi - 1]) notes[pi - 1].midi = Math.min(notes[pi - 1].midi, hi - 2);
  if (notes[pi + 1]) notes[pi + 1].midi = hi - 2;

  const last = notes[notes.length - 1];
  last.midi = song.tonicMidi + 12;
  last.dur = Math.max(2, song.totalBeats - last.beat);
  last.vel = 0.48;
  return notes;
}

function critic(song, notes) {
  let score = 100;
  let close = 0; let leaps = 0; let repeats = 0; let maxLeap = 0;
  for (let i = 1; i < notes.length; i += 1) {
    const a = notes[i - 1]; const b = notes[i];
    const interval = Math.abs(b.midi - a.midi);
    const samePhrase = a.phrase === b.phrase;
    if (samePhrase && interval <= 2) close += 1;
    if (samePhrase && interval >= 5) leaps += 1;
    if (samePhrase && interval === 0) repeats += 1;
    if (samePhrase) maxLeap = Math.max(maxLeap, interval);
    if (samePhrase && interval > 9) score -= 18;
    if (!samePhrase && interval > 7) score -= (interval - 7) * 3;
  }
  const within = notes.length - 16;
  const closeRatio = close / Math.max(1, within);
  const leapRatio = leaps / Math.max(1, within);
  const repeatRatio = repeats / Math.max(1, within);
  score -= Math.abs(closeRatio - 0.68) * 45;
  score -= Math.abs(leapRatio - 0.10) * 55;
  score -= Math.abs(repeatRatio - 0.16) * 25;

  const pitches = notes.map((n) => n.midi);
  const range = Math.max(...pitches) - Math.min(...pitches);
  if (range < 9) score -= (9 - range) * 4;
  if (range > 17) score -= (range - 17) * 4;
  const max = Math.max(...pitches);
  if (pitches.filter((p) => p === max).length !== 1) score -= 20;

  let stableEnds = 0;
  for (const n of notes.filter((x) => x.sourceIndex % 6 === 5)) {
    const chord = song.chords[Math.min(song.bars - 1, Math.floor(n.beat / 4))];
    const root = chord?.rootPc ?? chord?.pcs?.[0];
    const rel = root === undefined ? 0 : (pc(n.midi) - root + 12) % 12;
    if ([0, 3, 4, 7].includes(rel)) stableEnds += 1;
  }
  score -= (16 - stableEnds) * 4;

  // A and its return must be recognisably related, not freshly randomised.
  const first = notes.filter((n) => n.phrase < 2).map((n) => n.midi - song.tonicMidi);
  const returnA = notes.filter((n) => n.phrase >= 12 && n.phrase < 14).map((n) => n.midi - song.tonicMidi);
  let motifDistance = 0;
  for (let i = 0; i < Math.min(first.length, returnA.length); i += 1) {
    motifDistance += Math.min(5, Math.abs(first[i] - returnA[i]));
  }
  score -= Math.abs(motifDistance - 12) * 0.7;

  if (pc(notes.at(-1).midi) !== pc(song.tonicMidi)) score -= 30;
  return { score, closeRatio, leapRatio, repeatRatio, range, maxLeap, stableEnds };
}

function descendingBass(song) {
  const out = [];
  let previous = null;
  for (let bar = 0; bar < song.bars; bar += 1) {
    const chord = song.chords[bar];
    const wanted = chord?.bassPc ?? chord?.rootPc ?? song.tonicMidi;
    const candidates = [];
    for (let m = 31; m <= 47; m += 1) if (pc(m) === pc(wanted)) candidates.push(m);
    let root = candidates[0] ?? song.tonicMidi - 12;
    if (previous !== null) root = candidates.sort((a, b) => Math.abs(a - previous) - Math.abs(b - previous))[0] ?? root;
    const approach = root - (bar % 4 === 3 ? 2 : 1);
    out.push({ midi: root, beat: bar * 4, dur: 2, vel: 0.38 });
    out.push({ midi: clamp(approach, 30, 47), beat: bar * 4 + 2, dur: 2, vel: 0.32 });
    previous = approach;
  }
  return out;
}

export function evaluateVocalSongV2(song) {
  return critic(song, song.melody);
}

export function composeVocalSongV2(seed, data, settings, composeFoundation) {
  const foundation = composeFoundation(seed, data, { ...settings, generatorVersion: '2' });
  const master = makeRng(seedFromString(`${seed}:codex-vocal-2`));
  let best = null;
  for (let i = 0; i < CANDIDATES; i += 1) {
    const candidateRng = makeRng(Math.floor(master() * 0xffffffff));
    const melody = composeCandidate(foundation, candidateRng);
    const quality = critic(foundation, melody);
    if (!best || quality.score > best.quality.score) best = { melody, quality };
  }
  const clean = best.melody.map(({ phrase, sourceIndex, ...note }) => note);
  return {
    ...foundation,
    melody: clean,
    bass: descendingBass(foundation),
    climaxBeat: clean.reduce((top, n) => (n.midi > top.midi ? n : top), clean[0]).beat,
    composerEngine: 'codex2',
    quality: best.quality,
  };
}
