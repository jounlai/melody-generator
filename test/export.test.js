import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  toMusicXML,
  toMidi,
  suggestFilename,
  writeVariableLength,
  readVariableLength,
} from '../src/export.js';
import { keySignature } from '../src/notation.js';
import { composeSong } from '../src/compose.js';
import { resolveSettings } from '../src/settings.js';

// ---------------------------------------------------------------------------
// フィクスチャ
// ---------------------------------------------------------------------------

function loadRealData() {
  const dir = new URL('../src/data/', import.meta.url);
  try {
    return {
      melodies: JSON.parse(fs.readFileSync(new URL('melodies.json', dir), 'utf8')),
      progressions: JSON.parse(fs.readFileSync(new URL('progressions.json', dir), 'utf8')),
    };
  } catch {
    return null;
  }
}

const REAL = loadRealData();
const realOpts = { skip: REAL ? false : 'src/data/*.json が無い' };
const SEEDS = ['a3f91c', 'b7e210', 'c0d4a9', 'd5f382', 'e91b7c', 'f2a615', '0b8c3d', '17e9f4', '2c6a8b', '3d5e70'];
const LENGTHS = ['16', '32', '64'];

function song(seed, bars = '32') {
  return composeSong(seed, REAL, resolveSettings({ songBars: bars }));
}

/** 実データ10曲（既定の32小節） */
function songs() {
  return SEEDS.map((s) => song(s));
}

/** 転調する曲だけを集める。転調は抽選なので、空なら検査が空振りしていると分かる */
function modulatedSongs(bars = '32') {
  return SEEDS.map((seed) => song(seed, bars)).filter((s) => s.modulation);
}

/**
 * 合成した転調曲。実データが無くても動く。
 * atBar から先の音を shift 半音上げ、契約どおりの modulation / sections を付ける。
 */
function modSong(tonicMidi, shift, mode = 'major', bars = 4, atBar = 2) {
  // 主和音の4音（1 3 5 7）。どの調でも音階内に収まるので、
  // 臨時記号が出たら「調の取り違え」だと分かる。
  const steps = mode === 'minor' ? [0, 3, 7, 10] : [0, 4, 7, 11];
  const melody = [];
  const bass = [];
  for (let b = 0; b < bars; b++) {
    const up = b >= atBar ? shift : 0;
    for (let k = 0; k < 4; k++) {
      melody.push({ midi: tonicMidi + 12 + steps[k] + up, beat: b * 4 + k, dur: 1, vel: 0.5 });
    }
    bass.push({ midi: tonicMidi - 12 + up, beat: b * 4, dur: 4, vel: 0.5 });
  }
  return fakeSong({
    seed: 'modtest',
    mode,
    tonicMidi,
    bars,
    totalBeats: bars * 4,
    sections: [
      { name: 'A', progressionId: 'x', startBar: 0, tonicMidi, slots: [] },
      { name: "A''", progressionId: 'x', startBar: atBar, tonicMidi: tonicMidi + shift, slots: [] },
    ],
    modulation: {
      atBar,
      semitones: shift,
      fromTonicMidi: tonicMidi,
      toTonicMidi: tonicMidi + shift,
    },
    melody,
    bass,
  });
}

/** 調号の <fifths>。シャープなら正、フラットなら負 */
function fifthsOf(key) {
  if (key.accidental === 'sharp') return key.count;
  if (key.accidental === 'flat') return -key.count;
  return 0;
}

/** トラックからキーシグネチャのメタイベント（FF 59 02 sf mi）を拾う */
function keySignatures(track) {
  return track.events
    .filter((e) => e.kind === 'meta' && e.type === 0x59)
    .map((e) => {
      assert.equal(e.data.length, 2, 'キーシグネチャの長さが2バイトでない');
      return { tick: e.tick, sf: e.data[0] > 127 ? e.data[0] - 256 : e.data[0], mi: e.data[1] };
    });
}

/** 曲オブジェクトの最小の形。書き出し側が壊れた入力で落ちないかも兼ねる */
function fakeSong(over = {}) {
  return {
    seed: 'test01',
    mode: 'major',
    tonicMidi: 60,
    tempo: 84,
    bars: 2,
    totalBeats: 8,
    climaxBeat: 0,
    breathBar: null,
    sections: [],
    melody: [],
    accomp: [],
    bass: [],
    pad: [],
    ...over,
  };
}

const BEATS_PER_BAR = 4;
const TICKS_PER_BEAT = 480;
const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 音符が持つ全ての音（保持和音は midis、それ以外は midi 1つ） */
function pitchesOf(note) {
  const many = Array.isArray(note?.midis) && note.midis.length > 0 ? note.midis : null;
  return (many ?? [note.midi]).map((m) => Math.round(Number(m)));
}

// ---------------------------------------------------------------------------
// 自前のXMLパーサ（外部ライブラリは使えない）
//
// タグをスタックで照合しながら木を作る。閉じ忘れ・閉じ違い・閉じ過ぎは例外。
// 属性値に '>' を含めない書き方をしている前提。
// ---------------------------------------------------------------------------

function parseAttrs(body) {
  const attrs = {};
  const re = /([\w:-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(body)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<[^>]*>/g;
  let m;
  let last = 0;
  let maxDepth = 0;
  while ((m = re.exec(xml)) !== null) {
    const between = xml.slice(last, m.index).trim();
    last = re.lastIndex;
    if (between !== '') stack[stack.length - 1].text += between;
    const raw = m[0];
    if (raw.startsWith('<?') || raw.startsWith('<!')) continue;

    if (raw.startsWith('</')) {
      const name = raw.slice(2, -1).trim();
      const top = stack.pop();
      if (!top || top.name !== name) {
        throw new Error(`閉じタグが対応しない: </${name}> に対して <${top?.name}>`);
      }
      if (stack.length === 0) throw new Error(`ルートの外で閉じた: </${name}>`);
      continue;
    }

    const selfClosing = raw.endsWith('/>');
    const body = raw.slice(1, selfClosing ? -2 : -1);
    const name = body.split(/[\s/]/)[0];
    const el = { name, attrs: parseAttrs(body), children: [], text: '' };
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) {
      stack.push(el);
      maxDepth = Math.max(maxDepth, stack.length);
    }
  }
  if (stack.length !== 1) {
    throw new Error(`閉じていないタグ: ${stack.slice(1).map((e) => e.name).join(' > ')}`);
  }
  root.maxDepth = maxDepth;
  return root;
}

function findAll(el, name, out = []) {
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

function firstChild(el, name) {
  return el.children.find((c) => c.name === name) ?? null;
}

function textOf(el, name) {
  const c = firstChild(el, name);
  return c ? c.text : null;
}

function hasChild(el, name) {
  return el.children.some((c) => c.name === name);
}

function measuresOf(xml) {
  return findAll(parseXml(xml), 'measure');
}

/** <pitch> から MIDI ノート番号を復元する */
function midiOfPitch(pitch) {
  const step = textOf(pitch, 'step');
  const alterText = textOf(pitch, 'alter');
  const alter = alterText === null ? 0 : Number(alterText);
  const octave = Number(textOf(pitch, 'octave'));
  assert.ok(step in STEP_PC, `step が音名でない: ${step}`);
  assert.ok(Number.isFinite(octave), `octave が数値でない: ${textOf(pitch, 'octave')}`);
  assert.ok(Number.isFinite(alter), `alter が数値でない: ${alterText}`);
  return (octave + 1) * 12 + STEP_PC[step] + alter;
}

/** その小節で鳴っている音（元データ側）。素の dur で見るので書き出しより広い集合 */
function soundingPitches(layers, from, to) {
  const set = new Set();
  for (const layer of layers) {
    for (const n of layer) {
      if (n.beat < to - 1e-9 && n.beat + n.dur > from + 1e-9) {
        for (const p of pitchesOf(n)) set.add(p);
      }
    }
  }
  return set;
}

/** その小節から鳴り始める音（元データ側） */
function onsetPitches(layers, from, to, totalBeats) {
  const set = new Set();
  for (const layer of layers) {
    for (const n of layer) {
      if (n.beat >= from - 1e-9 && n.beat < Math.min(to, totalBeats) - 1e-9) {
        for (const p of pitchesOf(n)) set.add(p);
      }
    }
  }
  return set;
}

// ---------------------------------------------------------------------------
// 自前のMIDIパーサ
// ---------------------------------------------------------------------------

/** 可変長数値を読む（export.js とは独立の実装） */
function readVar(bytes, pos) {
  let value = 0;
  let i = pos;
  for (let n = 0; n < 4; n++) {
    const b = bytes[i++];
    value = value * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return [value, i];
}

function parseMidiFile(bytes) {
  const ascii = (at, n) => String.fromCharCode(...bytes.slice(at, at + n));
  const u16 = (at) => bytes[at] * 256 + bytes[at + 1];
  const u32 = (at) => ((bytes[at] * 256 + bytes[at + 1]) * 256 + bytes[at + 2]) * 256 + bytes[at + 3];

  assert.equal(ascii(0, 4), 'MThd', '先頭が MThd でない');
  const headerLen = u32(4);
  assert.equal(headerLen, 6, 'MThd の長さが 6 でない');
  const file = {
    format: u16(8),
    ntrks: u16(10),
    division: u16(12),
    tracks: [],
  };

  let pos = 8 + headerLen;
  while (pos < bytes.length) {
    const id = ascii(pos, 4);
    const len = u32(pos + 4);
    const start = pos + 8;
    const end = start + len;
    const events = [];
    let p = start;
    let tick = 0;
    let running = 0;
    while (p < end) {
      const [delta, afterDelta] = readVar(bytes, p);
      p = afterDelta;
      tick += delta;
      let status = bytes[p];
      if ((status & 0x80) !== 0) {
        p += 1;
      } else {
        status = running;
        assert.ok((status & 0x80) !== 0, 'ランニングステータスが確立していない');
      }
      if (status === 0xff) {
        running = 0;
        const type = bytes[p];
        p += 1;
        const [len2, afterLen] = readVar(bytes, p);
        p = afterLen;
        events.push({ tick, kind: 'meta', type, data: [...bytes.slice(p, p + len2)] });
        p += len2;
      } else if (status === 0xf0 || status === 0xf7) {
        running = 0;
        const [len2, afterLen] = readVar(bytes, p);
        p = afterLen + len2;
      } else {
        running = status;
        const high = status & 0xf0;
        const count = high === 0xc0 || high === 0xd0 ? 1 : 2;
        const data = [...bytes.slice(p, p + count)];
        p += count;
        events.push({ tick, kind: 'channel', status: high, channel: status & 0x0f, data });
      }
    }
    assert.equal(p, end, 'トラックのイベントが長さフィールドを越えた');
    file.tracks.push({ id, length: len, start, end, events, bytes: [...bytes.slice(start, end)] });
    pos = end;
  }
  assert.equal(pos, bytes.length, 'ファイル末尾に余りがある');
  return file;
}

/** ノートオン（ベロシティ0のオンはオフ扱い）だけを取り出す */
function noteOns(track) {
  return track.events.filter(
    (e) => e.kind === 'channel' && e.status === 0x90 && e.data[1] > 0,
  );
}

/** 開いたノートが全て閉じるかを数える。戻り値は開いた総数 */
function checkNotesClosed(track, label) {
  const open = new Map();
  let opened = 0;
  for (const e of track.events) {
    if (e.kind !== 'channel') continue;
    const key = `${e.channel}:${e.data[0]}`;
    if (e.status === 0x90 && e.data[1] > 0) {
      open.set(key, (open.get(key) ?? 0) + 1);
      opened += 1;
    } else if (e.status === 0x80 || (e.status === 0x90 && e.data[1] === 0)) {
      const n = open.get(key) ?? 0;
      assert.ok(n > 0, `${label}: 開いていないノートのオフ ${key}`);
      open.set(key, n - 1);
    }
  }
  for (const [key, n] of open) assert.equal(n, 0, `${label}: 閉じていないノート ${key}`);
  return opened;
}

// ===========================================================================
// MusicXML
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. 実データ10曲で例外なく文字列を返す
// ---------------------------------------------------------------------------

test('MusicXML: 実データ10曲が例外なく書き出せる', realOpts, () => {
  for (const s of songs()) {
    const xml = toMusicXML(s);
    assert.equal(typeof xml, 'string');
    assert.ok(xml.length > 1000, `${s.seed}: 短すぎる (${xml.length}文字)`);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'XML宣言が無い');
    assert.ok(xml.includes('<!DOCTYPE score-partwise'), 'DOCTYPEが無い');
    assert.ok(xml.includes('<score-partwise version="4.0">'), 'score-partwise 4.0 でない');
    assert.ok(xml.includes(`<work-title>`), 'work-title が無い');
    assert.ok(xml.includes(s.seed), `work-title に seed(${s.seed}) が入っていない`);
    assert.ok(xml.includes('<score-part id="P1"><part-name>Piano</part-name></score-part>'),
      'part-list が無い');
  }
});

// ---------------------------------------------------------------------------
// 2. XMLとして妥当（タグの開閉がスタックで対応する）
// ---------------------------------------------------------------------------

test('MusicXML: タグの開閉が全て対応する', realOpts, () => {
  for (const bars of LENGTHS) {
    for (const seed of SEEDS) {
      const xml = toMusicXML(song(seed, bars));
      const root = parseXml(xml); // 対応しなければここで例外
      assert.equal(root.children.length, 1, 'ルート直下は score-partwise 1つ');
      assert.equal(root.children[0].name, 'score-partwise');
      assert.ok(root.maxDepth >= 4, '木が浅すぎる');
    }
  }
});

test('MusicXML: パーサ自身が壊れたXMLを弾く（自己検査）', () => {
  assert.throws(() => parseXml('<a><b></a></b>'), /対応しない/);
  assert.throws(() => parseXml('<a><b></b>'), /閉じていない/);
  assert.throws(() => parseXml('<a></a></a>'), /対応しない|外で閉じた/);
  assert.doesNotThrow(() => parseXml('<a><b/><c>x</c></a>'));
});

// ---------------------------------------------------------------------------
// 3. divisions と staves
// ---------------------------------------------------------------------------

test('MusicXML: divisions 4 と staves 2 が入る', realOpts, () => {
  for (const s of songs()) {
    const xml = toMusicXML(s);
    assert.ok(xml.includes('<divisions>4</divisions>'), 'divisions が 4 でない');
    assert.ok(xml.includes('<staves>2</staves>'), 'staves が 2 でない');
    assert.ok(xml.includes('<clef number="1"><sign>G</sign><line>2</line></clef>'), 'ト音記号が無い');
    assert.ok(xml.includes('<clef number="2"><sign>F</sign><line>4</line></clef>'), 'ヘ音記号が無い');
    assert.ok(xml.includes('<time><beats>4</beats><beat-type>4</beat-type></time>'), '拍子が無い');
    assert.ok(xml.includes(`<sound tempo="${s.tempo}"/>`), 'テンポ指示が無い');
    assert.ok(xml.includes(`<per-minute>${s.tempo}</per-minute>`), 'メトロノーム記号が無い');
  }
});

// ---------------------------------------------------------------------------
// 4. 各小節・各 staff の duration 合計がちょうど16（最重要）
// ---------------------------------------------------------------------------

test('MusicXML: 全小節・全 staff の duration 合計が 16', realOpts, () => {
  for (const bars of LENGTHS) {
    for (const seed of SEEDS) {
      const s = song(seed, bars);
      const measures = measuresOf(toMusicXML(s));
      assert.equal(measures.length, s.bars, `${seed}/${bars}: 小節数が合わない`);
      measures.forEach((measure, i) => {
        const sum = { 1: 0, 2: 0 };
        for (const note of measure.children.filter((c) => c.name === 'note')) {
          // 和音の2音目以降は同時に鳴るので時間を進めない
          if (hasChild(note, 'chord')) continue;
          const staff = textOf(note, 'staff');
          const dur = Number(textOf(note, 'duration'));
          assert.ok(staff === '1' || staff === '2', `${seed}/${bars} 小節${i + 1}: staff が不正 ${staff}`);
          assert.ok(Number.isInteger(dur) && dur > 0,
            `${seed}/${bars} 小節${i + 1}: duration が不正 ${textOf(note, 'duration')}`);
          sum[staff] += dur;
        }
        assert.equal(sum[1], 16, `${seed}/${bars} 小節${i + 1}: staff 1 の合計が ${sum[1]}`);
        assert.equal(sum[2], 16, `${seed}/${bars} 小節${i + 1}: staff 2 の合計が ${sum[2]}`);
      });
    }
  }
});

/** <type> と <dot> が表す長さ（divisions） */
const TYPE_DIVS = { whole: 16, half: 8, quarter: 4, eighth: 2, '16th': 1 };

function notatedDivs(note) {
  const type = textOf(note, 'type');
  assert.ok(type in TYPE_DIVS, `知らない type: ${type}`);
  const dots = note.children.filter((c) => c.name === 'dot').length;
  assert.ok(dots <= 1, `付点が多すぎる: ${dots}`);
  return TYPE_DIVS[type] * (dots === 1 ? 1.5 : 1);
}

test('MusicXML: duration と type/dot が一致し、音価が拍に乗る', realOpts, () => {
  for (const bars of LENGTHS) {
    for (const seed of SEEDS) {
      measuresOf(toMusicXML(song(seed, bars))).forEach((measure, i) => {
        const pos = { 1: 0, 2: 0 };
        for (const child of measure.children) {
          if (child.name !== 'note') continue;
          const staff = textOf(child, 'staff');
          const divs = Number(textOf(child, 'duration'));
          assert.equal(divs, notatedDivs(child),
            `${seed}/${bars} 小節${i + 1}: duration と type が食い違う`);
          // 付点音符は素の音価の位置から始める（付点2分が裏拍から始まると読めない）
          const base = TYPE_DIVS[textOf(child, 'type')];
          assert.equal(pos[staff] % base, 0,
            `${seed}/${bars} 小節${i + 1}: ${textOf(child, 'type')} が ${pos[staff]}/16 から始まっている`);
          if (!hasChild(child, 'chord')) pos[staff] += divs;
        }
      });
    }
  }
});

test('MusicXML: 1つの音価で書けない長さはタイで割る', () => {
  // 3.5拍(14) と 1.25拍(5) は表に無い長さ。時間を保ったまま書ける音価に割る。
  const s = fakeSong({
    bars: 2,
    totalBeats: 8,
    melody: [
      { midi: 60, beat: 0, dur: 3.5, vel: 0.5 },
      { midi: 62, beat: 3.5, dur: 0.5, vel: 0.5 },
      { midi: 64, beat: 4, dur: 1.25, vel: 0.5 },
    ],
  });
  const measures = measuresOf(toMusicXML(s));
  const treble = measures.map((m) => m.children.filter(
    (c) => c.name === 'note' && textOf(c, 'staff') === '1',
  ));
  for (const [i, notes] of treble.entries()) {
    let sum = 0;
    for (const note of notes) {
      assert.equal(Number(textOf(note, 'duration')), notatedDivs(note),
        `小節${i + 1}: duration と type が食い違う`);
      sum += Number(textOf(note, 'duration'));
    }
    assert.equal(sum, 16, `小節${i + 1}: 合計が 16 でない`);
  }
  // 14 は 1つの音符では書けないので、必ず2つ以上のタイになる
  const first = treble[0].filter((n) => firstChild(n, 'pitch') && midiOfPitch(firstChild(n, 'pitch')) === 60);
  assert.ok(first.length >= 2, `3.5拍が1つの音符のまま: ${first.length}`);
  assert.equal(first.reduce((n, x) => n + Number(textOf(x, 'duration')), 0), 14, '3.5拍ぶんの時間が失われた');
  assert.equal(first[0].children.filter((c) => c.name === 'tie')[0].attrs.type, 'start');
  const ties = first.flatMap((n) => n.children.filter((c) => c.name === 'tie').map((c) => c.attrs.type));
  assert.equal(ties.filter((t) => t === 'start').length, ties.filter((t) => t === 'stop').length);
});

test('MusicXML: 強い拍をまたぐ音は読める形に割れる', () => {
  // 2拍目から3拍伸びる音は「4分＋2分」のタイ。付点4分から割り始めると読めない。
  const s = fakeSong({
    bars: 1,
    totalBeats: 4,
    melody: [{ midi: 60, beat: 1, dur: 3, vel: 0.5 }],
    // 伴奏の 0.75 拍は付点8分1つのまま（8分＋16分のタイにしない）
    accomp: [{ midi: 48, beat: 0.5, dur: 0.75, vel: 0.3 }],
  });
  const measure = measuresOf(toMusicXML(s))[0];
  const shape = (staff) => measure.children
    .filter((c) => c.name === 'note' && textOf(c, 'staff') === staff)
    .map((c) => `${hasChild(c, 'rest') ? 'r' : 'n'}${textOf(c, 'duration')}`);
  assert.deepEqual(shape('1'), ['r4', 'n4', 'n8'], '2拍目からの3拍が読める形に割れていない');
  // 休符も同じ規則で敷き詰める（16分 → 8分 → 2分 と拍の強いほうへ寄せる）
  assert.deepEqual(shape('2'), ['r2', 'n3', 'r1', 'r2', 'r8'], '付点8分が割られている');
});

test('MusicXML: 音が1つも無くても小節は休符で埋まる', () => {
  const measures = measuresOf(toMusicXML(fakeSong({ bars: 3, totalBeats: 12 })));
  assert.equal(measures.length, 3);
  for (const measure of measures) {
    const sum = { 1: 0, 2: 0 };
    for (const note of measure.children.filter((c) => c.name === 'note')) {
      assert.ok(hasChild(note, 'rest'), '音符が出てきた');
      sum[textOf(note, 'staff')] += Number(textOf(note, 'duration'));
    }
    assert.deepEqual(sum, { 1: 16, 2: 16 });
  }
});

// ---------------------------------------------------------------------------
// 5. backup の数が小節数と一致する
// ---------------------------------------------------------------------------

test('MusicXML: backup が小節につき1つ、値は16', realOpts, () => {
  for (const bars of LENGTHS) {
    for (const seed of SEEDS) {
      const s = song(seed, bars);
      const root = parseXml(toMusicXML(s));
      const backups = findAll(root, 'backup');
      assert.equal(backups.length, s.bars, `${seed}/${bars}: backup の数が小節数と違う`);
      for (const b of backups) assert.equal(textOf(b, 'duration'), '16');
      // backup は必ず staff 1 の音のあと・staff 2 の音の前にある
      for (const measure of findAll(root, 'measure')) {
        const notes = measure.children.filter((c) => c.name === 'note' || c.name === 'backup');
        const at = notes.findIndex((c) => c.name === 'backup');
        assert.ok(at >= 0, 'backup が小節に無い');
        notes.forEach((c, i) => {
          if (c.name !== 'note') return;
          assert.equal(textOf(c, 'staff'), i < at ? '1' : '2', 'backup を挟んだ staff の順が違う');
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 6. alter が正しい（step / alter / octave から MIDI を復元できる）（最重要）
// ---------------------------------------------------------------------------

test('MusicXML: 全 note の step/alter/octave が元の midi を再現する', realOpts, () => {
  let checked = 0;
  for (const bars of LENGTHS) {
    for (const seed of SEEDS) {
      const s = song(seed, bars);
      const layersOf = { 1: [s.melody], 2: [s.accomp, s.bass] };
      measuresOf(toMusicXML(s)).forEach((measure, i) => {
        const from = i * BEATS_PER_BAR;
        const to = from + BEATS_PER_BAR;
        const written = { 1: new Set(), 2: new Set() };
        for (const note of measure.children.filter((c) => c.name === 'note')) {
          const pitch = firstChild(note, 'pitch');
          if (!pitch) continue;
          const staff = textOf(note, 'staff');
          const midi = midiOfPitch(pitch);
          assert.ok(Number.isInteger(midi) && midi >= 0 && midi <= 127,
            `${seed}/${bars} 小節${i + 1}: 復元した MIDI が範囲外 ${midi}`);
          written[staff].add(midi);
          checked += 1;
        }
        for (const staff of ['1', '2']) {
          const sounding = soundingPitches(layersOf[staff], from, to);
          for (const midi of written[staff]) {
            assert.ok(sounding.has(midi),
              `${seed}/${bars} 小節${i + 1} staff${staff}: MIDI ${midi} は元データに無い`
              + `（半音ずれ？ 元データ: ${[...sounding].sort((a, b) => a - b).join(',')}）`);
          }
          // 逆向き：その小節で鳴り始める音は必ず書き出されている
          for (const midi of onsetPitches(layersOf[staff], from, to, s.totalBeats)) {
            assert.ok(written[staff].has(midi),
              `${seed}/${bars} 小節${i + 1} staff${staff}: MIDI ${midi} が書き出されていない`);
          }
        }
      });
    }
  }
  assert.ok(checked > 5000, `検査した音符が少なすぎる: ${checked}`);
});

test('MusicXML: 調号の中の音は alter を持ち、臨時記号は正しく打ち消す', () => {
  // イ長調（シャープ3つ: F# C# G#）。F#4=66 は alter 1、F♮4=65 は alter 0。
  const s = fakeSong({
    tonicMidi: 57,
    mode: 'major',
    bars: 1,
    totalBeats: 4,
    melody: [
      { midi: 66, beat: 0, dur: 1, vel: 0.5 },
      { midi: 65, beat: 1, dur: 1, vel: 0.5 },
      { midi: 61, beat: 2, dur: 1, vel: 0.5 },
      { midi: 60, beat: 3, dur: 1, vel: 0.5 },
    ],
  });
  const notes = findAll(parseXml(toMusicXML(s)), 'note').filter((n) => firstChild(n, 'pitch'));
  const got = notes.map((n) => {
    const p = firstChild(n, 'pitch');
    return [textOf(p, 'step'), Number(textOf(p, 'alter')), Number(textOf(p, 'octave')), midiOfPitch(p)];
  });
  assert.deepEqual(got, [
    ['F', 1, 4, 66],
    ['F', 0, 4, 65],
    ['C', 1, 4, 61],
    ['C', 0, 4, 60],
  ]);
});

// ---------------------------------------------------------------------------
// 7. 調号 fifths が keySignature と一致する（16通り）
// ---------------------------------------------------------------------------

test('MusicXML: fifths が keySignature と一致する（tonicMidi 56〜63 × 2旋法）', () => {
  let count = 0;
  for (let tonicMidi = 56; tonicMidi <= 63; tonicMidi++) {
    for (const mode of ['major', 'minor']) {
      const key = keySignature(tonicMidi, mode);
      const expected = key.accidental === 'sharp' ? key.count
        : key.accidental === 'flat' ? -key.count : 0;
      const root = parseXml(toMusicXML(fakeSong({ tonicMidi, mode })));
      const keyEl = findAll(root, 'key')[0];
      assert.equal(Number(textOf(keyEl, 'fifths')), expected,
        `tonicMidi=${tonicMidi} ${mode}(${key.tonicName}) の fifths が違う`);
      assert.equal(textOf(keyEl, 'mode'), mode);
      count += 1;
    }
  }
  assert.equal(count, 16);
});

// ---------------------------------------------------------------------------
// 8. タイの start と stop の数が一致する
// ---------------------------------------------------------------------------

test('MusicXML: タイの start と stop が対になっている', realOpts, () => {
  let totalStarts = 0;
  for (const bars of LENGTHS) {
    for (const seed of SEEDS) {
      const xml = toMusicXML(song(seed, bars));
      const root = parseXml(xml);
      const count = (name, type) => findAll(root, name).filter((e) => e.attrs.type === type).length;
      const starts = count('tie', 'start');
      const stops = count('tie', 'stop');
      assert.equal(starts, stops, `${seed}/${bars}: tie の start(${starts}) と stop(${stops}) が違う`);
      assert.equal(count('tied', 'start'), starts, `${seed}/${bars}: tied start が tie と違う`);
      assert.equal(count('tied', 'stop'), stops, `${seed}/${bars}: tied stop が tie と違う`);
      // tie を持つ音符は必ず notations/tied も持つ
      for (const note of findAll(root, 'note')) {
        const ties = note.children.filter((c) => c.name === 'tie');
        const notations = firstChild(note, 'notations');
        assert.equal(ties.length > 0, notations !== null, 'tie と notations が食い違う');
        if (notations) {
          assert.deepEqual(
            ties.map((t) => t.attrs.type),
            findAll(notations, 'tied').map((t) => t.attrs.type),
          );
        }
        assert.ok(!hasChild(note, 'rest') || ties.length === 0, '休符にタイが付いている');
      }
      totalStarts += starts;
    }
  }
  assert.ok(totalStarts > 0, '小節をまたぐ音が1つも無く、タイの検査が空振りしている');
});

test('MusicXML: 小節をまたぐ音がタイで分割される', () => {
  // 2拍目から4拍伸びる音は 2拍 + 2拍 のタイになる
  const s = fakeSong({
    melody: [{ midi: 60, beat: 2, dur: 4, vel: 0.5 }],
  });
  const root = parseXml(toMusicXML(s));
  const measures = findAll(root, 'measure');
  const pitched = measures.map((m) => m.children
    .filter((c) => c.name === 'note' && firstChild(c, 'pitch')));
  assert.equal(pitched[0].length, 1, '1小節目に音符1つ');
  assert.equal(pitched[1].length, 1, '2小節目に音符1つ');
  assert.equal(textOf(pitched[0][0], 'duration'), '8');
  assert.equal(textOf(pitched[1][0], 'duration'), '8');
  assert.equal(pitched[0][0].children.filter((c) => c.name === 'tie')[0].attrs.type, 'start');
  assert.equal(pitched[1][0].children.filter((c) => c.name === 'tie')[0].attrs.type, 'stop');
  assert.equal(findAll(root, 'tie').length, 2);
});

// ---------------------------------------------------------------------------
// 9. pad は書き出さない
// ---------------------------------------------------------------------------

test('pad は MusicXML にも MIDI にも書き出さない', () => {
  // pad にだけ現れる音（MIDI 100 と 101）を置いて、出力に現れないことを見る
  const s = fakeSong({
    melody: [{ midi: 60, beat: 0, dur: 4, vel: 0.5 }],
    accomp: [{ midi: 48, beat: 0, dur: 4, vel: 0.3 }],
    bass: [{ midi: 36, beat: 0, dur: 4, vel: 0.5 }],
    pad: [
      { midis: [100, 101], beat: 0, dur: 4, vel: 0.3 },
      { midis: [100, 101], beat: 4, dur: 6, vel: 0.3 },
    ],
  });
  const written = new Set(
    findAll(parseXml(toMusicXML(s)), 'pitch').map((p) => midiOfPitch(p)),
  );
  assert.deepEqual([...written].sort((a, b) => a - b), [36, 48, 60], 'pad の音が楽譜に出た');

  const file = parseMidiFile(toMidi(s));
  const pitches = new Set(file.tracks.flatMap((t) => noteOns(t).map((e) => e.data[0])));
  assert.deepEqual([...pitches].sort((a, b) => a - b), [36, 48, 60], 'pad の音が MIDI に出た');
});

test('pad の音数ぶんだけ MIDI のノートが増えていない', realOpts, () => {
  const s = song('a3f91c');
  const padNotes = s.pad.reduce((n, p) => n + pitchesOf(p).length, 0);
  assert.ok(padNotes > 0, 'この曲には pad が無い（検査が空振り）');
  const file = parseMidiFile(toMidi(s));
  const total = file.tracks.reduce((n, t) => n + noteOns(t).length, 0);
  const expected = s.melody.length + s.bass.length
    + s.accomp.reduce((n, a) => n + pitchesOf(a).length, 0);
  assert.equal(total, expected, 'ノート数が melody + accomp + bass と違う');
});

// ---------------------------------------------------------------------------
// 10. XMLエスケープ
// ---------------------------------------------------------------------------

test('MusicXML: seed の特殊文字がエスケープされる', () => {
  const xml = toMusicXML(fakeSong({ seed: 'a&b<c>"d\'e' }));
  assert.ok(xml.includes('a&amp;b&lt;c&gt;&quot;d&apos;e'), `エスケープされていない: ${xml.slice(0, 400)}`);
  assert.ok(!xml.includes('a&b'), '生の & が残っている');
  assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(xml), '実体参照でない & がある');
  // エスケープしたうえで、XMLとしても壊れていない
  const root = parseXml(xml);
  const title = findAll(root, 'work-title')[0];
  assert.ok(title.text.includes('&amp;'), 'work-title に seed が入っていない');
  assert.equal(findAll(root, 'measure').length, 2);
});

// ===========================================================================
// MIDI
// ===========================================================================

// ---------------------------------------------------------------------------
// 11. ヘッダ
// ---------------------------------------------------------------------------

test('MIDI: MThd / format 1 / トラック3 / division 480', realOpts, () => {
  for (const s of songs()) {
    const bytes = toMidi(s);
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
    const file = parseMidiFile(bytes);
    assert.equal(file.format, 1, 'format が 1 でない');
    assert.equal(file.ntrks, 3, 'トラック数が 3 でない');
    assert.equal(file.division, 480, 'division が 480 でない');
    assert.equal(file.tracks.length, 3, '実際のトラックが 3 本でない');
  }
});

// ---------------------------------------------------------------------------
// 12. 各トラックが MTrk で始まり、長さフィールドが実バイト数と一致する
// ---------------------------------------------------------------------------

test('MIDI: MTrk の長さフィールドが実際のバイト数と一致する', realOpts, () => {
  for (const s of songs()) {
    const bytes = toMidi(s);
    const file = parseMidiFile(bytes);
    let pos = 14;
    for (const track of file.tracks) {
      assert.equal(String.fromCharCode(...bytes.slice(pos, pos + 4)), 'MTrk');
      const len = ((bytes[pos + 4] * 256 + bytes[pos + 5]) * 256 + bytes[pos + 6]) * 256 + bytes[pos + 7];
      assert.equal(len, track.bytes.length, '長さフィールドと実データが違う');
      assert.equal(len, track.end - track.start, '長さフィールドと読み取り位置が違う');
      pos += 8 + len;
    }
    assert.equal(pos, bytes.length, 'ファイル全体の長さが合わない');
  }
});

// ---------------------------------------------------------------------------
// 13. 各トラックが FF 2F 00 で終わる
// ---------------------------------------------------------------------------

test('MIDI: 各トラックが End of Track で終わる', realOpts, () => {
  for (const s of songs()) {
    for (const track of parseMidiFile(toMidi(s)).tracks) {
      assert.deepEqual(track.bytes.slice(-3), [0xff, 0x2f, 0x00], 'FF 2F 00 で終わっていない');
      const last = track.events[track.events.length - 1];
      assert.equal(last.kind, 'meta');
      assert.equal(last.type, 0x2f);
      // End of Track は1トラックに1つだけ
      assert.equal(track.events.filter((e) => e.kind === 'meta' && e.type === 0x2f).length, 1);
    }
  }
});

// ---------------------------------------------------------------------------
// 14. 可変長数値の読み書きが往復する
// ---------------------------------------------------------------------------

test('MIDI: 可変長数値が往復する', () => {
  for (const value of [0, 1, 127, 128, 255, 8192, 16383, 16384, 0x0fffffff]) {
    const bytes = writeVariableLength(value);
    assert.ok(bytes.length >= 1 && bytes.length <= 4, `${value}: 長さが ${bytes.length}`);
    bytes.forEach((b, i) => {
      assert.ok(b >= 0 && b <= 255, `${value}: バイトが範囲外`);
      const isLast = i === bytes.length - 1;
      assert.equal((b & 0x80) !== 0, !isLast, `${value}: 継続ビットの立て方が違う`);
    });
    assert.deepEqual(readVariableLength(bytes, 0), { value, next: bytes.length },
      `${value}: 読み戻せない`);
    assert.deepEqual(readVar(bytes, 0), [value, bytes.length], `${value}: 独立実装で読めない`);
  }
  // 規格の代表例
  assert.deepEqual(writeVariableLength(0), [0x00]);
  assert.deepEqual(writeVariableLength(127), [0x7f]);
  assert.deepEqual(writeVariableLength(128), [0x81, 0x00]);
  assert.deepEqual(writeVariableLength(8192), [0xc0, 0x00]);
  assert.deepEqual(writeVariableLength(0x0fffffff), [0xff, 0xff, 0xff, 0x7f]);
  // 途中の位置から読んでも次の位置が返る
  const joined = [...writeVariableLength(128), ...writeVariableLength(8192)];
  const first = readVariableLength(joined, 0);
  assert.equal(first.value, 128);
  assert.deepEqual(readVariableLength(joined, first.next), { value: 8192, next: joined.length });
});

// ---------------------------------------------------------------------------
// 15. 読み戻し：ノートの数・開始tick・テンポ
// ---------------------------------------------------------------------------

test('MIDI: 読み戻すとノート・tick・テンポが元の曲と一致する', realOpts, () => {
  for (const bars of LENGTHS) {
    for (const seed of SEEDS) {
      const s = song(seed, bars);
      const file = parseMidiFile(toMidi(s));
      const [conductor, melodyTrack, accompTrack] = file.tracks;

      // テンポ
      const tempoEvents = conductor.events.filter((e) => e.kind === 'meta' && e.type === 0x51);
      assert.equal(tempoEvents.length, 1, 'テンポイベントが1つでない');
      const us = (tempoEvents[0].data[0] * 256 + tempoEvents[0].data[1]) * 256 + tempoEvents[0].data[2];
      assert.equal(Math.round(60000000 / us), s.tempo, `${seed}/${bars}: テンポが違う`);
      // 拍子と曲名
      assert.deepEqual(
        conductor.events.find((e) => e.kind === 'meta' && e.type === 0x58).data,
        [0x04, 0x02, 0x18, 0x08],
      );
      assert.ok(conductor.events.some((e) => e.kind === 'meta' && e.type === 0x03),
        'トラック0に曲名が無い');
      assert.equal(noteOns(conductor).length, 0, 'トラック0にノートがある');

      // 全ノートが閉じている
      const opened = [melodyTrack, accompTrack]
        .map((t, i) => checkNotesClosed(t, `${seed}/${bars} track${i + 1}`))
        .reduce((a, b) => a + b, 0);

      // ノート数が melody + accomp + bass と一致する
      const expectedMelody = s.melody.reduce((n, x) => n + pitchesOf(x).length, 0);
      const expectedAccomp = [...s.accomp, ...s.bass].reduce((n, x) => n + pitchesOf(x).length, 0);
      assert.equal(noteOns(melodyTrack).length, expectedMelody, `${seed}/${bars}: メロディーの音数`);
      assert.equal(noteOns(accompTrack).length, expectedAccomp, `${seed}/${bars}: 伴奏の音数`);
      assert.equal(opened, expectedMelody + expectedAccomp, `${seed}/${bars}: 総ノート数`);

      // 開始tickと音高が beat * 480 と一致する
      const expect = (layers) => layers.flatMap((layer) => layer.flatMap(
        (n) => pitchesOf(n).map((m) => `${Math.round(n.beat * TICKS_PER_BEAT)}:${m}`),
      )).sort();
      const actual = (track, channel) => noteOns(track).map((e) => {
        assert.equal(e.channel, channel, 'チャンネルが違う');
        return `${e.tick}:${e.data[0]}`;
      }).sort();
      assert.deepEqual(actual(melodyTrack, 0), expect([s.melody]), `${seed}/${bars}: メロディーの tick`);
      assert.deepEqual(actual(accompTrack, 1), expect([s.accomp, s.bass]), `${seed}/${bars}: 伴奏の tick`);

      // プログラムチェンジ（Acoustic Grand Piano）
      for (const [i, track] of [melodyTrack, accompTrack].entries()) {
        const pc = track.events.filter((e) => e.kind === 'channel' && e.status === 0xc0);
        assert.equal(pc.length, 1, 'プログラムチェンジが1つでない');
        assert.equal(pc[0].data[0], 0, 'プログラムが 0 でない');
        assert.equal(pc[0].channel, i, 'プログラムチェンジのチャンネルが違う');
      }
    }
  }
});

test('MIDI: イベントが時刻順に並び、同時刻はオフが先', realOpts, () => {
  for (const s of songs()) {
    for (const track of parseMidiFile(toMidi(s)).tracks) {
      let tick = -1;
      let sawOnAtTick = -1;
      for (const e of track.events) {
        assert.ok(e.tick >= tick, `イベントが時刻順でない (${e.tick} < ${tick})`);
        tick = e.tick;
        if (e.kind !== 'channel') continue;
        if (e.status === 0x90 && e.data[1] > 0) sawOnAtTick = e.tick;
        if (e.status === 0x80) {
          assert.notEqual(e.tick, sawOnAtTick, `tick ${e.tick}: オンのあとに同時刻のオフがある`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 16. ベロシティ
// ---------------------------------------------------------------------------

test('MIDI: ベロシティが 1〜127 に収まる', realOpts, () => {
  let checked = 0;
  for (const bars of LENGTHS) {
    for (const seed of SEEDS) {
      for (const track of parseMidiFile(toMidi(song(seed, bars))).tracks) {
        for (const e of noteOns(track)) {
          assert.ok(e.data[1] >= 1 && e.data[1] <= 127, `ベロシティが範囲外: ${e.data[1]}`);
          assert.ok(e.data[0] >= 0 && e.data[0] <= 127, `音高が範囲外: ${e.data[0]}`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 5000, `検査したノートが少なすぎる: ${checked}`);
});

test('MIDI: vel の写像が端でも 1〜127 に収まる', () => {
  const s = fakeSong({
    melody: [
      { midi: 60, beat: 0, dur: 1, vel: 0 },
      { midi: 61, beat: 1, dur: 1, vel: 1 },
      { midi: 62, beat: 2, dur: 1, vel: -5 },
      { midi: 63, beat: 3, dur: 1, vel: 9 },
      { midi: 64, beat: 4, dur: 1, vel: 0.5 },
    ],
  });
  const track = parseMidiFile(toMidi(s)).tracks[1];
  assert.deepEqual(noteOns(track).map((e) => e.data[1]), [1, 127, 1, 127, 64]);
});

// ---------------------------------------------------------------------------
// 17. 実データ10曲
// ---------------------------------------------------------------------------

test('MIDI: 実データ10曲が例外なく Uint8Array を返す', realOpts, () => {
  for (const s of songs()) {
    const bytes = toMidi(s);
    assert.ok(bytes instanceof Uint8Array, `${s.seed}: Uint8Array でない`);
    assert.ok(bytes.length > 500, `${s.seed}: 短すぎる (${bytes.length}バイト)`);
    for (const b of bytes) assert.ok(Number.isInteger(b) && b >= 0 && b <= 255);
  }
});

// ---------------------------------------------------------------------------
// 18. ファイル名
// ---------------------------------------------------------------------------

const FORBIDDEN = /[/\\:*?"<>|]/;

test('suggestFilename: 使えない文字を含まない', realOpts, () => {
  const names = [];
  for (const bars of LENGTHS) {
    for (const seed of SEEDS) {
      const s = song(seed, bars);
      for (const ext of ['musicxml', 'mid']) {
        const name = suggestFilename(s, ext);
        assert.ok(!FORBIDDEN.test(name), `使えない文字が入っている: ${name}`);
        // 制御文字と空白も入れない
        assert.ok(!/[\s -]/.test(name), `空白か制御文字が入っている: ${name}`);
        assert.ok(name.endsWith(`.${ext}`), `拡張子が違う: ${name}`);
        assert.ok(name.includes(seed), `seed が入っていない: ${name}`);
        assert.ok(name.includes(`${s.tempo}bpm`), `テンポが入っていない: ${name}`);
        assert.ok(name.includes(s.mode), `旋法が入っていない: ${name}`);
        names.push(name);
      }
    }
  }
  assert.ok(names.length === 60);
});

test('suggestFilename: 例と同じ形になる', () => {
  const s = fakeSong({ seed: 'a3f91c', tonicMidi: 57, mode: 'major', tempo: 84 });
  assert.equal(suggestFilename(s, 'musicxml'), 'piano-a3f91c-Amajor-84bpm.musicxml');
  assert.equal(suggestFilename(s, 'mid'), 'piano-a3f91c-Amajor-84bpm.mid');
});

// ===========================================================================
// 転調
// ===========================================================================

// ---------------------------------------------------------------------------
// 19. MusicXML：転調位置に新しい調号が出る
// ---------------------------------------------------------------------------

test('MusicXML: 転調すると <key> が2回出る', realOpts, () => {
  const mods = modulatedSongs();
  assert.ok(mods.length > 0, '転調する曲が1つも無い（検査が空振り）');
  for (const s of mods) {
    const measures = measuresOf(toMusicXML(s));
    const withKey = measures
      .map((m, i) => ({ i, key: findAll(m, 'key')[0] }))
      .filter((x) => x.key);
    assert.equal(withKey.length, 2, `${s.seed}: <key> が2回でない`);
    assert.equal(withKey[0].i, 0, `${s.seed}: 1つ目が1小節目に無い`);
    assert.equal(withKey[1].i, s.modulation.atBar, `${s.seed}: 2つ目が atBar に無い`);
  }
});

test('MusicXML: 転調しない曲の <key> は1回だけ', realOpts, () => {
  const plain = SEEDS.map((seed) => song(seed)).filter((s) => !s.modulation);
  assert.ok(plain.length > 0, '転調しない曲が1つも無い（検査が空振り）');
  for (const s of plain) {
    assert.equal(findAll(parseXml(toMusicXML(s)), 'key').length, 1, `${s.seed}: <key> が1回でない`);
    assert.ok(!toMusicXML(s).includes('light-light'), `${s.seed}: 複縦線がある`);
  }
});

test('MusicXML: 転調位置の fifths が keySignature(toTonicMidi, mode) と一致する', realOpts, () => {
  const mods = modulatedSongs();
  assert.ok(mods.length > 0, '転調する曲が1つも無い（検査が空振り）');
  for (const s of mods) {
    const measures = measuresOf(toMusicXML(s));
    const first = findAll(measures[0], 'key')[0];
    const second = findAll(measures[s.modulation.atBar], 'key')[0];
    assert.equal(Number(textOf(first, 'fifths')), fifthsOf(keySignature(s.tonicMidi, s.mode)),
      `${s.seed}: 曲頭の fifths`);
    assert.equal(Number(textOf(second, 'fifths')),
      fifthsOf(keySignature(s.modulation.toTonicMidi, s.mode)),
      `${s.seed}: 転調位置の fifths`);
    // 旋法は転調しても変わらない
    assert.equal(textOf(first, 'mode'), s.mode);
    assert.equal(textOf(second, 'mode'), s.mode);
    assert.notEqual(textOf(first, 'fifths'), textOf(second, 'fifths'), `${s.seed}: 調号が変わっていない`);
  }
});

test('MusicXML: 転調位置に複縦線が入る', realOpts, () => {
  const mods = modulatedSongs();
  assert.ok(mods.length > 0, '転調する曲が1つも無い（検査が空振り）');
  for (const s of mods) {
    const measures = measuresOf(toMusicXML(s));
    const marked = measures
      .map((m, i) => ({ i, bar: firstChild(m, 'barline') }))
      .filter((x) => x.bar);
    assert.equal(marked.length, 1, `${s.seed}: 複縦線が1つでない`);
    assert.equal(marked[0].i, s.modulation.atBar, `${s.seed}: 複縦線が atBar に無い`);
    assert.equal(marked[0].bar.attrs.location, 'left');
    assert.equal(textOf(marked[0].bar, 'bar-style'), 'light-light');
    // 小節の先頭に置く（音符より前）
    assert.equal(measures[s.modulation.atBar].children[0].name, 'barline', `${s.seed}: 複縦線が先頭でない`);
  }
});

test('MusicXML: 合成した転調曲でも fifths が両方正しい', () => {
  // ハ長調→ニ長調(0→2)、イ長調→変ロ長調(3→-2)、変ロ長調→ハ長調(-2→0)、イ短調→ロ短調(0→2)
  for (const [tonic, shift, mode] of [[60, 2, 'major'], [57, 1, 'major'], [58, 2, 'major'], [57, 2, 'minor']]) {
    const s = modSong(tonic, shift, mode);
    const measures = measuresOf(toMusicXML(s));
    const keys = measures.map((m) => findAll(m, 'key')[0]).map((k) => (k ? Number(textOf(k, 'fifths')) : null));
    assert.deepEqual(keys, [
      fifthsOf(keySignature(tonic, mode)),
      null,
      fifthsOf(keySignature(tonic + shift, mode)),
      null,
    ], `tonic=${tonic} +${shift} ${mode} の調号の並びが違う`);
  }
});

// ---------------------------------------------------------------------------
// 20. MusicXML：転調後も step/alter/octave が元の midi を再現する（最重要）
// ---------------------------------------------------------------------------

test('MusicXML: 転調後の全 note が元の midi を再現する', realOpts, () => {
  let checked = 0;
  for (const bars of LENGTHS) {
    const mods = modulatedSongs(bars);
    for (const s of mods) {
      const at = s.modulation.atBar;
      const layersOf = { 1: [s.melody], 2: [s.accomp, s.bass] };
      measuresOf(toMusicXML(s)).forEach((measure, i) => {
        if (i < at) return; // 転調後だけを見る
        const from = i * BEATS_PER_BAR;
        const to = from + BEATS_PER_BAR;
        const written = { 1: new Set(), 2: new Set() };
        for (const note of measure.children.filter((c) => c.name === 'note')) {
          const pitch = firstChild(note, 'pitch');
          if (!pitch) continue;
          const midi = midiOfPitch(pitch);
          assert.ok(Number.isInteger(midi) && midi >= 0 && midi <= 127,
            `${s.seed}/${bars} 小節${i + 1}: 復元した MIDI が範囲外 ${midi}`);
          written[textOf(note, 'staff')].add(midi);
          checked += 1;
        }
        for (const staff of ['1', '2']) {
          const sounding = soundingPitches(layersOf[staff], from, to);
          for (const midi of written[staff]) {
            assert.ok(sounding.has(midi),
              `${s.seed}/${bars} 小節${i + 1} staff${staff}: MIDI ${midi} は元データに無い`
              + `（転調後の半音ずれ？ 元データ: ${[...sounding].sort((a, b) => a - b).join(',')}）`);
          }
          for (const midi of onsetPitches(layersOf[staff], from, to, s.totalBeats)) {
            assert.ok(written[staff].has(midi),
              `${s.seed}/${bars} 小節${i + 1} staff${staff}: MIDI ${midi} が書き出されていない`);
          }
        }
      });
    }
  }
  assert.ok(checked > 200, `検査した音符が少なすぎる: ${checked}`);
});

test('MusicXML: 合成した転調曲で1音ずつ midi が一致する', () => {
  for (const [tonic, shift, mode] of [[60, 2, 'major'], [57, 1, 'major'], [61, 1, 'minor'], [58, 2, 'major']]) {
    const s = modSong(tonic, shift, mode, 4, 2);
    measuresOf(toMusicXML(s)).forEach((measure, i) => {
      const from = i * BEATS_PER_BAR;
      const to = from + BEATS_PER_BAR;
      const got = { 1: [], 2: [] };
      for (const note of measure.children.filter((c) => c.name === 'note')) {
        const pitch = firstChild(note, 'pitch');
        if (pitch) got[textOf(note, 'staff')].push(midiOfPitch(pitch));
      }
      const want = (layer) => layer
        .filter((n) => n.beat >= from && n.beat < to)
        .map((n) => n.midi);
      assert.deepEqual(got[1], want(s.melody),
        `tonic=${tonic} +${shift} 小節${i + 1}: メロディーの midi が違う`);
      assert.deepEqual(got[2], want(s.bass),
        `tonic=${tonic} +${shift} 小節${i + 1}: ベースの midi が違う`);
    });
  }
});

test('MusicXML: 転調後は臨時記号ではなく調号で書かれる（alter が調号ぶん動く）', () => {
  // ハ長調 → ニ長調。転調後の F#5(78) と C#5(73) は alter 1 を持つが、
  // 調号がシャープ2つなので楽譜ソフト側では臨時記号として描かれない。
  const s = modSong(60, 2, 'major', 4, 2);
  const measures = measuresOf(toMusicXML(s));
  const alters = (m) => m.children
    .filter((c) => c.name === 'note' && firstChild(c, 'pitch'))
    .map((c) => {
      const p = firstChild(c, 'pitch');
      return `${textOf(p, 'step')}${Number(textOf(p, 'alter'))}`;
    });
  // 転調前（ハ長調）: C E G B の並びに変化記号は付かない
  assert.ok(alters(measures[0]).every((a) => a.endsWith('0')), `転調前に alter が付いた: ${alters(measures[0])}`);
  // 転調後（ニ長調）: 2半音上がって D F# A C# になり、F と C が alter 1 を持つ
  const after = alters(measures[2]);
  assert.ok(after.includes('F1'), `F# が無い: ${after}`);
  assert.ok(after.includes('C1'), `C# が無い: ${after}`);
  assert.equal(Number(textOf(findAll(measures[2], 'key')[0], 'fifths')), 2, '調号がシャープ2つでない');
});

// ---------------------------------------------------------------------------
// 21. MusicXML：転調ありでも duration 合計が16
// ---------------------------------------------------------------------------

test('MusicXML: 転調ありでも全小節・全 staff の duration 合計が 16', realOpts, () => {
  let seen = 0;
  for (const bars of LENGTHS) {
    for (const s of modulatedSongs(bars)) {
      seen += 1;
      const measures = measuresOf(toMusicXML(s));
      assert.equal(measures.length, s.bars, `${s.seed}/${bars}: 小節数が合わない`);
      measures.forEach((measure, i) => {
        const sum = { 1: 0, 2: 0 };
        for (const note of measure.children.filter((c) => c.name === 'note')) {
          if (hasChild(note, 'chord')) continue;
          sum[textOf(note, 'staff')] += Number(textOf(note, 'duration'));
        }
        assert.equal(sum[1], 16, `${s.seed}/${bars} 小節${i + 1}: staff 1 の合計が ${sum[1]}`);
        assert.equal(sum[2], 16, `${s.seed}/${bars} 小節${i + 1}: staff 2 の合計が ${sum[2]}`);
      });
      // backup は転調小節でも1つだけ（<attributes> を挟んでも増えない）
      assert.equal(findAll(parseXml(toMusicXML(s)), 'backup').length, s.bars, `${s.seed}/${bars}: backup の数`);
    }
  }
  assert.ok(seen > 0, '転調する曲が1つも無い（検査が空振り）');
});

// ---------------------------------------------------------------------------
// 22. MIDI：キーシグネチャのメタイベント
// ---------------------------------------------------------------------------

test('MIDI: 転調するとキーシグネチャが2つ出る（曲頭と転調位置）', realOpts, () => {
  const mods = modulatedSongs();
  assert.ok(mods.length > 0, '転調する曲が1つも無い（検査が空振り）');
  for (const s of mods) {
    const file = parseMidiFile(toMidi(s));
    const [conductor, ...rest] = file.tracks;
    const sigs = keySignatures(conductor);
    assert.equal(sigs.length, 2, `${s.seed}: キーシグネチャが2つでない`);
    // トラック0（テンポトラック）に置く。他のトラックには出さない
    for (const t of rest) assert.equal(keySignatures(t).length, 0, `${s.seed}: 他のトラックにある`);

    const mi = s.mode === 'minor' ? 1 : 0;
    assert.deepEqual(sigs[0], { tick: 0, sf: fifthsOf(keySignature(s.tonicMidi, s.mode)), mi },
      `${s.seed}: 曲頭のキーシグネチャ`);
    assert.deepEqual(sigs[1], {
      tick: s.modulation.atBar * BEATS_PER_BAR * TICKS_PER_BEAT,
      sf: fifthsOf(keySignature(s.modulation.toTonicMidi, s.mode)),
      mi,
    }, `${s.seed}: 転調位置のキーシグネチャ`);
  }
});

test('MIDI: 転調しない曲でも曲頭にキーシグネチャが1つ出る', realOpts, () => {
  const plain = SEEDS.map((seed) => song(seed)).filter((s) => !s.modulation);
  assert.ok(plain.length > 0, '転調しない曲が1つも無い（検査が空振り）');
  for (const s of plain) {
    const sigs = keySignatures(parseMidiFile(toMidi(s)).tracks[0]);
    assert.equal(sigs.length, 1, `${s.seed}: キーシグネチャが1つでない`);
    assert.deepEqual(sigs[0], {
      tick: 0,
      sf: fifthsOf(keySignature(s.tonicMidi, s.mode)),
      mi: s.mode === 'minor' ? 1 : 0,
    }, `${s.seed}: 曲頭のキーシグネチャ`);
  }
});

test('MIDI: キーシグネチャの sf はフラットが負の符号付き8bit', () => {
  // 変ニ長調(-5) → ニ長調(+2)。負の数は2の補数のバイトで書く
  const s = modSong(61, 1, 'major', 4, 2);
  const sigs = keySignatures(parseMidiFile(toMidi(s)).tracks[0]);
  assert.deepEqual(sigs.map((g) => [g.tick, g.sf, g.mi]), [[0, -5, 0], [2 * 4 * 480, 2, 0]]);
  // 生バイト列にも 0xfb（-5）が入っている
  const raw = parseMidiFile(toMidi(s)).tracks[0].bytes;
  const at = raw.findIndex((b, i) => b === 0xff && raw[i + 1] === 0x59);
  assert.deepEqual(raw.slice(at, at + 5), [0xff, 0x59, 0x02, 0xfb, 0x00]);
  // 短調は mi = 1
  const minor = keySignatures(parseMidiFile(toMidi(modSong(57, 2, 'minor', 4, 2))).tracks[0]);
  assert.deepEqual(minor.map((g) => [g.tick, g.sf, g.mi]), [[0, 0, 1], [2 * 4 * 480, 2, 1]]);
});

test('MIDI: 転調のキーシグネチャの tick が atBar * 4 * 480 と一致する', realOpts, () => {
  let seen = 0;
  for (const bars of LENGTHS) {
    for (const s of modulatedSongs(bars)) {
      seen += 1;
      const sigs = keySignatures(parseMidiFile(toMidi(s)).tracks[0]);
      assert.equal(sigs.length, 2, `${s.seed}/${bars}: キーシグネチャが2つでない`);
      assert.equal(sigs[1].tick, s.modulation.atBar * BEATS_PER_BAR * TICKS_PER_BEAT,
        `${s.seed}/${bars}: 転調の tick が atBar*4*480 と違う`);
      // デルタタイムの積み上げが狂っていないこと：
      // トラック0の他のイベントは全て tick 0、末尾の End of Track は転調と同時刻
      const conductor = parseMidiFile(toMidi(s)).tracks[0];
      const last = conductor.events[conductor.events.length - 1];
      assert.equal(last.type, 0x2f, 'End of Track で終わっていない');
      assert.equal(last.tick, sigs[1].tick, 'End of Track の時刻がずれた');
      for (const e of conductor.events) {
        assert.ok(e.tick === 0 || e.tick === sigs[1].tick, `想定外の時刻のイベント: tick ${e.tick}`);
      }
    }
  }
  assert.ok(seen > 0, '転調する曲が1つも無い（検査が空振り）');
});

test('MIDI: 転調しても音数と tick は元の曲と一致する', realOpts, () => {
  const mods = modulatedSongs();
  assert.ok(mods.length > 0, '転調する曲が1つも無い（検査が空振り）');
  for (const s of mods) {
    const [, melodyTrack, accompTrack] = parseMidiFile(toMidi(s)).tracks;
    const expect = (layers) => layers.flatMap((layer) => layer.flatMap(
      (n) => pitchesOf(n).map((m) => `${Math.round(n.beat * TICKS_PER_BEAT)}:${m}`),
    )).sort();
    const actual = (track) => noteOns(track).map((e) => `${e.tick}:${e.data[0]}`).sort();
    assert.deepEqual(actual(melodyTrack), expect([s.melody]), `${s.seed}: メロディー`);
    assert.deepEqual(actual(accompTrack), expect([s.accomp, s.bass]), `${s.seed}: 伴奏`);
    checkNotesClosed(melodyTrack, `${s.seed} melody`);
    checkNotesClosed(accompTrack, `${s.seed} accomp`);
  }
});

test('suggestFilename: 危ない入力でも安全な名前になる', () => {
  const nasty = fakeSong({
    seed: '../../etc/passwd?*<>|:"\\ \n',
    tonicMidi: 66, // 嬰ヘ長調（F#）
    mode: 'minor',
    tempo: 72,
  });
  const name = suggestFilename(nasty, 'mid');
  assert.ok(!FORBIDDEN.test(name), `使えない文字が入っている: ${name}`);
  assert.ok(!name.includes('..'), `親ディレクトリを指せる: ${name}`);
  assert.ok(!name.includes('#'), `# が残っている: ${name}`);
  assert.equal(name, 'piano-etcpasswd-Fsharpminor-72bpm.mid');
  // 拡張子側も掃除する
  const weird = suggestFilename(fakeSong({ seed: 'x' }), '../evil');
  assert.ok(!FORBIDDEN.test(weird), weird);
  assert.equal(weird.split('.').length, 2, `拡張子が1つでない: ${weird}`);
});
