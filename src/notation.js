/**
 * 大譜表（ト音記号＋ヘ音記号の2段）の楽譜をSVG文字列として描く。
 *
 * このファイルは DOM にも Web Audio にも触らない純関数だけで構成する。
 * 入力は compose.js が返す曲オブジェクト、出力は文字列と数値だけ。
 * 再生位置に追従したスクロールやハイライトは呼び出し側の担当で、
 * ここではそのための座標（barX / beatToX）と目印（data-* 属性）を提供する。
 *
 * 色は一切書かない。すべて currentColor で描き、ルート要素の color に
 * var(--score-ink, #ddd) を当ててあるので、ページ側は --score-ink か
 * .score { color: ... } のどちらでも色を変えられる。
 *
 * 記譜の方針:
 *   - メロディーはト音記号の段、伴奏とベースはヘ音記号の段。
 *   - pad は「音色のための持続音」であって声部ではないので描かない。
 *   - 音価は次の音までの間隔で頭打ちにする（伴奏の dur は 0.75 だが
 *     0.5 間隔で並ぶので、付点8分ではなく8分として描く）。
 */

// ---------------------------------------------------------------------------
// 音名まわりの基本表
// ---------------------------------------------------------------------------

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/** 幹音（変化記号なし）のピッチクラス */
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** C を 0 とする音名の通し番号（diatonicIndex の下1桁ぶん） */
const LETTER_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** 調号のシャープが付く順 */
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
/** 調号のフラットが付く順 */
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

const JP_LETTER = { C: 'ハ', D: 'ニ', E: 'ホ', F: 'ヘ', G: 'ト', A: 'イ', B: 'ロ' };

// ピッチクラス → [主音名, 調号の種類, 個数]。
// 同じ音でも慣用の綴りがあるので表で持つ（ピッチクラス10の長調は
// 変ロ長調＝フラット2つであって、嬰イ長調＝シャープ10個ではない）。
const MAJOR_KEYS = {
  0: ['C', 'none', 0],
  1: ['Db', 'flat', 5],
  2: ['D', 'sharp', 2],
  3: ['Eb', 'flat', 3],
  4: ['E', 'sharp', 4],
  5: ['F', 'flat', 1],
  6: ['F#', 'sharp', 6],
  7: ['G', 'sharp', 1],
  8: ['Ab', 'flat', 4],
  9: ['A', 'sharp', 3],
  10: ['Bb', 'flat', 2],
  11: ['B', 'sharp', 5],
};

// 短調は平行長調（短3度上）の調号をそのまま使う。
const MINOR_KEYS = {
  0: ['C', 'flat', 3],
  1: ['C#', 'sharp', 4],
  2: ['D', 'flat', 1],
  3: ['Eb', 'flat', 6],
  4: ['E', 'sharp', 1],
  5: ['F', 'flat', 4],
  6: ['F#', 'sharp', 3],
  7: ['G', 'flat', 2],
  8: ['G#', 'sharp', 5],
  9: ['A', 'none', 0],
  10: ['Bb', 'flat', 5],
  11: ['B', 'sharp', 2],
};

function pitchClass(midi) {
  const m = Math.round(Number(midi));
  if (!Number.isFinite(m)) return 0;
  return ((m % 12) + 12) % 12;
}

function keyLabel(tonicName, mode) {
  const letter = tonicName[0];
  const sign = tonicName.length > 1 ? (tonicName[1] === '#' ? '嬰' : '変') : '';
  return `${sign}${JP_LETTER[letter]}${mode === 'minor' ? '短調' : '長調'}`;
}

/**
 * 主音のMIDIノート番号と旋法から調を決める。
 * @param {number} tonicMidi 主音（オクターブは問わない）
 * @param {'major'|'minor'} mode
 * @returns {{ tonicName: string, accidental: 'sharp'|'flat'|'none', count: number, label: string }}
 */
export function keySignature(tonicMidi, mode) {
  const table = mode === 'minor' ? MINOR_KEYS : MAJOR_KEYS;
  const [tonicName, accidental, count] = table[pitchClass(tonicMidi)];
  return { tonicName, accidental, count, label: keyLabel(tonicName, mode) };
}

// 調号ごとの「どの音名が何半音動くか」。曲中で何度も引くので覚えておく。
const ALTER_CACHE = new Map();

function keyAlterations(key) {
  const kind = key?.accidental ?? 'none';
  const count = Math.max(0, Math.min(7, Math.round(Number(key?.count) || 0)));
  const cacheKey = `${kind}${count}`;
  const hit = ALTER_CACHE.get(cacheKey);
  if (hit) return hit;
  const map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (kind === 'sharp') for (let i = 0; i < count; i++) map[SHARP_ORDER[i]] = 1;
  if (kind === 'flat') for (let i = 0; i < count; i++) map[FLAT_ORDER[i]] = -1;
  ALTER_CACHE.set(cacheKey, map);
  return map;
}

/** 主音名 'Bb' などからピッチクラスを戻す */
function tonicPcOf(key) {
  const name = String(key?.tonicName ?? 'C');
  const base = LETTER_PC[name[0]] ?? 0;
  const sign = name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0;
  return ((base + sign) % 12 + 12) % 12;
}

/** 主音の1つ下の音名（導音を綴るときに使う） */
function leadingLetterOf(key) {
  const name = String(key?.tonicName ?? 'C');
  const idx = LETTER_INDEX[name[0]] ?? 0;
  return LETTERS[(idx + 6) % 7];
}

/**
 * MIDIノート番号を、その調のなかでの綴りに直す。
 *
 * 優先順位:
 *   0. 調の音階に入っている音       → 臨時記号は書かない（調号が担当）
 *   0.5 短調の導音                  → 主音の1つ下の音名で綴る（ニ短調なら変ニではなく嬰ハ）
 *   1. 調号で変化させた音を戻す音   → ナチュラル
 *   2. それ以外                     → シャープ系ならシャープ、フラット系ならフラット
 *
 * @param {number} midi
 * @param {ReturnType<typeof keySignature>} key
 * @returns {{ letter: string, octave: number, accidental: ''|'#'|'b'|'n', diatonicIndex: number }}
 */
export function spellNote(midi, key) {
  const m = Math.round(Number(midi));
  const pc = pitchClass(m);
  const alter = keyAlterations(key);
  const preferSharp = (key?.accidental ?? 'none') !== 'flat';
  const tonicPc = tonicPcOf(key);
  const isLeading = pc === (tonicPc + 11) % 12;
  const leadingLetter = leadingLetterOf(key);

  let best = null;
  for (const letter of LETTERS) {
    for (const a of [0, 1, -1]) {
      if ((((LETTER_PC[letter] + a) % 12) + 12) % 12 !== pc) continue;
      const ka = alter[letter];
      let printed;
      let rank;
      if (a === ka) {
        printed = '';
        rank = 0;
      } else if (a === 0) {
        printed = 'n';
        rank = 1;
      } else if (a === 1) {
        printed = '#';
        rank = preferSharp ? 2 : 3;
      } else {
        printed = 'b';
        rank = preferSharp ? 3 : 2;
      }
      if (rank > 0 && isLeading && letter === leadingLetter) rank = 0.5;
      if (!best || rank < best.rank) best = { letter, a, printed, rank };
    }
  }

  const octave = Math.round((m - best.a - LETTER_PC[best.letter]) / 12) - 1;
  return {
    letter: best.letter,
    octave,
    accidental: best.printed,
    diatonicIndex: octave * 7 + LETTER_INDEX[best.letter],
  };
}

// ---------------------------------------------------------------------------
// 音価
// ---------------------------------------------------------------------------

/** [拍数, 符頭, 付点] を長い順に並べたもの */
const DURATIONS = [
  [4, 'whole', 0],
  [3, 'half', 1],
  [2, 'half', 0],
  [1.5, 'quarter', 1],
  [1, 'quarter', 0],
  [0.75, 'eighth', 1],
  [0.5, 'eighth', 0],
  [0.25, 'sixteenth', 0],
];

const DUR_EPS = 1e-9;

/**
 * 拍数を符頭と付点に直す。表に無い長さは「最も近い小さい方」に丸める
 * （描画が破綻しないことを優先する）。
 * @param {number} beats
 * @returns {{ head: 'whole'|'half'|'quarter'|'eighth'|'sixteenth', dots: 0|1 }}
 */
export function durationSymbol(beats) {
  const b = Number(beats);
  if (!Number.isFinite(b)) return { head: 'quarter', dots: 0 };
  for (const [value, head, dots] of DURATIONS) {
    if (b >= value - DUR_EPS) return { head, dots };
  }
  return { head: 'sixteenth', dots: 0 };
}

/** durationSymbol と同じ丸めをしたうえで、実際に描く拍数を返す */
function notatedBeats(beats) {
  const b = Number(beats);
  if (!Number.isFinite(b)) return 1;
  for (const [value] of DURATIONS) {
    if (b >= value - DUR_EPS) return value;
  }
  return 0.25;
}

// ---------------------------------------------------------------------------
// 小節線での分割
// ---------------------------------------------------------------------------

/**
 * 小節線をまたぐ音をタイで繋げる形に分割する。
 * 分割後の断片は元の音のプロパティを引き継ぎ、beat / dur だけが書き換わる。
 * @param {Array<{beat:number,dur:number}>} notes
 * @param {number} beatsPerBar
 * @returns {Array<object & { tieToNext: boolean, tieFromPrev: boolean }>}
 */
export function splitAtBarlines(notes, beatsPerBar) {
  const bar = Number(beatsPerBar) > 0 ? Number(beatsPerBar) : 4;
  const out = [];
  for (const note of notes ?? []) {
    const start = Number(note.beat);
    const total = Number(note.dur);
    if (!Number.isFinite(start) || !Number.isFinite(total) || total <= DUR_EPS) {
      out.push({ ...note, tieToNext: false, tieFromPrev: false });
      continue;
    }
    let pos = start;
    let left = total;
    let fromPrev = false;
    while (left > DUR_EPS) {
      const barEnd = (Math.floor(pos / bar + DUR_EPS) + 1) * bar;
      const dur = Math.min(left, barEnd - pos);
      left -= dur;
      out.push({ ...note, beat: pos, dur, tieToNext: left > DUR_EPS, tieFromPrev: fromPrev });
      pos += dur;
      fromPrev = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// SVG の小道具
// ---------------------------------------------------------------------------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** 座標は小数3桁まで。0.30000000000000004 のような値を吐かないため */
function num(value) {
  const v = Math.round(Number(value) * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
}

function line(x1, y1, x2, y2, attrs = '') {
  return `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"${attrs}/>`;
}

function path(d, attrs = '') {
  return `<path d="${d}"${attrs}/>`;
}

function dot(cx, cy, r) {
  return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="currentColor" stroke="none"/>`;
}

// ---------------------------------------------------------------------------
// 記号の字形（フォントに頼らず全部その場で描く）
// ---------------------------------------------------------------------------

/**
 * ト音記号。cy は第2線（ト音＝G4）の高さ。
 * 渦の中心を G4 に置き、そこから外へ 1.4 回転ぶんの対数螺旋を伸ばす。
 * 螺旋は式で点を生成するので、手で置いた制御点より形が崩れない。
 */
function trebleClef(cx, cy) {
  const pts = [];
  const r0 = 11;
  const r1 = 0.9;
  const from = 110;
  const to = -400;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const deg = from + (to - from) * t;
    const rad = (deg * Math.PI) / 180;
    const r = r0 * Math.pow(r1 / r0, t);
    pts.push(`${num(cx + r * Math.cos(rad))} ${num(cy - r * Math.sin(rad))}`);
  }
  const spiral = pts.map((p, i) => (i === 0 ? `M ${p}` : `L ${p}`)).join(' ');
  const stroke = ' fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  // 下の尾 → 縦棒 → 上の巻き → 螺旋の入口、をひと筆で繋ぐ
  const body = [
    `M ${num(cx - 6)} ${num(cy + 16.5)}`,
    `C ${num(cx - 7.5)} ${num(cy + 21)} ${num(cx - 1)} ${num(cy + 22.5)} ${num(cx + 2.5)} ${num(cy + 17)}`,
    `C ${num(cx + 3.5)} ${num(cy + 8)} ${num(cx + 1)} ${num(cy - 8)} ${num(cx + 2)} ${num(cy - 30)}`,
    `C ${num(cx + 1)} ${num(cy - 34.5)} ${num(cx - 6)} ${num(cy - 34.5)} ${num(cx - 7)} ${num(cy - 27)}`,
    `C ${num(cx - 8)} ${num(cy - 20)} ${num(cx - 6.5)} ${num(cy - 14)} ${num(cx - 3.76)} ${num(cy - 10.34)}`,
  ].join(' ');
  return `<g class="clef" data-clef="treble">${path(body, stroke)}${path(spiral, stroke)}</g>`;
}

/** ヘ音記号。cy は第4線（ヘ音＝F3）の高さ */
function bassClef(x, cy) {
  const stroke = ' fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  const body = [
    `M ${num(x - 1)} ${num(cy - 3)}`,
    `C ${num(x + 4)} ${num(cy - 9)} ${num(x + 12)} ${num(cy - 4.5)} ${num(x + 11)} ${num(cy + 3)}`,
    `C ${num(x + 10)} ${num(cy + 11)} ${num(x + 3)} ${num(cy + 15)} ${num(x - 4)} ${num(cy + 17)}`,
  ].join(' ');
  return `<g class="clef" data-clef="bass">${dot(x - 1.5, cy, 3.2)}${path(body, stroke)}`
    + `${dot(x + 15, cy - 4, 1.5)}${dot(x + 15, cy + 4, 1.5)}</g>`;
}

/** シャープ。(x, y) は記号の中心 */
function sharpGlyph(x, y) {
  const thin = ' fill="none" stroke="currentColor" stroke-width="1"';
  const thick = ' fill="none" stroke="currentColor" stroke-width="1.9"';
  return line(x - 1.8, y - 6.5, x - 1.8, y + 5.5, thin)
    + line(x + 1.8, y - 5.5, x + 1.8, y + 6.5, thin)
    + line(x - 4.4, y - 1.2, x + 4.4, y - 3.2, thick)
    + line(x - 4.4, y + 3.8, x + 4.4, y + 1.8, thick);
}

/** フラット。(x, y) は音符の高さ（玉の中心） */
function flatGlyph(x, y) {
  const stroke = ' fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"';
  const d = `M ${num(x - 2)} ${num(y - 9)} L ${num(x - 2)} ${num(y + 4)}`
    + ` C ${num(x + 3.5)} ${num(y + 0.5)} ${num(x + 3.5)} ${num(y - 4)} ${num(x - 2)} ${num(y - 1.5)}`;
  return path(d, stroke);
}

/** ナチュラル */
function naturalGlyph(x, y) {
  const thin = ' fill="none" stroke="currentColor" stroke-width="1"';
  const thick = ' fill="none" stroke="currentColor" stroke-width="1.8"';
  return line(x - 2, y - 7.5, x - 2, y + 3.5, thin)
    + line(x + 2, y - 3.5, x + 2, y + 7.5, thin)
    + line(x - 2, y - 2, x + 2, y - 3.5, thick)
    + line(x - 2, y + 3.5, x + 2, y + 2, thick);
}

function accidentalGlyph(kind, x, y) {
  const body = kind === '#' ? sharpGlyph(x, y)
    : kind === 'b' ? flatGlyph(x, y)
    : kind === 'n' ? naturalGlyph(x, y)
    : '';
  return body ? `<g class="accidental" data-acc="${kind}">${body}</g>` : '';
}

/** 符頭。楕円を -20 度傾ける */
function noteHead(cx, cy, filled) {
  const rx = filled ? 5 : 5.2;
  const ry = filled ? 3.7 : 3.8;
  const paint = filled
    ? ' fill="currentColor" stroke="none"'
    : ' fill="none" stroke="currentColor" stroke-width="1.5"';
  return `<ellipse class="notehead" cx="${num(cx)}" cy="${num(cy)}" rx="${num(rx)}" ry="${num(ry)}"`
    + ` transform="rotate(-20 ${num(cx)} ${num(cy)})"${paint}/>`;
}

/** 全音符は少し横長の空洞。傾きは同じ */
function wholeHead(cx, cy) {
  return `<ellipse class="notehead" cx="${num(cx)}" cy="${num(cy)}" rx="6.2" ry="3.9"`
    + ` transform="rotate(-20 ${num(cx)} ${num(cy)})" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
}

/**
 * 旗。(sx, ty) は符尾の先端、dir=1 なら上向き符尾（旗は下へ垂れる）。
 * 連桁は使わず旗で通す。8分と4分が見分けられれば要件は満たす。
 */
function flagGlyph(sx, ty, dir) {
  const y = (dy) => ty + dir * dy;
  const d = `M ${num(sx)} ${num(ty)}`
    + ` C ${num(sx + 8)} ${num(y(4))} ${num(sx + 8.5)} ${num(y(11))} ${num(sx + 1.5)} ${num(y(16))}`
    + ` C ${num(sx + 6)} ${num(y(10))} ${num(sx + 5.5)} ${num(y(5))} ${num(sx)} ${num(y(2.5))} Z`;
  return path(d, ' class="flag" fill="currentColor" stroke="none"');
}

// ---------------------------------------------------------------------------
// レイアウトの既定値
// ---------------------------------------------------------------------------

const DEFAULT_LAYOUT = {
  barWidth: 200,      // 1小節の幅。8分音符8個が並んでも潰れない
  staffSpace: 8,      // 五線の線間（五線の高さは 32）
  staffGap: 64,       // ト音記号の第1線とヘ音記号の第5線の間隔
  topPad: 52,         // 小節番号と高い音の加線のぶん
  bottomPad: 40,
  leftPad: 6,
  rightPad: 16,
  noteInset: 10,      // 小節線に音符がめり込まないよう内側へ寄せる量
  stemLength: 28,
  clefWidth: 26,
  accidentalWidth: 9, // 調号1つあたりの幅
  keyGap: 12,         // 調号と最初の小節線の間
};

/** 調号の位置。ト音記号での diatonicIndex（ヘ音記号は 14 引く＝2オクターブ下） */
const SHARP_ROWS = [38, 35, 39, 36, 33, 37, 34];
const FLAT_ROWS = [34, 37, 33, 36, 32, 35, 31];

const BEATS_PER_BAR = 4;

// ---------------------------------------------------------------------------
// 楽譜本体
// ---------------------------------------------------------------------------

/**
 * 曲をSVGの楽譜にする。
 *
 * @param {object} song composeSong の戻り値
 * @param {object} [options] DEFAULT_LAYOUT を上書きする値
 * @returns {{ svg: string, width: number, height: number, barX: number[], beatToX: (beat:number)=>number }}
 */
export function renderScore(song, options = {}) {
  const L = { ...DEFAULT_LAYOUT, ...(options || {}) };
  const step = L.staffSpace / 2;

  const bars = Math.max(1, Math.round(Number(song?.bars)) || 1);
  const totalBeats = Number(song?.totalBeats) > 0 ? Number(song.totalBeats) : bars * BEATS_PER_BAR;
  const key = keySignature(song?.tonicMidi ?? 60, song?.mode);

  // ---- 横位置 ----
  const clefX = L.leftPad + 10;
  const keyX = clefX + L.clefWidth;
  const barX = [];
  const originX = keyX + key.count * L.accidentalWidth + L.keyGap;
  for (let i = 0; i <= bars; i++) barX.push(originX + i * L.barWidth);
  const width = barX[bars] + L.rightPad;

  // barX の間を線形補間する。beatToX(0) と beatToX(totalBeats) は
  // それぞれ barX の両端にきっちり一致する。
  const beatToX = (beat) => {
    const pos = (Number(beat) || 0) / BEATS_PER_BAR;
    const i = Math.max(0, Math.min(bars - 1, Math.floor(pos)));
    return barX[i] + (pos - i) * (barX[i + 1] - barX[i]);
  };

  // ---- 縦位置 ----
  const trebleTop = L.topPad;
  const trebleBottom = trebleTop + 4 * L.staffSpace;
  const bassTop = trebleBottom + L.staffGap;
  const bassBottom = bassTop + 4 * L.staffSpace;
  const height = bassBottom + L.bottomPad;

  const TREBLE = { name: 'treble', topY: trebleTop, topIndex: 38, midIndex: 34, bottomIndex: 30 };
  const BASS = { name: 'bass', topY: bassTop, topIndex: 26, midIndex: 22, bottomIndex: 18 };
  const yOf = (staff, diatonicIndex) => staff.topY + (staff.topIndex - diatonicIndex) * step;

  const out = [];

  // ---- 五線 ----
  const staffLine = ' class="staff-line" stroke="currentColor" stroke-width="1"';
  for (const staff of [TREBLE, BASS]) {
    for (let i = 0; i < 5; i++) {
      const y = staff.topY + i * L.staffSpace;
      out.push(line(L.leftPad, y, barX[bars], y, staffLine));
    }
  }
  out.push(line(L.leftPad, trebleTop, L.leftPad, bassBottom, ' class="system-line" stroke="currentColor" stroke-width="1.6"'));

  // ---- 音部記号と調号 ----
  out.push(trebleClef(clefX + 8, yOf(TREBLE, 32)));
  out.push(bassClef(clefX + 4, yOf(BASS, 24)));

  if (key.count > 0) {
    const rows = key.accidental === 'flat' ? FLAT_ROWS : SHARP_ROWS;
    const kind = key.accidental === 'flat' ? 'b' : '#';
    const glyphs = [];
    for (let i = 0; i < key.count; i++) {
      const x = keyX + i * L.accidentalWidth + 4;
      glyphs.push(accidentalGlyph(kind, x, yOf(TREBLE, rows[i])));
      glyphs.push(accidentalGlyph(kind, x, yOf(BASS, rows[i] - 14)));
    }
    out.push(`<g class="key-signature">${glyphs.join('')}</g>`);
  }

  out.push(`<text class="key-label" x="${num(L.leftPad)}" y="${num(L.topPad - 36)}"`
    + ` font-size="11" fill="currentColor" stroke="none">${esc(key.label)}</text>`);

  // ---- 小節線と小節番号 ----
  for (let i = 0; i < bars; i++) {
    out.push(line(barX[i], trebleTop, barX[i], bassBottom,
      ` class="barline" data-bar="${i}" stroke="currentColor" stroke-width="1"`));
    out.push(`<text class="bar-number" x="${num(barX[i] + 3)}" y="${num(L.topPad - 36)}"`
      + ` font-size="10" fill="currentColor" stroke="none">${i + 1}</text>`);
  }
  // 終止線（細い線＋太い線）
  out.push(line(barX[bars] - 6, trebleTop, barX[bars] - 6, bassBottom,
    ` class="barline" data-bar="${bars}" stroke="currentColor" stroke-width="1"`));
  out.push(line(barX[bars] - 1.5, trebleTop, barX[bars] - 1.5, bassBottom,
    ` class="barline" data-bar="${bars}" stroke="currentColor" stroke-width="3"`));

  // ---- 音符 ----
  const noteSvg = [];
  const tieSvg = [];
  const occupied = { treble: [], bass: [] };
  // 段ごと・小節ごとの臨時記号の有効範囲。同じ小節の同じ高さでは1回しか書かない。
  const activeAccidentals = { treble: new Map(), bass: new Map() };
  const alterOfKey = keyAlterations(key);

  const layers = [
    { name: 'melody', staff: TREBLE, notes: song?.melody, stem: 'auto' },
    { name: 'accomp', staff: BASS, notes: song?.accomp, stem: 'up' },
    { name: 'bass', staff: BASS, notes: song?.bass, stem: 'down' },
  ];

  for (const layer of layers) {
    const source = prepareLayer(layer.notes, totalBeats);
    const segments = splitAtBarlines(source, BEATS_PER_BAR);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      occupied[layer.staff.name].push([seg.beat, seg.beat + seg.dur]);
      const drawn = drawNote(seg, layer, i, segments);
      noteSvg.push(drawn.svg);
      if (drawn.tie) tieSvg.push(drawn.tie);
    }
  }

  /** 1つの音（和音なら複数の玉）を描く */
  function drawNote(seg, layer, index, segments) {
    const staff = layer.staff;
    const sym = durationSymbol(seg.dur);
    const x = beatToX(seg.beat) + L.noteInset;
    const midis = Array.isArray(seg.midis) && seg.midis.length > 0 ? seg.midis : [seg.midi];
    const spelled = midis
      .map((m) => ({ midi: Math.round(Number(m)), ...spellNote(m, key) }))
      .sort((a, b) => a.diatonicIndex - b.diatonicIndex);

    const lowest = spelled[0];
    const highest = spelled[spelled.length - 1];
    const stemUp = layer.stem === 'up' ? true
      : layer.stem === 'down' ? false
      : (lowest.diatonicIndex + highest.diatonicIndex) / 2 < staff.midIndex;

    const bar = Math.floor(seg.beat / BEATS_PER_BAR + DUR_EPS);
    const body = [];
    const ledgerYs = new Set();
    for (const sp of spelled) {
      const y = yOf(staff, sp.diatonicIndex);
      for (let idx = staff.topIndex + 2; idx <= sp.diatonicIndex; idx += 2) ledgerYs.add(yOf(staff, idx));
      for (let idx = staff.bottomIndex - 2; idx >= sp.diatonicIndex; idx -= 2) ledgerYs.add(yOf(staff, idx));
      const printed = accidentalToPrint(staff, bar, sp, seg.tieFromPrev);
      if (printed) body.push(accidentalGlyph(printed, x - 12, y));
      body.push(sym.head === 'whole' ? wholeHead(x, y) : noteHead(x, y, sym.head !== 'half'));
      if (sym.dots > 0) {
        const onLine = ((sp.diatonicIndex % 2) + 2) % 2 === 0;
        body.push(dot(x + 10, onLine ? y - step : y, 1.6));
      }
    }
    const ledgers = [...ledgerYs].map((y) =>
      line(x - 8, y, x + 8, y, ' class="ledger" stroke="currentColor" stroke-width="1"'));

    let stemTipY = null;
    if (sym.head !== 'whole') {
      const stemX = stemUp ? x + 4.6 : x - 4.6;
      const from = stemUp ? yOf(staff, lowest.diatonicIndex) : yOf(staff, highest.diatonicIndex);
      stemTipY = stemUp
        ? yOf(staff, highest.diatonicIndex) - L.stemLength
        : yOf(staff, lowest.diatonicIndex) + L.stemLength;
      body.push(line(stemX, from, stemX, stemTipY, ' class="stem" stroke="currentColor" stroke-width="1.3"'));
      const dir = stemUp ? 1 : -1;
      if (sym.head === 'eighth') body.push(flagGlyph(stemX, stemTipY, dir));
      if (sym.head === 'sixteenth') {
        body.push(flagGlyph(stemX, stemTipY, dir));
        body.push(flagGlyph(stemX, stemTipY + dir * 7, dir));
      }
    }

    const svg = `<g class="note" data-layer="${layer.name}" data-beat="${num(seg.beat)}"`
      + ` data-dur="${num(seg.dur)}">${ledgers.join('')}${body.join('')}</g>`;

    // タイ。分割された断片は splitAtBarlines の出力で必ず隣り合う。
    let tie = null;
    const next = segments[index + 1];
    if (seg.tieToNext && next) {
      const y1 = yOf(staff, lowest.diatonicIndex);
      const nextSpelled = spellNote(
        Array.isArray(next.midis) && next.midis.length > 0 ? Math.min(...next.midis) : next.midi, key);
      const y2 = yOf(staff, nextSpelled.diatonicIndex);
      const x2 = beatToX(next.beat) + L.noteInset;
      const bulge = stemUp ? 9 : -9;
      const d = `M ${num(x + 6)} ${num(y1 + bulge * 0.35)}`
        + ` Q ${num((x + x2) / 2)} ${num((y1 + y2) / 2 + bulge)} ${num(x2 - 6)} ${num(y2 + bulge * 0.35)}`;
      tie = path(d, ' class="tie" fill="none" stroke="currentColor" stroke-width="1.2"');
    }
    return { svg, tie };
  }

  /**
   * 実際に印字する臨時記号を決める。
   * 同じ小節の同じ高さでは1回だけ書き、直前に効いている変化とずれたときだけ書き直す
   * （ハ長調で C# のあとに C が来たらナチュラルを書く、という規則）。
   */
  function accidentalToPrint(staff, bar, sp, tieFromPrev) {
    const alter = sp.midi - (sp.octave + 1) * 12 - LETTER_PC[sp.letter];
    const map = activeAccidentals[staff.name];
    const mapKey = `${bar}:${sp.diatonicIndex}`;
    const current = map.has(mapKey) ? map.get(mapKey) : alterOfKey[sp.letter];
    map.set(mapKey, alter);
    if (tieFromPrev || alter === current) return '';
    return alter === 0 ? 'n' : alter > 0 ? '#' : 'b';
  }

  // ---- 休符 ----
  const restSvg = [];
  for (const staff of [TREBLE, BASS]) {
    for (const rest of restsFor(occupied[staff.name], bars)) {
      restSvg.push(restGlyph(rest, staff));
    }
  }

  function restGlyph(rest, staff) {
    const midY = yOf(staff, staff.midIndex);
    const g = [];
    if (rest.head === 'whole') {
      const x = beatToX(rest.beat + 2) - 5.5;
      const y = yOf(staff, staff.topIndex - 2);
      g.push(`<rect x="${num(x)}" y="${num(y)}" width="11" height="4" fill="currentColor" stroke="none"/>`);
    } else if (rest.head === 'half') {
      const x = beatToX(rest.beat) + L.noteInset - 5.5;
      g.push(`<rect x="${num(x)}" y="${num(midY - 4)}" width="11" height="4" fill="currentColor" stroke="none"/>`);
    } else if (rest.head === 'quarter') {
      const x = beatToX(rest.beat) + L.noteInset;
      const d = `M ${num(x - 3)} ${num(midY - 8.5)} L ${num(x + 2.5)} ${num(midY - 3)}`
        + ` L ${num(x - 3)} ${num(midY + 1.5)} L ${num(x + 3)} ${num(midY + 7.5)}`
        + ` C ${num(x - 2)} ${num(midY + 4.5)} ${num(x - 4)} ${num(midY + 8.5)} ${num(x + 1)} ${num(midY + 10.5)}`;
      g.push(path(d, ' fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"'));
    } else {
      // 8分・16分休符。斜めの棒に玉を付ける
      const x = beatToX(rest.beat) + L.noteInset;
      const two = rest.head === 'sixteenth';
      const top = two ? midY - 7 : midY - 5;
      const bottom = two ? midY + 7 : midY + 5;
      g.push(line(x + 3, top, x - 3.5, bottom,
        ' fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"'));
      g.push(dot(x + 0.5, top + 0.5, 1.8));
      if (two) g.push(dot(x - 1.5, top + 6, 1.8));
    }
    return `<g class="rest" data-staff="${staff.name}" data-beat="${num(rest.beat)}"`
      + ` data-dur="${num(rest.dur)}">${g.join('')}</g>`;
  }

  out.push(`<g class="rests">${restSvg.join('')}</g>`);
  out.push(`<g class="notes">${noteSvg.join('')}</g>`);
  out.push(`<g class="ties">${tieSvg.join('')}</g>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="score" role="img"`
    + ` viewBox="0 0 ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}"`
    + ` style="color: var(--score-ink, #ddd)" fill="none" stroke="none"`
    + ` font-family="system-ui, sans-serif">${out.join('')}</svg>`;

  return { svg, width, height, barX, beatToX };
}

/**
 * 描く直前の下ごしらえ。
 *   - 曲の終端からはみ出す音を切り詰める（最後の音は次の曲へ食い込む長さを持つ）
 *   - 次の音までの間隔で音価を頭打ちにし、表にある長さへ丸める
 */
function prepareLayer(notes, totalBeats) {
  const src = (Array.isArray(notes) ? notes : [])
    .filter((n) => Number.isFinite(Number(n?.beat)) && Number(n.beat) < totalBeats - DUR_EPS)
    .slice()
    .sort((a, b) => a.beat - b.beat);
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const note = src[i];
    const beat = Number(note.beat);
    let dur = Number(note.dur);
    if (!Number.isFinite(dur) || dur <= 0) dur = 0.25;
    dur = Math.min(dur, totalBeats - beat);
    const next = src[i + 1];
    if (next) {
      const gap = Number(next.beat) - beat;
      if (gap > DUR_EPS) dur = Math.min(dur, gap);
    }
    out.push({ ...note, beat, dur: notatedBeats(dur) });
  }
  return out;
}

/**
 * 音が鳴っていない区間に置く休符を求める。
 * 拍のまとまりの厳密な規則までは追わず、「その位置に置ける最大の休符」を
 * 拍の頭から順に敷き詰める（読んで違和感がない程度で十分）。
 */
function restsFor(intervals, bars) {
  const rests = [];
  // まず鳴っている区間をひと続きにまとめる
  const merged = [];
  for (const [a, b] of intervals.slice().sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + DUR_EPS) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }

  for (let bar = 0; bar < bars; bar++) {
    const start = bar * BEATS_PER_BAR;
    const end = start + BEATS_PER_BAR;
    const gaps = [];
    let pos = start;
    for (const [a, b] of merged) {
      if (b <= start + DUR_EPS) continue;
      if (a >= end - DUR_EPS) break;
      const from = Math.max(a, start);
      if (from - pos > DUR_EPS) gaps.push([pos, from]);
      pos = Math.max(pos, Math.min(b, end));
    }
    if (end - pos > DUR_EPS) gaps.push([pos, end]);

    for (const [from, to] of gaps) {
      if (from <= start + DUR_EPS && to >= end - DUR_EPS) {
        rests.push({ beat: start, dur: BEATS_PER_BAR, head: 'whole' });
        continue;
      }
      let p = from;
      let guard = 0;
      while (to - p > 0.125 + DUR_EPS && guard++ < 32) {
        let picked = 0;
        for (const cand of [2, 1, 0.5, 0.25]) {
          const aligned = Math.abs(p / cand - Math.round(p / cand)) < 1e-6;
          if (cand <= to - p + DUR_EPS && aligned) {
            picked = cand;
            break;
          }
        }
        if (!picked) break;
        rests.push({ beat: p, dur: picked, head: durationSymbol(picked).head });
        p += picked;
      }
    }
  }
  return rests;
}
