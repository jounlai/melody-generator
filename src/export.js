/**
 * 生成した曲を「他の人に渡せる標準形式」で書き出す。
 *
 *   MusicXML — 楽譜交換の標準。MuseScore / Finale / Sibelius / Dorico で開ける
 *   MIDI     — 音として鳴らす・DAWで編集する標準形式
 *
 * このファイルは DOM にも Web Audio にも触らない純関数だけで構成する。
 * 入力は compose.js が返す曲オブジェクト、出力は文字列と Uint8Array だけ。
 *
 * 記譜の規則（音名の綴り・音価・小節線での分割）は notation.js を使う。
 * あちらはテスト済みなので、ここで作り直さない。
 *
 * 書き出しの方針:
 *   - 演奏の揺らぎ（perform.js）は掛けない。楽譜として見る／編集するためのものなので、
 *     クオンタイズされた素の値をそのまま書く。
 *   - pad は書き出さない。音色のための持続音であって声部ではない。
 *   - 音価は次の打点までで頭打ちにする（伴奏の dur は 0.75 だが 0.5 間隔で並ぶので
 *     8分として書く）。notation.js の描画と同じ扱い。
 *
 * MusicXML の声部について:
 *   ピアノ1パート・2段（staff 1 = ト音記号 = melody、staff 2 = ヘ音記号 = accomp + bass）。
 *   1段につき1声部だけを使い、小節ごとに
 *     staff 1 の音（合計16） → <backup>16</backup> → staff 2 の音（合計16）
 *   の順で書く。<backup> が小節につき1つで済むのはこの形のときだけで、
 *   各段・各小節の <duration> の合計が必ず 16 になる（合わないと楽譜ソフトが開けない）。
 *   ベースは伴奏と同じ声部に混ぜるので、小節頭の和音の最低音として現れる
 *   （全音符として伸ばしたままにはできない。1声部に別々の音価は入らない）。
 */
import {
  keySignature, keyTimeline, spellNote, durationSymbol, splitAtBarlines, chordName,
} from './notation.js';
import { midiProgramsFor } from './instrument.js';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const BEATS_PER_BAR = 4;          // 4/4拍子
const DIVISIONS = 4;              // MusicXML の <divisions>。4分音符 = 4
const DIVS_PER_BAR = BEATS_PER_BAR * DIVISIONS; // 16
const TICKS_PER_BEAT = 480;       // SMF の division

/** 幹音（変化記号なし）のピッチクラス。<alter> を逆算するのに使う */
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** notation.js の符頭名 → MusicXML の <type>。16分だけ綴りが違う */
const TYPE_NAMES = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  sixteenth: '16th',
};

/**
 * 1つの音符・休符で書ける長さ（divisions 単位）と、その素の音価。
 * 付点音符は素の音価の位置から始める（付点2分なら2分の位置から）。
 */
const UNITS = [
  [16, 16], // 全音符
  [12, 8],  // 付点2分
  [8, 8],   // 2分
  [6, 4],   // 付点4分
  [4, 4],   // 4分
  [3, 2],   // 付点8分
  [2, 2],   // 8分
  [1, 1],   // 16分
];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** 曲の小節数。bars が壊れていても totalBeats から拾い、最低1小節は返す */
function barsOf(song) {
  const bars = Math.round(Number(song?.bars));
  if (Number.isFinite(bars) && bars > 0) return bars;
  const beats = Number(song?.totalBeats);
  if (Number.isFinite(beats) && beats > 0) return Math.max(1, Math.ceil(beats / BEATS_PER_BAR));
  return 1;
}

/** 音符が持つ全ての音（保持和音は midis、それ以外は midi 1つ） */
function pitchesOf(note) {
  const many = Array.isArray(note?.midis) ? note.midis : null;
  const src = many && many.length > 0 ? many : [note?.midi];
  const out = [];
  for (const p of src) {
    const m = Math.round(Number(p));
    if (Number.isFinite(m)) out.push(clamp(m, 0, 127));
  }
  return out;
}

/** 曲名。seed が入っているので、あとからこの曲を作り直せる */
function songTitle(song) {
  const key = keySignature(song?.tonicMidi ?? 60, song?.mode);
  const mode = song?.mode === 'minor' ? 'minor' : 'major';
  const tempo = Math.round(Number(song?.tempo)) || 0;
  return `piano ${String(song?.seed ?? '')} - ${key.tonicName} ${mode}, ${tempo} BPM`;
}

// ---------------------------------------------------------------------------
// 1段ぶんの声部を組み立てる
// ---------------------------------------------------------------------------

/**
 * 複数のレイヤー（melody だけ、あるいは accomp + bass）を1声部にまとめる。
 *
 *   1. 同じ打点の音は1つの和音にする（長さは短いほうに合わせる）
 *   2. 次の打点までで長さを頭打ちにする（伴奏の重なりをここで解く）
 *   3. 曲の終端で切り詰める
 *   4. 音の無い区間を休符で埋める
 *
 * 戻り値は beat 昇順で隙間なく並び、合計が必ず totalDivs になる。
 * midis が null の要素は休符。
 *
 * @returns {Array<{ beat:number, dur:number, midis:number[]|null }>}
 */
function voiceEvents(layers, totalDivs) {
  const byStart = new Map();
  for (const layer of layers) {
    for (const note of Array.isArray(layer) ? layer : []) {
      const beat = Number(note?.beat);
      const dur = Number(note?.dur);
      if (!Number.isFinite(beat) || !Number.isFinite(dur)) continue;
      const startDiv = Math.round(beat * DIVISIONS);
      if (startDiv < 0 || startDiv >= totalDivs) continue;
      const midis = pitchesOf(note);
      if (midis.length === 0) continue;
      const endDiv = clamp(Math.round((beat + dur) * DIVISIONS), startDiv + 1, totalDivs);
      const hit = byStart.get(startDiv);
      if (hit) {
        hit.endDiv = Math.min(hit.endDiv, endDiv);
        for (const m of midis) hit.midis.push(m);
      } else {
        byStart.set(startDiv, { startDiv, endDiv, midis });
      }
    }
  }

  const events = [...byStart.values()].sort((a, b) => a.startDiv - b.startDiv);
  const out = [];
  let pos = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const next = events[i + 1];
    const endDiv = next ? Math.min(ev.endDiv, next.startDiv) : ev.endDiv;
    if (endDiv <= ev.startDiv) continue;
    if (ev.startDiv > pos) {
      out.push({ beat: pos / DIVISIONS, dur: (ev.startDiv - pos) / DIVISIONS, midis: null });
    }
    out.push({
      beat: ev.startDiv / DIVISIONS,
      dur: (endDiv - ev.startDiv) / DIVISIONS,
      midis: ev.midis,
    });
    pos = endDiv;
  }
  if (pos < totalDivs) {
    out.push({ beat: pos / DIVISIONS, dur: (totalDivs - pos) / DIVISIONS, midis: null });
  }
  return out;
}

/** その位置の拍の強さ。16=小節頭、8=3拍目、4=拍頭、2=8分の裏、1=16分の裏 */
function beatLevel(pos) {
  return pos === 0 ? DIVS_PER_BAR : (pos & -pos);
}

/**
 * 小節内の位置 startInBar から divs ぶんを、1つずつ書ける音価に割る。
 * 合計は必ず divs に一致する（＝時間が増えも減りもしない）。
 * 音符なら割った断片どうしをタイで繋ぐ。
 *
 * 長い順に採るだけでは読めない楽譜になる。2拍目から始まる3拍の音を
 * 「付点4分＋付点8分＋16分＋8分」と割られても誰も読めない（正しくは
 * 4分＋2分のタイ）。自分の位置より強い拍をまたぐ音価は使わない、と決めると
 * その手の割れ方が消える。例外は付点8分で、残りをちょうど埋めるときだけ許す
 * （伴奏の 0.75 拍が「8分＋16分のタイ」に化けるのを防ぐ）。
 */
function splitDurations(startInBar, divs) {
  const out = [];
  let pos = startInBar;
  let left = Math.max(0, Math.round(divs));
  let guard = 0;
  while (left > 0 && guard++ < 4 * DIVS_PER_BAR) {
    let picked = 1;
    for (const [value, base] of UNITS) {
      if (value > left || pos % base !== 0) continue;
      if (value > beatLevel(pos) && !(value === 3 && value === left)) continue;
      picked = value;
      break;
    }
    out.push(picked);
    pos += picked;
    left -= picked;
  }
  return out;
}

/**
 * 1段ぶんの音符・休符を、小節ごとの配列にして返す。
 * 断片は「1つの <note> で書ける長さ」まで割ってあり、タイの向きも決まっている。
 */
function staffPieces(layers, totalDivs, bars, staff, voice) {
  const measures = Array.from({ length: bars }, () => []);
  const segments = splitAtBarlines(voiceEvents(layers, totalDivs), BEATS_PER_BAR);
  for (const seg of segments) {
    const startDiv = Math.round(Number(seg.beat) * DIVISIONS);
    const divs = Math.round(Number(seg.dur) * DIVISIONS);
    if (!(divs > 0)) continue;
    const measure = Math.floor(startDiv / DIVS_PER_BAR);
    if (measure < 0 || measure >= bars) continue;
    const parts = splitDurations(startDiv - measure * DIVS_PER_BAR, divs);
    for (let i = 0; i < parts.length; i++) {
      const sym = durationSymbol(parts[i] / DIVISIONS);
      measures[measure].push({
        divs: parts[i],
        midis: seg.midis ?? null,
        head: sym.head,
        dots: sym.dots,
        tieFrom: Boolean(seg.midis) && (i > 0 || seg.tieFromPrev === true),
        tieTo: Boolean(seg.midis) && (i < parts.length - 1 || seg.tieToNext === true),
        staff,
        voice,
      });
    }
  }
  return measures;
}

// ---------------------------------------------------------------------------
// MusicXML
// ---------------------------------------------------------------------------

/**
 * <pitch> を作る。
 *
 * spellNote の accidental は「印字する臨時記号」であって <alter> ではない。
 * <alter> は調号を含めた実際の変化量なので、綴り（letter / octave）と実際の midi の
 * 差から逆算する。ここを間違えると半音ずれた楽譜になる。
 */
function pitchXml(midi, key) {
  const sp = spellNote(midi, key);
  const base = (sp.octave + 1) * 12 + LETTER_PC[sp.letter];
  const alter = Math.round(Number(midi)) - base;
  return `<pitch><step>${sp.letter}</step><alter>${alter}</alter><octave>${sp.octave}</octave></pitch>`;
}

/** 調号の <fifths>。シャープなら正、フラットなら負 */
function fifthsOf(key) {
  if (key.accidental === 'sharp') return key.count;
  if (key.accidental === 'flat') return -key.count;
  return 0;
}

/**
 * 1つの断片を <note> の並びにする。
 * 和音は2音目以降に <chord/> を付ける（合計 duration は1音ぶんのまま）。
 * 要素の順番は MusicXML の定義どおり：pitch/rest → duration → tie → voice → type
 * → dot → staff → notations。
 */
function noteXml(piece, key, indent) {
  const type = TYPE_NAMES[piece.head] ?? 'quarter';
  const dots = '<dot/>'.repeat(piece.dots);
  const pad = ' '.repeat(indent);

  if (!piece.midis) {
    return [`${pad}<note><rest/><duration>${piece.divs}</duration><voice>${piece.voice}</voice>`
      + `<type>${type}</type>${dots}<staff>${piece.staff}</staff></note>`];
  }

  const ties = (piece.tieFrom ? '<tie type="stop"/>' : '') + (piece.tieTo ? '<tie type="start"/>' : '');
  const tied = (piece.tieFrom ? '<tied type="stop"/>' : '') + (piece.tieTo ? '<tied type="start"/>' : '');
  const notations = tied ? `<notations>${tied}</notations>` : '';

  const midis = [...new Set(piece.midis)].sort((a, b) => a - b);
  return midis.map((midi, i) => `${pad}<note>${i > 0 ? '<chord/>' : ''}${pitchXml(midi, key)}`
    + `<duration>${piece.divs}</duration>${ties}<voice>${piece.voice}</voice>`
    + `<type>${type}</type>${dots}<staff>${piece.staff}</staff>${notations}</note>`);
}

// コードネームの語尾 → MusicXML の kind。表に無いものは other にして、
// text 属性で見たままの名前を渡す（楽譜ソフトは text をそのまま印字する）。
const HARMONY_KIND = new Map([
  ['', 'major'],
  ['m', 'minor'],
  ['dim', 'diminished'],
  ['aug', 'augmented'],
  ['sus4', 'suspended-fourth'],
  ['sus2', 'suspended-second'],
  ['5', 'power'],
  ['maj7', 'major-seventh'],
  ['7', 'dominant'],
  ['m7', 'minor-seventh'],
  ['mMaj7', 'major-minor'],
  ['m7b5', 'half-diminished'],
  ['7sus4', 'suspended-fourth'],
  ['add9', 'major'],
  ['madd9', 'minor'],
  ['9', 'dominant-ninth'],
  ['m9', 'minor-ninth'],
  ['maj9', 'major-ninth'],
  ['mMaj9', 'major-minor'],
  // 第3音を抜いた形。響きの骨格は7thの和音なので kind はそちらに寄せ、
  // 「第3音が無い」ことは text で伝える。
  ['7(no3)', 'dominant'],
  ['maj7(no3)', 'major-seventh'],
  ['9(no3)', 'dominant-ninth'],
]);

/** 'C#m7/E' を <root>/<kind>/<bass> に分解する。 */
function harmonyXml(entry, key, indent) {
  if (!entry) return [];
  const [body, bassText] = String(entry.name).split('/');
  const m = /^([A-G])(#*|b*)(.*)$/.exec(body);
  if (!m) return [];
  const [, step, sign, suffix] = m;
  const alter = sign.startsWith('#') ? sign.length : sign.startsWith('b') ? -sign.length : 0;
  const pad = ' '.repeat(indent);
  const out = [`${pad}<harmony>`];
  out.push(`${pad}  <root><root-step>${step}</root-step>`
    + (alter ? `<root-alter>${alter}</root-alter>` : '') + '</root>');
  const kind = HARMONY_KIND.get(suffix) ?? 'other';
  out.push(`${pad}  <kind text="${esc(suffix)}">${kind}</kind>`);
  const bm = bassText ? /^([A-G])(#*|b*)$/.exec(bassText) : null;
  if (bm) {
    const ba = bm[2].startsWith('#') ? bm[2].length : bm[2].startsWith('b') ? -bm[2].length : 0;
    out.push(`${pad}  <bass><bass-step>${bm[1]}</bass-step>`
      + (ba ? `<bass-alter>${ba}</bass-alter>` : '') + '</bass>');
  }
  out.push(`${pad}</harmony>`);
  return out;
}

/**
 * 曲を MusicXML（score-partwise 4.0）の文字列にする。
 * ピアノ1パート2段。1小節目に調号・拍子・音部記号・テンポを置く。
 *
 * @param {object} song composeSong の戻り値
 * @returns {string} XML文字列（宣言とDOCTYPE付き）
 */
export function toMusicXML(song) {
  const bars = barsOf(song);
  const totalDivs = bars * DIVS_PER_BAR;
  // 小節ごとの調。転調しない曲では全部同じ調で、changes は空になる。
  const { keys, changes } = keyTimeline(song, bars);
  const changeBars = new Set(changes.map((c) => c.bar));
  const mode = song?.mode === 'minor' ? 'minor' : 'major';
  const tempo = clamp(Math.round(Number(song?.tempo)) || 84, 1, 400);

  const treble = staffPieces([song?.melody], totalDivs, bars, 1, 1);
  const bassStaff = staffPieces([song?.accomp, song?.bass], totalDivs, bars, 2, 5);

  // 小節ごとのコードネーム。画面の楽譜と同じで、前の小節と同じ名前なら書かない。
  const chordAt = new Map();
  let lastChordName = null;
  for (const chord of Array.isArray(song?.chords) ? song.chords : []) {
    const bar = Math.round(Number(chord?.bar));
    if (!Number.isFinite(bar) || bar < 0 || bar >= bars) continue;
    const name = chordName(chord, keys[bar]);
    if (!name || name === lastChordName) {
      if (name) lastChordName = name;
      continue;
    }
    lastChordName = name;
    chordAt.set(bar, { chord, name });
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN"'
      + ' "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `  <work><work-title>${esc(songTitle(song))}</work-title></work>`,
    '  <identification><encoding><software>melody-generator</software></encoding></identification>',
    '  <part-list>',
    '    <score-part id="P1"><part-name>Piano</part-name></score-part>',
    '  </part-list>',
    '  <part id="P1">',
  ];

  for (let m = 0; m < bars; m++) {
    const key = keys[m];
    lines.push(`    <measure number="${m + 1}">`);
    if (m === 0) {
      lines.push('      <attributes>');
      lines.push(`        <divisions>${DIVISIONS}</divisions>`);
      lines.push(`        <key><fifths>${fifthsOf(key)}</fifths><mode>${mode}</mode></key>`);
      lines.push(`        <time><beats>${BEATS_PER_BAR}</beats><beat-type>4</beat-type></time>`);
      lines.push('        <staves>2</staves>');
      lines.push('        <clef number="1"><sign>G</sign><line>2</line></clef>');
      lines.push('        <clef number="2"><sign>F</sign><line>4</line></clef>');
      lines.push('      </attributes>');
      lines.push('      <direction placement="above">');
      lines.push('        <direction-type>');
      lines.push(`          <metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome>`);
      lines.push('        </direction-type>');
      lines.push(`        <sound tempo="${tempo}"/>`);
      lines.push('      </direction>');
    } else if (changeBars.has(m)) {
      // 転調。小節の頭に複縦線を置き、新しい調号を宣言する。
      // 楽譜ソフトはこの <key> 以降を新しい調として読むので、
      // これを出さないと転調後が臨時記号だらけの見た目になる。
      lines.push('      <barline location="left"><bar-style>light-light</bar-style></barline>');
      lines.push('      <attributes>');
      lines.push(`        <key><fifths>${fifthsOf(key)}</fifths><mode>${mode}</mode></key>`);
      lines.push('      </attributes>');
    }
    // コードネーム。<harmony> は最初の音符より前に置く決まり。
    lines.push(...harmonyXml(chordAt.get(m), key, 6));
    for (const piece of treble[m]) lines.push(...noteXml(piece, key, 6));
    lines.push(`      <backup><duration>${DIVS_PER_BAR}</duration></backup>`);
    for (const piece of bassStaff[m]) lines.push(...noteXml(piece, key, 6));
    lines.push('    </measure>');
  }

  lines.push('  </part>');
  lines.push('</score-partwise>');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// MIDI（SMF format 1）
// ---------------------------------------------------------------------------

/**
 * 可変長数値（variable-length quantity）に直す。
 * 7ビットずつ上位から並べ、最後以外の最上位ビットを立てる。
 * @param {number} value 0〜0x0FFFFFFF
 * @returns {number[]}
 */
export function writeVariableLength(value) {
  let v = clamp(Math.round(Number(value)) || 0, 0, 0x0fffffff);
  const stack = [v & 0x7f];
  v = Math.floor(v / 128);
  while (v > 0) {
    stack.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  return stack.reverse();
}

/**
 * 可変長数値を読む。
 * @param {ArrayLike<number>} bytes
 * @param {number} pos
 * @returns {{ value: number, next: number }}
 */
export function readVariableLength(bytes, pos) {
  let value = 0;
  let i = pos;
  for (let n = 0; n < 4 && i < bytes.length; n++) {
    const b = bytes[i++];
    value = value * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return { value, next: i };
}

/** vel（0〜1）を MIDI のベロシティ 1〜127 に写す */
function velocityOf(vel) {
  const v = Number(vel);
  return clamp(Math.round((Number.isFinite(v) ? v : 0.5) * 126) + 1, 1, 127);
}

function textBytes(str) {
  return [...new TextEncoder().encode(String(str))];
}

/** メタイベント（デルタタイム込み） */
function metaEvent(delta, type, data) {
  return [...writeVariableLength(delta), 0xff, type, ...writeVariableLength(data.length), ...data];
}

function chunk(id, data) {
  const len = data.length;
  return [
    ...textBytes(id),
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff,
    ...data,
  ];
}

/**
 * ノートオン／オフのイベントを時刻順に並べる。
 * 同時刻ならオフを先に置く（同じ音が続くとき、あとから来たオフに切られないように）。
 */
function noteEvents(layers, channel) {
  const events = [];
  for (const layer of layers) {
    for (const note of Array.isArray(layer) ? layer : []) {
      const beat = Number(note?.beat);
      const dur = Number(note?.dur);
      if (!Number.isFinite(beat) || !Number.isFinite(dur)) continue;
      const start = Math.round(beat * TICKS_PER_BEAT);
      const end = Math.max(start + 1, Math.round((beat + dur) * TICKS_PER_BEAT));
      const vel = velocityOf(note?.vel);
      for (const midi of pitchesOf(note)) {
        events.push({ tick: start, order: 1, bytes: [0x90 | channel, midi, vel] });
        events.push({ tick: end, order: 0, bytes: [0x80 | channel, midi, 0] });
      }
    }
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  return events;
}

/** イベント列をデルタタイム付きのバイト列にして、End of Track で閉じる */
function trackBytes(head, events) {
  const data = [...head];
  let last = 0;
  for (const ev of events) {
    data.push(...writeVariableLength(ev.tick - last), ...ev.bytes);
    last = ev.tick;
  }
  data.push(...metaEvent(0, 0x2f, []));
  return chunk('MTrk', data);
}

/**
 * 曲を標準MIDIファイル（SMF format 1、480 ticks/4分音符）にする。
 *
 *   トラック0  テンポ・拍子・調号・曲名
 *   トラック1  メロディー（チャンネル0）
 *   トラック2  伴奏＋ベース（チャンネル1）
 *
 * 調号のメタイベント（FF 59 02 sf mi）は規格どおりトラック0に置く。
 * 曲頭に元の調を1つ、転調があればその位置にもう1つ。
 *
 * pad は書き出さない。演奏の揺らぎも掛けない。
 *
 * @param {object} song composeSong の戻り値
 * @returns {Uint8Array}
 */
export function toMidi(song) {
  const tempo = clamp(Math.round(Number(song?.tempo)) || 84, 1, 400);
  const usPerQuarter = Math.round(60000000 / tempo);
  const { keys, changes } = keyTimeline(song, barsOf(song));
  // sf は符号付き8bit（フラットは負）、mi は 0=長調 / 1=短調
  const mi = song?.mode === 'minor' ? 1 : 0;
  const keySigData = (key) => [fifthsOf(key) & 0xff, mi];

  const header = chunk('MThd', [
    0x00, 0x01,                                     // format 1
    0x00, 0x03,                                     // トラック3つ
    (TICKS_PER_BEAT >>> 8) & 0xff, TICKS_PER_BEAT & 0xff,
  ]);

  const conductor = [
    ...metaEvent(0, 0x03, textBytes(songTitle(song))),
    ...metaEvent(0, 0x51, [
      (usPerQuarter >>> 16) & 0xff, (usPerQuarter >>> 8) & 0xff, usPerQuarter & 0xff,
    ]),
    ...metaEvent(0, 0x58, [0x04, 0x02, 0x18, 0x08]), // 4/4、メトロノーム24、32分音符8つ
    ...metaEvent(0, 0x59, keySigData(keys[0])),
  ];

  // 転調。デルタタイムは trackBytes が tick の差から作るので、ここでは絶対 tick を渡す。
  const keyChanges = changes.map((c) => ({
    tick: c.bar * BEATS_PER_BAR * TICKS_PER_BEAT,
    order: 0,
    bytes: [0xff, 0x59, 0x02, ...keySigData(c.to)],
  }));

  // 画面で鳴っている楽器に、GM でいちばん近い音色を当てる（箏なら Koto）。
  // 既定は従来どおり Acoustic Grand Piano。
  const programs = midiProgramsFor(song?.instrument);
  const melodyHead = [
    ...metaEvent(0, 0x03, textBytes('Melody')),
    0x00, 0xc0, programs.melody & 0x7f,             // プログラムチェンジ
  ];
  const accompHead = [
    ...metaEvent(0, 0x03, textBytes('Accompaniment')),
    0x00, 0xc1, programs.accomp & 0x7f,
  ];

  const bytes = [
    ...header,
    ...trackBytes(conductor, keyChanges),
    ...trackBytes(melodyHead, noteEvents([song?.melody], 0)),
    ...trackBytes(accompHead, noteEvents([song?.accomp, song?.bass], 1)),
  ];
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------
// ファイル名
// ---------------------------------------------------------------------------

/** ファイル名に使えない文字を落とす。残すのは英数字とハイフンとアンダースコアだけ */
function safeChunk(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

/**
 * 保存ダイアログに出すファイル名。
 * 例: 'piano-a3f91c-Amajor-84bpm.musicxml'
 *
 * @param {object} song
 * @param {'musicxml'|'mid'|string} ext
 * @returns {string}
 */
export function suggestFilename(song, ext) {
  const key = keySignature(song?.tonicMidi ?? 60, song?.mode);
  const mode = song?.mode === 'minor' ? 'minor' : 'major';
  const tempo = clamp(Math.round(Number(song?.tempo)) || 0, 0, 999);
  // 'F#' の '#' はファイル名に置けるがURLで化けるので綴りに直す
  const tonic = safeChunk(key.tonicName.replace(/#/g, 'sharp'));
  const seed = safeChunk(song?.seed ?? '');
  const suffix = safeChunk(String(ext ?? '').toLowerCase()) || 'txt';
  const parts = ['piano', seed, `${tonic}${mode}`, `${tempo}bpm`].filter((p) => p !== '');
  return `${parts.join('-')}.${suffix}`;
}
