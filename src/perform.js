// 拍単位のクオンタイズされた曲を、秒単位の「人間味のある演奏イベント列」に変換する。
// Web Audio には一切依存しない純関数モジュール。
//
// 完全にクオンタイズされた演奏は、メロディーが良くても機械的で冷たく聴こえる。
// ここで加える微小な揺らぎ（タイミング・ベロシティ・テヌート・リタルダンド）が
// 曲の表情を決める。
import { makeRng, seedFromString } from './rng.js';

/**
 * @typedef {{ kind: 'piano', layer: 'melody'|'accomp'|'bass', at: number, midi: number, dur: number, vel: number }} PianoEvent
 * @typedef {{ kind: 'pad', at: number, midis: number[], dur: number, vel: number }} PadEvent
 * @typedef {PianoEvent | PadEvent} PerfEvent
 */

// ピアノ系レイヤーの処理順。乱数を1本の列から消費するので、
// この順序を変えると同じシードでも再現できなくなる。
const PIANO_LAYERS = ['melody', 'accomp', 'bass'];

// メロディーは揺らぎを全量、伴奏とベースは半量。
// 伴奏まで大きく揺らすと土台がぐらついて不安に聴こえる。
const JITTER_SCALE = { melody: 1, accomp: 0.5, bass: 0.5 };

// ベロシティの下限・上限。0 だと無音、1 超えは歪みの原因になる。
const VEL_MIN = 0.05;
const VEL_MAX = 1.0;

// テヌート時の「ため」と音価の伸ばし率。
const TENUTO_DELAY_SEC = 0.03;
const TENUTO_DUR_RATIO = 1.15;

// リタルダンドの範囲（最後の2小節＝8拍）と最大の遅れ（0.5拍ぶん）。
const RIT_BEATS = 8;
const RIT_MAX_BEATS = 0.5;

const SETTING_DEFAULTS = {
  timingJitterMs: 10,
  velocityJitter: 8,
  tenuto: true,
  ritardando: true,
};

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function numOr(raw, fallback, min, max) {
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

function boolOr(raw, fallback) {
  return raw === undefined || raw === null ? fallback : !!raw;
}

// settings.js の PARAM_DEFS と同じ範囲に丸める。
// 部分的な settings オブジェクトを渡しても既定値で埋まる。
function resolveSettings(settings) {
  const s = settings ?? {};
  return {
    timingJitterMs: numOr(s.timingJitterMs, SETTING_DEFAULTS.timingJitterMs, 0, 30),
    velocityJitter: numOr(s.velocityJitter, SETTING_DEFAULTS.velocityJitter, 0, 25),
    tenuto: boolOr(s.tenuto, SETTING_DEFAULTS.tenuto),
    ritardando: boolOr(s.ritardando, SETTING_DEFAULTS.ritardando),
  };
}

/**
 * 曲を演奏イベント列に変換する。
 * @param {object} song compose.js が生成した曲オブジェクト
 * @param {object} [settings] humanize 系の設定（欠けたキーは既定値）
 * @returns {{ events: PerfEvent[], durationSec: number }}
 */
export function buildPerformance(song, settings) {
  const cfg = resolveSettings(settings);
  const spb = 60 / song.tempo; // 1拍の秒数
  // 乱数は1本だけ。曲シードから派生させるので、同じ曲コードなら演奏まで完全に再現する。
  const rng = makeRng(seedFromString(String(song.seed) + ':perf'));

  const ritStart = (song.bars - 2) * 4;
  // 終盤の遅れ。全レイヤーに同じ値を掛けないとレイヤー同士がばらける。
  const ritDelay = (beat) => {
    if (!cfg.ritardando || !(beat >= ritStart)) return 0;
    const t = clamp((beat - ritStart) / RIT_BEATS, 0, 1);
    return t * t * RIT_MAX_BEATS * spb;
  };

  /** @type {PerfEvent[]} */
  const events = [];

  // melody → accomp → bass → pad の順で乱数を消費する（順序厳守）。
  for (const layer of PIANO_LAYERS) {
    const notes = song[layer] ?? [];
    const scale = JITTER_SCALE[layer];
    for (const n of notes) {
      // 揺らぎ幅が 0 でも必ず乱数を1つずつ引く。設定を変えても列がずれない。
      const timing = (rng() - 0.5) * 2 * (cfg.timingJitterMs / 1000) * scale;
      const vel = clamp(n.vel * (1 + (rng() - 0.5) * 2 * (cfg.velocityJitter / 100)), VEL_MIN, VEL_MAX);

      let at = n.beat * spb + timing;
      let dur = n.dur * spb;

      // 頂点音だけ、ほんの少し遅らせて長めに鳴らす。曲中で最も効く揺らぎ。
      if (cfg.tenuto && layer === 'melody' && n.beat === song.climaxBeat) {
        at += TENUTO_DELAY_SEC;
        dur *= TENUTO_DUR_RATIO;
      }

      at += ritDelay(n.beat);
      events.push({ kind: 'piano', layer, at: Math.max(0, at), midi: n.midi, dur, vel });
    }
  }

  // パッドはゆっくり立ち上がるので、タイミングもベロシティも揺らさない。
  for (const p of song.pad ?? []) {
    const at = p.beat * spb + ritDelay(p.beat);
    events.push({
      kind: 'pad',
      at: Math.max(0, at),
      midis: p.midis.slice(),
      dur: p.dur * spb,
      vel: clamp(p.vel, VEL_MIN, VEL_MAX),
    });
  }

  // Array#sort は安定なので、同時刻のイベントはレイヤー順のまま残る。
  events.sort((a, b) => a.at - b.at);

  let durationSec = 0;
  for (const e of events) {
    const end = e.at + e.dur;
    if (end > durationSec) durationSec = end;
  }

  return { events, durationSec };
}
