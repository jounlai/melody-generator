// 拍単位のクオンタイズされた曲を、秒単位の「人間味のある演奏イベント列」に変換する。
// Web Audio には一切依存しない純関数モジュール。
//
// ここでやることは大きく2つある。
//
// 1. 揺らぎ（humanize）: タイミング・ベロシティの微小なばらつき、頂点音のテヌート、
//    終盤のリタルダンド。設定でON/OFFできる「味付け」。
// 2. 強弱設計（dynamics）: フレーズごとの膨らみと収め、セクションごとの基準レベル、
//    クライマックスへのクレッシェンドとその直後の脱力。
//
// 2 は味付けではなく音楽の骨格なので、設定に関係なく常に適用する。
// 強弱が平坦な演奏は、旋律がどれほど良くても人の心を動かさない。
// 人間のピアニストは1フレーズごとに必ず膨らませて収める。ここを機械がサボると
// 「上手いが感動しない」演奏になる。
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

// ---- 強弱設計 ----

// 2小節（8拍）を1フレーズと見なす。ヒーリング系の緩いテンポでは
// これが「ひと息」の長さにちょうど合う。
const PHRASE_BEATS = 8;

// フレーズ内スウェルの深さ。頂点で 1.0、フレーズの端で 1-0.18 = 0.82 程度。
// これ以上深くすると弱拍が痩せて旋律線が途切れて聴こえる。
const SWELL_DEPTH = 0.18;
// 頂点がフレーズの端に来たときのゼロ除算よけ兼、深さの上限調整。
const SWELL_MIN_SPAN = 0.25;

// セクションごとの基準レベル [開始, 終了]。
// A で提示し、A' で少し前へ出て、B で最も鳴らし、A'' で静かに閉じる。
// A'' だけはセクション内を線形に下げて、曲の終わりに向かって収める。
const SECTION_LEVEL = {
  A: [0.85, 0.85],
  "A'": [0.95, 0.95],
  B: [1.1, 1.1],
  "A''": [0.8, 0.55],
};

// クライマックスへの大きなクレッシェンドと、その直後の解放。
const CRESC_BEATS = 8;      // 手前2小節かけて持ち上げる
const CRESC_FROM = 0.88;    // その入口のレベル
const CLIMAX_LEVEL = 1.2;   // 頂点
const RELEASE_BEATS = 4;    // 直後1小節で
const RELEASE_TO = 0.75;    // 一気に落とす。この落差が「サビの後の脱力」になる

// 伴奏・ベース・パッドは同じ強弱カーブを深さ60%で追う。
// メロディーだけが強弱を持つとテクスチャが分離して不自然に聴こえる。
const ACCOMP_DEPTH = 0.6;

// ---- ルバート ----

// クライマックス手前2拍の「ためらい」。最大0.1拍ぶん引き伸ばす。
const HESITATE_BEATS = 2;
const HESITATE_MAX_BEATS = 0.1;

// フレーズ末の呼吸。息継ぎの前にわずかに伸ばす。
const BREATH_DELAY_SEC = 0.015;
const BREATH_DUR_RATIO = 1.08;

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

// セクションを [開始拍, 終了拍) の並びに直す。
// startBar しか持たないので、次のセクションの頭までを自分の範囲とみなす。
function sectionRanges(song) {
  const raw = Array.isArray(song.sections) ? song.sections : [];
  const secs = raw
    .filter((s) => s && Number.isFinite(Number(s.startBar)))
    .sort((a, b) => Number(a.startBar) - Number(b.startBar));
  if (secs.length === 0) return [];

  const totalBeats = Number.isFinite(Number(song.totalBeats))
    ? Number(song.totalBeats)
    : Number(song.bars) * 4;

  return secs.map((s, i) => {
    const startBeat = Number(s.startBar) * 4;
    const next = secs[i + 1];
    const rawEnd = next ? Number(next.startBar) * 4 : totalBeats;
    // 長さ0のセクションは割り算を壊すので、最低1拍は確保する。
    const endBeat = Number.isFinite(rawEnd) && rawEnd > startBeat ? rawEnd : startBeat + 1;
    return { name: s.name, startBeat, endBeat };
  });
}

// 各フレーズの「最高音の位置」を 0〜1 で返す表。ここがスウェルの山になる。
// 同じ高さが複数あれば先に出てきた方を頂点にする（決定論性のため）。
function phrasePeaks(melody) {
  const best = new Map();
  for (const n of melody) {
    const ph = Math.floor(n.beat / PHRASE_BEATS);
    const cur = best.get(ph);
    if (cur === undefined || n.midi > cur.midi) best.set(ph, { midi: n.midi, beat: n.beat });
  }
  const peaks = new Map();
  for (const [ph, b] of best) peaks.set(ph, (b.beat - ph * PHRASE_BEATS) / PHRASE_BEATS);
  return peaks;
}

// 各フレーズで最後に鳴るメロディー音の index 集合。フレーズ末の呼吸を掛ける対象。
// 同時刻に複数あれば後ろの音を「最後」とする。
function phraseLastIndexes(melody) {
  const last = new Map();
  for (let i = 0; i < melody.length; i++) {
    const ph = Math.floor(melody[i].beat / PHRASE_BEATS);
    const cur = last.get(ph);
    if (cur === undefined || melody[i].beat >= melody[cur].beat) last.set(ph, i);
  }
  return new Set(last.values());
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

  const melodyNotes = song.melody ?? [];
  const ranges = sectionRanges(song);
  const peaks = phrasePeaks(melodyNotes);
  const lastOfPhrase = phraseLastIndexes(melodyNotes);
  const climaxBeat = Number(song.climaxBeat);
  const hasClimax = Number.isFinite(climaxBeat);

  // 第1層: セクションの基準レベル。A'' だけはセクション内で下降する。
  const sectionLevel = (beat) => {
    if (ranges.length === 0) return 1;
    let idx = 0;
    for (let i = 0; i < ranges.length; i++) if (beat >= ranges[i].startBeat) idx = i;
    const r = ranges[idx];
    const lv = SECTION_LEVEL[r.name];
    if (!lv) return 1;
    if (lv[0] === lv[1]) return lv[0];
    const t = clamp((beat - r.startBeat) / (r.endBeat - r.startBeat), 0, 1);
    return lv[0] + (lv[1] - lv[0]) * t;
  };

  // 第2層: フレーズ内のスウェル。フレーズの最高音を山にして膨らませ、端で収める。
  const swell = (beat) => {
    const ph = Math.floor(beat / PHRASE_BEATS);
    const q = peaks.get(ph);
    if (q === undefined) return 1; // メロディーの無いフレーズは平坦のまま
    const p = (beat - ph * PHRASE_BEATS) / PHRASE_BEATS;
    // 頂点が端に寄っていても割り算が壊れないよう、分母に下限を入れる。
    const span = Math.max(q, 1 - q, SWELL_MIN_SPAN);
    return 1 - (SWELL_DEPTH * Math.abs(p - q)) / span;
  };

  // 第3層: クライマックスへのクレッシェンドと、その直後の脱力。
  const climaxCurve = (beat) => {
    if (!hasClimax) return 1;
    if (beat === climaxBeat) return CLIMAX_LEVEL;
    if (beat >= climaxBeat - CRESC_BEATS && beat < climaxBeat) {
      const u = (beat - (climaxBeat - CRESC_BEATS)) / CRESC_BEATS;
      return CRESC_FROM + (CLIMAX_LEVEL - CRESC_FROM) * u;
    }
    if (beat > climaxBeat && beat <= climaxBeat + RELEASE_BEATS) {
      const v = (beat - climaxBeat) / RELEASE_BEATS;
      return CLIMAX_LEVEL + (RELEASE_TO - CLIMAX_LEVEL) * v;
    }
    return 1;
  };

  // メロディーの強弱係数。伴奏系はこれを 60% の深さで追う。
  const dynMelody = (beat) => sectionLevel(beat) * swell(beat) * climaxCurve(beat);
  const dynAccomp = (beat) => 1 + (dynMelody(beat) - 1) * ACCOMP_DEPTH;

  const ritStart = (song.bars - 2) * 4;
  // 終盤の遅れ。全レイヤーに同じ値を掛けないとレイヤー同士がばらける。
  const ritDelay = (beat) => {
    if (!cfg.ritardando || !(beat >= ritStart)) return 0;
    const t = clamp((beat - ritStart) / RIT_BEATS, 0, 1);
    return t * t * RIT_MAX_BEATS * spb;
  };

  // クライマックス手前の「ためらい」。頂点に向かって少しずつ引き伸ばす。
  // メロディーだけ遅らせるとバラバラに聴こえるので、パッドを含む全レイヤーに掛ける。
  const hesitate = (beat) => {
    if (!hasClimax) return 0;
    if (!(beat >= climaxBeat - HESITATE_BEATS && beat < climaxBeat)) return 0;
    const u = (beat - (climaxBeat - HESITATE_BEATS)) / HESITATE_BEATS;
    return u * u * HESITATE_MAX_BEATS * spb;
  };

  /** @type {PerfEvent[]} */
  const events = [];

  // melody → accomp → bass → pad の順で乱数を消費する（順序厳守）。
  for (const layer of PIANO_LAYERS) {
    const notes = song[layer] ?? [];
    const scale = JITTER_SCALE[layer];
    const dyn = layer === 'melody' ? dynMelody : dynAccomp;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      // 揺らぎ幅が 0 でも必ず乱数を1つずつ引く。設定を変えても列がずれない。
      const timing = (rng() - 0.5) * 2 * (cfg.timingJitterMs / 1000) * scale;
      const jittered = n.vel * (1 + (rng() - 0.5) * 2 * (cfg.velocityJitter / 100));
      const vel = clamp(jittered * dyn(n.beat), VEL_MIN, VEL_MAX);

      let at = n.beat * spb + timing;
      let dur = n.dur * spb;

      const isClimaxNote = layer === 'melody' && hasClimax && n.beat === climaxBeat;

      // 頂点音だけ、ほんの少し遅らせて長めに鳴らす。曲中で最も効く揺らぎ。
      if (cfg.tenuto && isClimaxNote) {
        at += TENUTO_DELAY_SEC;
        dur *= TENUTO_DUR_RATIO;
      }

      // フレーズ末の呼吸。息継ぎの前にわずかに伸ばす、ピアニストが必ずやる動作。
      // 頂点音はテヌートと二重に掛かるので除く。
      if (layer === 'melody' && !isClimaxNote && lastOfPhrase.has(i)) {
        at += BREATH_DELAY_SEC;
        dur *= BREATH_DUR_RATIO;
      }

      at += hesitate(n.beat);
      at += ritDelay(n.beat);
      const start = Math.max(0, at);

      // 曲の最終小節だけ、伴奏は刻みをやめて和音を保持する。compose 側が
      // その1イベントに midis（全構成音）を入れてくるので、ここで和音に開く。
      // 乱数は1イベントにつき2つのまま（音数で消費が変わると再現性が壊れる）。
      const chord = Array.isArray(n.midis) && n.midis.length > 0 ? n.midis : null;
      if (chord) {
        for (const midi of chord) {
          events.push({ kind: 'piano', layer, at: start, midi, dur, vel });
        }
      } else {
        events.push({ kind: 'piano', layer, at: start, midi: n.midi, dur, vel });
      }
    }
  }

  // パッドはゆっくり立ち上がるので、タイミングもベロシティも揺らさない。
  // ただし強弱とルバートはテクスチャ全体で揃える。
  for (const p of song.pad ?? []) {
    const at = p.beat * spb + hesitate(p.beat) + ritDelay(p.beat);
    events.push({
      kind: 'pad',
      at: Math.max(0, at),
      midis: p.midis.slice(),
      dur: p.dur * spb,
      vel: clamp(p.vel * dynAccomp(p.beat), VEL_MIN, VEL_MAX),
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
