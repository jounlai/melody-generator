/** Codex vocal composer v3: a recognisable motif controls the whole song. */
import { makeRng, seedFromString, pick } from './rng.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MOTIFS = [
  [0, 0, 1, 2, 1, -1],
  [0, 2, 1, 0, -1, 0],
  [0, 1, 3, 2, 1, 0],
  [0, -1, 1, 2, 1, 0],
  [0, 1, 2, 1, -1, -2],
];

const R = {
  a: { at: [0.5, 1, 1.5, 2.5, 3, 3.5], dur: [0.5, 0.5, 1, 0.5, 0.5, 1.75] },
  answer: { at: [0, 1, 1.5, 2.5, 3.5, 4.5], dur: [1, 0.5, 1, 1, 1, 1.5] },
  loss: { at: [0.25, 0.75, 1.75, 2.25, 3.75, 4.75], dur: [0.5, 1, 0.5, 1.5, 1, 1.75] },
  bridge: { at: [0, 0.5, 1.5, 2.5, 3, 5], dur: [0.5, 1, 1, 0.5, 2, 1.5] },
  urgent: { at: [0.5, 1, 1.5, 2, 3, 4], dur: [0.5, 0.5, 0.5, 1, 1, 2] },
  coda: { at: [0, 1.5, 2, 3.5, 4.5, 5.5], dur: [1.5, 0.5, 1.5, 1, 1, 2] },
};

const FORM = [
  ['a', 'A', 0], ['answer', 'answer', 0],
  ['a', 'A', 0], ['coda', 'answer', -1],
  ['loss', 'Avar', -1], ['answer', 'answerVar', -1],
  ['urgent', 'A', 0], ['coda', 'answer', -2],
  ['bridge', 'B', 2], ['loss', 'Banswer', 1],
  ['urgent', 'B', 3], ['bridge', 'climax', 3],
  ['a', 'A', 0], ['answer', 'answer', 0],
  ['loss', 'Avar', -1], ['coda', 'final', -1],
];

const pc = (n) => ((Math.round(n) % 12) + 12) % 12;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function midiFor(tonic, mode, degree) {
  const scale = mode === 'major' ? MAJOR : MINOR;
  const oct = Math.floor(degree / 7);
  const idx = ((degree % 7) + 7) % 7;
  return tonic + 12 + oct * 12 + scale[idx];
}

function stable(target, chord, lo, hi) {
  if (!chord?.pcs?.length) return clamp(target, lo, hi);
  const root = chord.rootPc ?? chord.pcs[0];
  const pcs = chord.pcs.filter((p) => [0, 3, 4, 7].includes((p - root + 12) % 12));
  let best = null;
  for (let m = lo; m <= hi; m += 1) {
    if (!(pcs.length ? pcs : chord.pcs).includes(pc(m))) continue;
    if (best === null || Math.abs(m - target) < Math.abs(best - target)) best = m;
  }
  return best ?? clamp(target, lo, hi);
}

function phraseShape(kind, motif) {
  if (kind === 'A') return motif.slice();
  if (kind === 'Avar') return motif.map((x, i) => x + (i === 3 ? 1 : 0));
  if (kind === 'answer') return motif.map((x, i) => (i < 3 ? x : x - 1));
  if (kind === 'answerVar') return motif.map((x, i) => (i === 1 ? x + 1 : (i > 3 ? x - 1 : x)));
  if (kind === 'B') return motif.map((x, i) => (i === 0 ? 0 : -x + (i < 3 ? 1 : 2)));
  if (kind === 'Banswer') return motif.map((x, i) => -x + (i > 2 ? 1 : 0));
  if (kind === 'climax') return [0, 2, 3, 4, 2, 1];
  if (kind === 'final') return motif.map((x, i) => (i < 3 ? x : [0, -1, -2][i - 3]));
  return motif.slice();
}

function build(song, rng) {
  const motif = pick(rng, MOTIFS);
  const startDegree = 1 + Math.floor(rng() * 3);
  const lo = song.tonicMidi + 7; const hi = song.tonicMidi + 24;
  const notes = [];
  for (let phrase = 0; phrase < FORM.length; phrase += 1) {
    const [rhythmName, kind, shift] = FORM[phrase];
    const rhythm = R[rhythmName];
    const shape = phraseShape(kind, motif);
    for (let i = 0; i < 6; i += 1) {
      const beat = phrase * 8 + rhythm.at[i];
      let midi = midiFor(song.tonicMidi, song.mode, startDegree + shift + shape[i]);
      if (i === 5) midi = stable(midi, song.chords[Math.floor(beat / 4)], lo, hi);
      notes.push({ midi: clamp(midi, lo, hi), beat, dur: rhythm.dur[i], vel: phrase >= 8 && phrase < 12 ? 0.77 : (phrase >= 12 ? 0.56 : 0.65), phrase, index: i, rhythmName });
    }
  }
  const peak = notes.find((n) => n.phrase === 11 && n.index === 3);
  peak.midi = hi; peak.vel = 0.84;
  for (const n of notes) if (n !== peak && n.midi >= hi) n.midi = hi - 2;
  const last = notes.at(-1);
  last.midi = song.tonicMidi + 12; last.dur = song.totalBeats - last.beat; last.vel = 0.48;
  return notes;
}

function intervals(notes, phrase) {
  const p = notes.filter((n) => n.phrase === phrase);
  return p.slice(1).map((n, i) => n.midi - p[i].midi);
}

function similarity(a, b) {
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (Math.abs(a[i] - b[i]) <= 1) same += 1;
  return same / Math.max(1, Math.min(a.length, b.length));
}

function critique(song, notes) {
  const recurrence = (similarity(intervals(notes, 0), intervals(notes, 2)) + similarity(intervals(notes, 0), intervals(notes, 12))) / 2;
  const phraseRhythms = FORM.map(([r]) => r);
  const uniqueRhythms = new Set(phraseRhythms).size;
  const dominantRhythmRatio = Math.max(...[...new Set(phraseRhythms)].map((r) => phraseRhythms.filter((x) => x === r).length)) / phraseRhythms.length;
  let close = 0; let leaps = 0; let maxLeap = 0; let boundaries = 0;
  for (let i = 1; i < notes.length; i += 1) {
    const d = Math.abs(notes[i].midi - notes[i - 1].midi);
    if (notes[i].phrase === notes[i - 1].phrase) {
      if (d <= 2) close += 1;
      if (d >= 5) leaps += 1;
      maxLeap = Math.max(maxLeap, d);
    } else if (d > 7) boundaries += 1;
  }
  const within = notes.length - 16;
  const closeRatio = close / within; const leapRatio = leaps / within;
  const pitches = notes.map((n) => n.midi);
  const range = Math.max(...pitches) - Math.min(...pitches);
  const uniquePeak = pitches.filter((p) => p === Math.max(...pitches)).length === 1;
  let score = 45 + recurrence * 30 + uniqueRhythms * 3;
  score -= Math.abs(closeRatio - 0.68) * 35 + Math.abs(leapRatio - 0.1) * 35;
  score -= boundaries * 4 + Math.max(0, dominantRhythmRatio - 0.38) * 50;
  if (!uniquePeak) score -= 15;
  if (maxLeap > 9) score -= (maxLeap - 9) * 5;
  if (range < 9 || range > 17) score -= 10;
  return { score, recurrence, uniqueRhythms, dominantRhythmRatio, closeRatio, leapRatio, maxLeap, range, boundaries };
}

function bass(song) {
  const out = [];
  for (let bar = 0; bar < song.bars; bar += 1) {
    const wanted = song.chords[bar]?.bassPc ?? pc(song.tonicMidi);
    let root = 47 - (bar % 8);
    while (pc(root) !== pc(wanted)) root -= 1;
    while (root < 31) root += 12;
    out.push({ midi: root, beat: bar * 4, dur: 2, vel: 0.37 });
    out.push({ midi: clamp(root - 1, 30, 47), beat: bar * 4 + 2, dur: 2, vel: 0.31 });
  }
  return out;
}

export function composeVocalSongV3(seed, data, settings, foundationComposer) {
  const foundation = foundationComposer(seed, data, { ...settings, generatorVersion: '2' });
  const master = makeRng(seedFromString(`${seed}:codex-vocal-3`));
  let best = null;
  for (let i = 0; i < 40; i += 1) {
    const notes = build(foundation, makeRng(Math.floor(master() * 0xffffffff)));
    const quality = critique(foundation, notes);
    if (!best || quality.score > best.quality.score) best = { notes, quality };
  }
  const melody = best.notes.map(({ phrase, index, rhythmName, ...n }) => n);
  return { ...foundation, melody, bass: bass(foundation), composerEngine: 'codex3', quality: best.quality,
    climaxBeat: melody.reduce((top, n) => n.midi > top.midi ? n : top, melody[0]).beat };
}
