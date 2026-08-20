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
// 品質の並びは長いものが先。'add9' より先に '9' を置くと 'Iadd9' が壊れる。
const CHORD_RE = /^(b?)([ivIV]+)(M7|sus4|add9|7|9)?(?:\/(3|5|7))?$/;

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
    // 9th。長三和音なら属九(V9)、短三和音ならマイナー9th(ii9)。どちらも7thは短7度。
    case '9': return [0, third, 7, 10, 14];
    default: throw new Error(`unknown quality: ${quality}`);
  }
}

export function chordSemitones(symbol, mode) {
  const c = parseChord(symbol);
  const root = degToSemitone(c.rootDeg, mode) - (c.flat ? 1 : 0);
  const ivs = intervalsFor(c);
  // 第3転回形(/7)は7thが最低音になる形。三和音のままでは7thが無いので短7度を補う。
  // V/7 は V7 の第3転回形(G7/F)、i/7 は i7 の第3転回形(Am7/G)。
  const withSeventh = c.inversion === 7 && ivs.length < 4 ? [...ivs, 10] : ivs;
  return withSeventh.map((i) => root + i);
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
//
// !!! 既存の要素の順序は絶対に変えないこと !!!
// melodies.json の fit / sus はこの配列の「添字」で保存されている。
// 途中に挿入したり並べ替えたりすると、全断片の適合情報が別のコードを指す。
// 追加は必ず末尾へ append する（末尾追加なら既存の添字は動かない）。
export const CHORD_VOCAB = {
  major: [
    // --- ここから20個は初版の並び。1つも動かさない ---
    'I', 'IM7', 'I/3', 'I/5', 'ii', 'ii7', 'iii', 'iii7',
    'IV', 'IVM7', 'IV/3', 'iv', 'V', 'V7', 'V/3', 'Vsus4',
    'vi', 'vi7', 'bVI', 'bVII',
    // --- ここから追加分 ---
    // セカンダリードミナント。大文字ローマ数字＋短7度で、根音の上に長三和音を積む。
    // 音階外の音（Cメジャーの III7 なら G#）が入るのが本質で、これが陰りを作る。
    'VI7',   // V/ii
    'VII7',  // V/iii
    'II7',   // V/V
    'III7',  // V/vi
    'I7',    // V/IV
    // 下降ベースライン用の転回形。
    'V/7',   // V7 の第3転回形(G7/F)
    'ii/3', 'vi/3', 'iii/3', 'IM7/3', 'IVM7/3',
    // テンション1つぶんの色。
    'ii9', 'V9',
  ],
  minor: [
    // --- ここから18個は初版の並び。1つも動かさない ---
    'i', 'i7', 'i/3', 'i/5', 'isus4', 'III', 'IIIM7', 'iv',
    'iv7', 'iv/3', 'v', 'v7', 'V', 'V7', 'VI', 'VIM7',
    'VI/3', 'VII',
    // --- ここから追加分 ---
    'II7',   // V/v
    'VII7',  // V/III
    'IV7',   // V/VII
    'i/7',   // i7 の第3転回形(Am7/G)
    'III/3', 'VII/3', 'iv/5',
    'iv9', 'V9',
  ],
};

export function chordIndex(mode, symbol) {
  return CHORD_VOCAB[mode].indexOf(symbol);
}

// 2小節(8拍)の断片を小節ごとに分け、beat を小節内ローカル(0〜4)へ直す。
export function splitBars(notes) {
  const first = [];
  const second = [];
  for (const n of notes) {
    // 食い（アンティシペーション）。小節線をまたいで鳴る音は、耳には
    // 「次の小節の頭の音が半拍早く出た」ものとして聴こえる。だから和声も
    // **次の**小節の和音で判定しなければならない。前の小節の和音で見ると、
    // この時代のバラードの推進力そのものが「和音に乗らない」と弾かれる。
    //
    // 初版（版1）の断片には、またぐ音は1つも無い。だからこの分岐は
    // 版1の判定を1ビットも変えない。
    if (n.beat < 4 && n.beat + n.dur > 4) {
      second.push({ ...n, beat: 0, dur: n.beat + n.dur - 4, anticipates: true });
      continue;
    }
    if (n.beat < 4) first.push({ ...n });
    else second.push({ ...n, beat: n.beat - 4 });
  }
  return [first, second];
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
