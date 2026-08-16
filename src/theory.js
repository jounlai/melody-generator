export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

export function scaleSteps(mode) {
  return mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
}

// deg は1起点の通しスケール度数。1=トニック, 8=1オクターブ上, 15=2オクターブ上。
export function degToSemitone(deg, mode) {
  const idx = deg - 1;
  const oct = Math.floor(idx / 7);
  const step = scaleSteps(mode)[((idx % 7) + 7) % 7];
  return oct * 12 + step;
}

export function degToMidi(deg, mode, tonicMidi) {
  return tonicMidi + degToSemitone(deg, mode);
}

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
const CHORD_RE = /^(b?)([ivIV]+)(M7|7|sus4|add9)?(?:\/(3|5|7))?$/;

export function parseChord(symbol) {
  const m = CHORD_RE.exec(symbol);
  if (!m) throw new Error(`unparsable chord: ${symbol}`);
  const [, flat, roman, quality = '', inv] = m;
  const rootDeg = ROMAN[roman.toUpperCase()];
  if (!rootDeg) throw new Error(`unknown roman: ${symbol}`);
  return {
    flat: flat === 'b',
    rootDeg,
    minor: roman !== roman.toUpperCase(),
    quality,
    inversion: inv ? Number(inv) : 0,
  };
}

function intervalsFor({ minor, quality }) {
  const third = minor ? 3 : 4;
  switch (quality) {
    case '': return [0, third, 7];
    case 'M7': return [0, third, 7, 11];
    case '7': return [0, third, 7, 10];
    case 'sus4': return [0, 5, 7];
    case 'add9': return [0, third, 7, 14];
    default: throw new Error(`unknown quality: ${quality}`);
  }
}

export function chordSemitones(symbol, mode) {
  const c = parseChord(symbol);
  const root = degToSemitone(c.rootDeg, mode) - (c.flat ? 1 : 0);
  return intervalsFor(c).map((i) => root + i);
}

export function chordPitchClasses(symbol, mode) {
  const pcs = chordSemitones(symbol, mode).map((s) => ((s % 12) + 12) % 12);
  return [...new Set(pcs)].sort((a, b) => a - b);
}

export function isChordTone(deg, mode, symbol) {
  const pc = ((degToSemitone(deg, mode) % 12) + 12) % 12;
  return chordPitchClasses(symbol, mode).includes(pc);
}

const INV_ROTATION = { 0: 0, 3: 1, 5: 2, 7: 3 };

// 転回形を反映し、最低音が [lowestMidi, lowestMidi+12) に入るよう移動する。
export function chordVoicing(symbol, mode, tonicMidi, lowestMidi = 48) {
  const c = parseChord(symbol);
  const semis = chordSemitones(symbol, mode);
  const rot = Math.min(INV_ROTATION[c.inversion] ?? 0, semis.length - 1);
  const rotated = semis.slice(rot).concat(semis.slice(0, rot).map((s) => s + 12));
  let shift = 0;
  const base = tonicMidi + rotated[0];
  while (base + shift < lowestMidi) shift += 12;
  while (base + shift >= lowestMidi + 12) shift -= 12;
  return rotated.map((s) => tonicMidi + s + shift);
}

export function bassMidi(symbol, mode, tonicMidi, lowestMidi = 36) {
  return chordVoicing(symbol, mode, tonicMidi, lowestMidi)[0];
}

// 断片の適合判定を事前計算するための語彙。progressions.json はこの範囲だけを使う。
export const CHORD_VOCAB = {
  major: [
    'I', 'IM7', 'I/3', 'I/5', 'ii', 'ii7', 'iii', 'iii7',
    'IV', 'IVM7', 'IV/3', 'iv', 'V', 'V7', 'V/3', 'Vsus4',
    'vi', 'vi7', 'bVI', 'bVII',
  ],
  minor: [
    'i', 'i7', 'i/3', 'i/5', 'isus4', 'III', 'IIIM7', 'iv',
    'iv7', 'iv/3', 'v', 'v7', 'V', 'V7', 'VI', 'VIM7',
    'VI/3', 'VII',
  ],
};

export function chordIndex(mode, symbol) {
  return CHORD_VOCAB[mode].indexOf(symbol);
}

// 2小節(8拍)の断片を小節ごとに分け、beat を小節内ローカル(0〜4)へ直す。
export function splitBars(notes) {
  return [
    notes.filter((n) => n.beat < 4).map((n) => ({ ...n })),
    notes.filter((n) => n.beat >= 4).map((n) => ({ ...n, beat: n.beat - 4 })),
  ];
}

// 強拍(0拍目・2拍目)または長い音(1.5拍以上)が非和声音なら、
// 次の音へ順次進行で解決していることを要求する。
export function fitsBar(barNotes, mode, chord) {
  if (barNotes.length === 0) return true;
  let anyChordTone = false;
  for (let i = 0; i < barNotes.length; i++) {
    const n = barNotes[i];
    const isTone = isChordTone(n.deg, mode, chord);
    if (isTone) anyChordTone = true;
    const exposed = n.beat % 2 === 0 || n.dur >= 1.5;
    if (exposed && !isTone) {
      const next = barNotes[i + 1];
      const resolves =
        next && Math.abs(next.deg - n.deg) <= 1 && isChordTone(next.deg, mode, chord);
      if (!resolves) return false;
    }
  }
  return anyChordTone;
}

// 小節頭の非和声音が順次下降でコードトーンへ解決する形（4-3、9-8）を検出する。
export function hasSuspension(barNotes, mode, chord) {
  for (let i = 0; i < barNotes.length - 1; i++) {
    const n = barNotes[i];
    if (n.beat !== 0) continue;
    if (isChordTone(n.deg, mode, chord)) continue;
    const next = barNotes[i + 1];
    if (next.deg === n.deg - 1 && isChordTone(next.deg, mode, chord)) return true;
  }
  return false;
}

export function nearestChordToneDeg(chord, mode, aroundDeg) {
  let best = aroundDeg;
  let bestDist = Infinity;
  for (let d = 1; d <= 15; d++) {
    if (!isChordTone(d, mode, chord)) continue;
    const dist = Math.abs(d - aroundDeg);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}
