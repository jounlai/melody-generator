// 標準MIDIファイル（SMF）を読む。依存パッケージは使わない。
//
// このプロジェクトが MIDI を読むのは「解析のため」だけで、読んだ音符そのものを
// リポジトリへ残すことはしない（著作権法30条の4が許すのは解析であって、
// 複製物の公衆送信ではない）。出力側に残ってよいのは統計だけ。
//
// 対応するのは format 0 / 1 の、note on/off・テンポ・拍子・トラック名だけ。
// 音色やコントロールチェンジは読み飛ばす。

/** 可変長数値。MIDI のデルタタイムはこの形で入っている。 */
function readVarInt(buf, pos) {
  let value = 0;
  let i = pos;
  for (;;) {
    const b = buf[i];
    i += 1;
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
    if (i - pos > 4) break; // 壊れたファイルで無限に読まない
  }
  return [value, i];
}

function readChunk(buf, pos) {
  const id = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
  const length = buf.readUInt32BE(pos + 4);
  return { id, length, body: pos + 8, next: pos + 8 + length };
}

/**
 * トラック1本を、ティック単位の音符と、テンポ・拍子の変化に分解する。
 * running status（ステータスバイトの省略）に対応する。
 */
function parseTrack(buf, from, to) {
  const notes = [];
  const tempos = [];
  const meters = [];
  const sounding = new Map(); // `${ch}:${midi}` -> { tick, vel }
  let name = '';
  let tick = 0;
  let status = 0;
  let i = from;

  while (i < to) {
    const [delta, afterDelta] = readVarInt(buf, i);
    tick += delta;
    i = afterDelta;
    let b = buf[i];

    if (b === 0xff) { // メタイベント
      const type = buf[i + 1];
      const [len, afterLen] = readVarInt(buf, i + 2);
      const body = afterLen;
      if (type === 0x03 && !name) {
        name = buf.slice(body, body + len).toString('latin1');
      } else if (type === 0x51 && len === 3) {
        tempos.push({ tick, usPerBeat: (buf[body] << 16) | (buf[body + 1] << 8) | buf[body + 2] });
      } else if (type === 0x58 && len >= 2) {
        meters.push({ tick, numerator: buf[body], denominator: 2 ** buf[body + 1] });
      }
      i = body + len;
      continue;
    }

    if (b === 0xf0 || b === 0xf7) { // システムエクスクルーシブ。読み飛ばす
      const [len, afterLen] = readVarInt(buf, i + 1);
      i = afterLen + len;
      continue;
    }

    if ((b & 0x80) === 0) {
      b = status; // running status
    } else {
      status = b;
      i += 1;
    }
    const type = b & 0xf0;
    const channel = b & 0x0f;

    if (type === 0x80 || type === 0x90) {
      const midi = buf[i];
      const vel = buf[i + 1];
      i += 2;
      const key = `${channel}:${midi}`;
      if (type === 0x90 && vel > 0) {
        sounding.set(key, { tick, vel });
      } else {
        const on = sounding.get(key);
        if (on) {
          sounding.delete(key);
          notes.push({ channel, midi, tick: on.tick, dur: tick - on.tick, vel: on.vel });
        }
      }
      continue;
    }
    // 残りはデータバイトの数だけ読み飛ばす
    if (type === 0xc0 || type === 0xd0) i += 1;
    else i += 2;
  }
  notes.sort((a, b2) => a.tick - b2.tick || a.midi - b2.midi);
  return { name, notes, tempos, meters };
}

/**
 * SMF を読む。
 * @returns {{ division:number, format:number, tracks:Array, tempos:Array, meters:Array }}
 */
export function readMidi(buf) {
  const head = readChunk(buf, 0);
  if (head.id !== 'MThd') throw new Error('MThd がない');
  const format = buf.readUInt16BE(head.body);
  const trackCount = buf.readUInt16BE(head.body + 2);
  const division = buf.readUInt16BE(head.body + 4);
  if (division & 0x8000) throw new Error('SMPTE 形式は未対応');

  const tracks = [];
  const tempos = [];
  const meters = [];
  let pos = head.next;
  for (let t = 0; t < trackCount && pos < buf.length; t += 1) {
    const chunk = readChunk(buf, pos);
    pos = chunk.next;
    if (chunk.id !== 'MTrk') continue;
    const parsed = parseTrack(buf, chunk.body, chunk.body + chunk.length);
    tracks.push(parsed);
    tempos.push(...parsed.tempos);
    meters.push(...parsed.meters);
  }
  tempos.sort((a, b) => a.tick - b.tick);
  meters.sort((a, b) => a.tick - b.tick);
  return { format, division, tracks, tempos, meters };
}
