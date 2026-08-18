// Web Audio による音源。サンプルファイルは一切使わず、
// すべてオシレータと手続き生成のインパルス応答・ノイズで合成する。
//
// シグナルチェーン:
//   メロディー/伴奏/パッド → 各レイヤーゲイン → バス
//     → ドライ ─────────────┐
//     → コンボルバー → ウェット ┴→ リミッタ → マスターゲイン → destination
//
// 音色は TIMBRES に、その組み合わせ（どの声部に何を使うか）は instrument.js にある。
//
// 本ファイル内に限り Math.random() の使用を許可する（リバーブIR・ノイズ・デチューン）。
// 作曲・演奏の経路はシード由来のPRNGを使うため、ここでの乱数は曲の再現性に影響しない。
import { layersFor } from './instrument.js';

// --- 定数（音作りの骨格。ユーザーが触る値は settings 側にある） ---

const MIN_GAIN = 0.0001; // exponentialRampToValueAtTime に 0 は渡せないため、実質無音のこの値を使う
const TAIL_SEC = 0.05; // stop() をリリース終端よりわずかに後ろへ置く余裕

// silence() で音を落とす時間。短すぎると波形の途中で切れてプツッと鳴る
const SILENCE_FADE_SEC = 0.06;
// 無音のあとに音量を戻す時間。一瞬で戻すと戻した瞬間が段差として聴こえる
const RESTORE_SEC = 0.04;

const REVERB_SECONDS = 3.5;
const REVERB_DECAY_POWER = 2.6; // 大きいほど尾が速く消える
const REVERB_TONE = 0.28; // 1極ローパスの係数。小さいほど暗い残響
const WET_MAX = 1.1; // reverbAmount = 100 のときのウェットゲイン
const DRY_GAIN = 1.0;

// 出力の底上げ。
//
// 実測すると、書き出した音のピークは -11〜-15 dBFS しかなく、
// 使える音量を10dB以上余らせていた。据え置きのスピーカーやヘッドホンでは
// 「静かな曲」で済むが、スマートフォンの内蔵スピーカーではそのまま
// 「聴こえない」になる。小さい音を小さく鳴らすのと、
// 小さい音しか出せないのは別のことである。
//
// リミッタの手前で持ち上げるので、突出したところはリミッタが受け止める。
// 値は実測で選んだ（音量つまみ85・30秒・3曲平均）。
//   1.0  ピーク -5.3 / RMS -24.8 / 曲中の抑揚 11.6 dB   ← 元。小さすぎる
//   2.4  ピーク -1.5 / RMS -19.7 / 抑揚 11.4 dB
//   3.0  ピーク -0.7 / RMS -17.7 / 抑揚 11.6 dB          ← 採用。抑揚は無傷
//   3.6  ピーク -1.7 / RMS -16.2 / 抑揚 11.5 dB（伸びが止まる）
const OUTPUT_MAKEUP = 3.0;

// 出力の天井。音量つまみを最大にしても 0 dBFS を越えないための余裕。
//
// リミッタは音楽的に効かせたい圧縮器であって、ぴったり止まる壁ではない。
// 実測では、つまみ最大でピークが +1.1 dBFS まで出て歪む。
// リミッタを固くして止めると抑揚まで潰れる（実測: しきい値 -6 で
// 曲中の抑揚が 12.0 → 10.8 dB へ落ちた）ので、圧縮ではなく
// 最後に一律で下げるほうを選ぶ。0.8 は -1.9 dB。
const MASTER_CEILING = 0.8;

const PAD_FILTER_Q = 0.5;
const PAD_MIN_RELEASE_SEC = 2.0;
const PAD_DETUNE_CENTS = 4; // ±4セントのランダムデチューンで厚みを出す

// 各レイヤーの1音あたりのピーク振幅。レイヤーゲイン(=設定値)の手前に掛ける。
//
// ここは compose 側のベロシティ（伴奏0.3前後・ベース0.5）と設定側の音量が
// さらに掛かるため、控えめにしすぎると伴奏が聴こえなくなる。
// 実測でメロディー比 伴奏 -7dB / ベース -6dB / パッド -18dB を狙った値。
const MELODY_PEAK = 0.30;
const ACCOMP_PEAK = 0.34;
const BASS_PEAK = 0.26;
const PAD_PEAK = 0.24; // 和音の音数でさらに割るので、単音換算ではこれでも控えめ

// ---------------------------------------------------------------------------
// 音色
//
// 倍音とアタックの数値だけを変えても、楽器は別の楽器にならない。
// 正弦波を足して指数関数で減衰させる、という作り方がピアノそのものだからで、
// その枠の中で数値を動かしても「少し違うピアノ」にしかならない。
// 楽器の正体を決めているのは、実際にはもっと乱暴な3つである。
//
//   1. アタックの雑音   爪が弦を弾く音、息が管の縁に当たる音。楽器の名刺。
//   2. 音色の時間変化   撥弦は弾いた瞬間だけ明るく、すぐ暗くなる（フィルタの掃引）。
//                      ピアノはペダルで伸ばすので、この落ち方が根本的に違う。
//   3. 減衰の速さ       撥弦は書かれた音価に関係なく先に消える。
//                      ここをピアノと同じに保つと、何を鳴らしてもピアノに聴こえる。
//
//   partials     倍音構成。decay は基音のリリースに対する倍率で、
//                倍音ほど速く減衰させる。mul が整数でないものは非整数倍音
//                （打弦楽器の金属的な響きはこれで出る）
//   wave         基本波形。'sine' 以外にすると倍音は波形が持つので partials は1つでよい
//   attack       立ち上がり秒
//   releaseRatio 音価に対するリリースの倍率
//   minRelease   最短リリース。ピアノのサステインペダル相当
//   sustain      true なら音価のあいだ音量を保つ（吹奏・擦弦）。
//                false なら弾いた瞬間から減衰し続ける（打鍵・撥弦）
//   inharmonic   倍音を上へずらす係数。完全整数倍だと合成臭くなる
//   gain         音色ごとの音量合わせ
//   filter       { hz, q, to, time } 音全体に掛けるローパス。to があれば
//                hz から to へ time 秒かけて閉じる（撥弦の「弾いた直後だけ明るい」）
//   vibrato      { hz, cents, delay } 遅れて掛かるビブラート
//   tremolo      { hz, depth } 音量の揺れ。エレピの指紋
//   noise        { gain, decay, hz, q } 爪の音・息の音。帯域を絞った雑音を頭に足す
//
// partials は melody の1組だけ書けばよい。伴奏とベースには自動で高倍音を落とす
// （下支えに回る声部で高倍音が要らないのは、どの楽器でも変わらない）。
// ピアノだけは3組を明示する。既存の音を1ミリも変えないため。
// ---------------------------------------------------------------------------

const TIMBRES = {
  // アコースティックピアノ。この曲生成器の原点で、標準スタイルの音。
  piano: {
    partials: {
      melody: [
        { mul: 1, gain: 1.00, decay: 1.00 },
        { mul: 2, gain: 0.50, decay: 0.55 },
        { mul: 3, gain: 0.26, decay: 0.34 },
        { mul: 4, gain: 0.15, decay: 0.22 },
      ],
      accomp: [
        { mul: 1, gain: 1.00, decay: 1.00 },
        { mul: 2, gain: 0.34, decay: 0.45 },
        { mul: 3, gain: 0.12, decay: 0.26 },
        { mul: 4, gain: 0.05, decay: 0.16 },
      ],
      // 低音は基音だけだと小型スピーカーで消えるため2倍音は残す
      bass: [
        { mul: 1, gain: 1.00, decay: 1.00 },
        { mul: 2, gain: 0.22, decay: 0.40 },
        { mul: 3, gain: 0.06, decay: 0.20 },
      ],
    },
    attack: 0.008, releaseRatio: 0.9, minRelease: 1.6, inharmonic: 0.0004, gain: 1,
  },

  // エレクトリックピアノ。14倍音の短い減衰が鐘のようなアタックを作り、
  // 音量の揺れ（トレモロ）がこの楽器の指紋。
  epiano: {
    partials: [
      { mul: 1, gain: 1.00, decay: 1.00 },
      { mul: 2, gain: 0.30, decay: 0.55 },
      { mul: 4, gain: 0.18, decay: 0.30 },
      { mul: 6, gain: 0.10, decay: 0.20 },
      { mul: 14, gain: 0.07, decay: 0.07 },
    ],
    attack: 0.004, releaseRatio: 0.5, minRelease: 0.9, inharmonic: 0.001, gain: 1.05,
    filter: { hz: 4200, q: 0.6 },
    tremolo: { hz: 5.2, depth: 0.38 },
  },

  // 古筝。絹弦を義甲で弾く。倍音が高くまで並び、弾いた直後だけ明るい。
  guzheng: {
    partials: [
      { mul: 1, gain: 1.00, decay: 1.00 },
      { mul: 2, gain: 0.55, decay: 0.55 },
      { mul: 3, gain: 0.42, decay: 0.40 },
      { mul: 4, gain: 0.26, decay: 0.30 },
      { mul: 5, gain: 0.16, decay: 0.22 },
      { mul: 6, gain: 0.10, decay: 0.16 },
    ],
    attack: 0.001, releaseRatio: 0.28, minRelease: 0.55, inharmonic: 0.0012, gain: 0.95,
    filter: { hz: 6500, to: 1200, time: 0.5, q: 1.0 },
    noise: { gain: 0.45, decay: 0.05, hz: 3000, q: 0.9 },
  },

  // 箏。古筝より暗く、余韻を少し長めに残す。
  koto: {
    partials: [
      { mul: 1, gain: 1.00, decay: 1.00 },
      { mul: 2, gain: 0.46, decay: 0.60 },
      { mul: 3, gain: 0.30, decay: 0.42 },
      { mul: 4, gain: 0.16, decay: 0.30 },
      { mul: 5, gain: 0.08, decay: 0.20 },
    ],
    attack: 0.002, releaseRatio: 0.32, minRelease: 0.7, inharmonic: 0.0010, gain: 0.95,
    filter: { hz: 4800, to: 900, time: 0.7, q: 1.0 },
    noise: { gain: 0.35, decay: 0.06, hz: 2200, q: 0.9 },
  },

  // 三線。蛇皮の胴が作る鼻にかかった響きと、爪弾きの強い当たり。
  // 撥弦のなかで最も短く切れるのがこの楽器の性格。
  sanshin: {
    partials: [
      { mul: 1, gain: 1.00, decay: 1.00 },
      { mul: 2, gain: 0.62, decay: 0.50 },
      { mul: 3, gain: 0.50, decay: 0.35 },
      { mul: 4, gain: 0.34, decay: 0.25 },
      { mul: 5, gain: 0.20, decay: 0.18 },
    ],
    attack: 0.001, releaseRatio: 0.22, minRelease: 0.4, inharmonic: 0.0015, gain: 0.92,
    filter: { hz: 5200, to: 1400, time: 0.35, q: 1.4 },
    noise: { gain: 0.60, decay: 0.05, hz: 1600, q: 0.7 },
  },

  // サントゥール。金属弦を撥で打つので倍音が整数倍から外れ、頭が硬く光る。
  santur: {
    partials: [
      { mul: 1, gain: 1.00, decay: 1.00 },
      { mul: 2, gain: 0.50, decay: 0.50 },
      { mul: 3, gain: 0.30, decay: 0.35 },
      { mul: 4.2, gain: 0.22, decay: 0.25 },
      { mul: 5.4, gain: 0.14, decay: 0.18 },
      { mul: 7.1, gain: 0.08, decay: 0.12 },
    ],
    attack: 0.001, releaseRatio: 0.3, minRelease: 0.6, inharmonic: 0.002, gain: 0.9,
    filter: { hz: 8000, to: 2000, time: 0.5, q: 1.0 },
    noise: { gain: 0.50, decay: 0.03, hz: 4200, q: 1.2 },
  },

  // ウード。フレットの無い撥弦。ナイロン弦より暗く、胴が大きい。
  oud: {
    partials: [
      { mul: 1, gain: 1.00, decay: 1.00 },
      { mul: 2, gain: 0.40, decay: 0.55 },
      { mul: 3, gain: 0.22, decay: 0.40 },
      { mul: 4, gain: 0.10, decay: 0.28 },
    ],
    attack: 0.003, releaseRatio: 0.3, minRelease: 0.6, inharmonic: 0.0008, gain: 0.95,
    filter: { hz: 3200, to: 700, time: 0.6, q: 0.9 },
    noise: { gain: 0.35, decay: 0.06, hz: 1200, q: 0.7 },
  },

  // ナイロン弦のギター。3倍音が強いのがガット弦らしさ。
  guitar: {
    partials: [
      { mul: 1, gain: 1.00, decay: 1.00 },
      { mul: 2, gain: 0.42, decay: 0.60 },
      { mul: 3, gain: 0.30, decay: 0.45 },
      { mul: 4, gain: 0.16, decay: 0.30 },
      { mul: 5, gain: 0.08, decay: 0.20 },
    ],
    attack: 0.003, releaseRatio: 0.35, minRelease: 0.8, inharmonic: 0.0006, gain: 1.0,
    filter: { hz: 3800, to: 900, time: 0.8, q: 0.9 },
    noise: { gain: 0.30, decay: 0.06, hz: 1600, q: 0.8 },
  },

  // ハープ。撥弦のなかでは最も余韻が長く、倍音は素直。
  harp: {
    partials: [
      { mul: 1, gain: 1.00, decay: 1.00 },
      { mul: 2, gain: 0.40, decay: 0.70 },
      { mul: 3, gain: 0.22, decay: 0.50 },
      { mul: 4, gain: 0.12, decay: 0.35 },
      { mul: 5, gain: 0.06, decay: 0.25 },
    ],
    attack: 0.002, releaseRatio: 0.5, minRelease: 1.2, inharmonic: 0.0005, gain: 1.0,
    filter: { hz: 5200, to: 1500, time: 1.2, q: 0.8 },
    noise: { gain: 0.20, decay: 0.04, hz: 2400, q: 0.9 },
  },

  // 尺八。息の音が音色の半分を占める。倍音はほとんど無く、
  // 代わりに帯域の広い息が鳴り続ける。ビブラートは遅れて掛かる。
  shakuhachi: {
    partials: [
      { mul: 1, gain: 1.00, decay: 1.00 },
      { mul: 2, gain: 0.18, decay: 1.00 },
      { mul: 3, gain: 0.07, decay: 1.00 },
    ],
    attack: 0.13, releaseRatio: 0.3, minRelease: 0.3, sustain: true, inharmonic: 0, gain: 1.1,
    vibrato: { hz: 4.4, cents: 22, delay: 0.30 },
    noise: { gain: 0.55, decay: 0.9, hz: 1800, q: 0.35 },
  },

  // バンスリ。尺八より息が細く、ビブラートが速い。
  bansuri: {
    partials: [
      { mul: 1, gain: 1.00, decay: 1.00 },
      { mul: 2, gain: 0.22, decay: 1.00 },
      { mul: 3, gain: 0.07, decay: 1.00 },
    ],
    attack: 0.07, releaseRatio: 0.3, minRelease: 0.3, sustain: true, inharmonic: 0, gain: 1.1,
    vibrato: { hz: 5.8, cents: 18, delay: 0.18 },
    noise: { gain: 0.35, decay: 0.8, hz: 2800, q: 0.5 },
  },

  // 擦弦。ノコギリ波をローパスで削って作る。倍音を足して作る音とは
  // 出自から違うので、加算合成の楽器と並べたときにいちばん遠くに聴こえる。
  strings: {
    partials: [{ mul: 1, gain: 1.00, decay: 1.00 }],
    wave: 'sawtooth',
    attack: 0.28, releaseRatio: 0.4, minRelease: 0.5, sustain: true, inharmonic: 0, gain: 0.42,
    filter: { hz: 2000, q: 0.9 },
    vibrato: { hz: 4.4, cents: 10, delay: 0.35 },
  },
};

/** パッドの音色。持続音なので倍音構成ではなく波形とフィルタで作る。 */
const PADS = {
  warm: { wave: 'triangle', hz: 1400, attack: 2.0, gain: 1.0 },
  air: { wave: 'sine', hz: 900, attack: 2.6, gain: 1.15 },
  bowed: { wave: 'sawtooth', hz: 1050, attack: 2.2, gain: 0.55 },
};

const DEFAULT_LAYERS = { melody: 'piano', accomp: 'piano', bass: 'piano', pad: 'warm' };

/** 楽器のキーから声部ごとの音色を引く。未知のキーはピアノへ落ちる。 */
export function ensembleFor(instrumentKey) {
  return layersFor(instrumentKey) ?? DEFAULT_LAYERS;
}

// settings.js の PARAM_DEFS における既定値の写し。
// settings が未指定・欠損でも音が出なくならないための保険であり、正は settings.js 側。
const FALLBACK = {
  masterVolume: 85,
  melodyVolume: 100,
  accompVolume: 45,
  padVolume: 35,
  reverbAmount: 45,
  brightness: 50,
};

// --- 小道具 ---

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// 0〜100 の設定値を 0〜1 のゲインへ。数値でない値は既定値へ落とす。
function pct(settings, key) {
  const raw = settings == null ? undefined : settings[key];
  const n = Number(raw);
  return clamp(Number.isFinite(n) ? n : FALLBACK[key], 0, 100) / 100;
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// 高い倍音ほど耳につくため、周波数が上がるにつれ穏やかに削る。
function highTilt(freq) {
  return Math.min(1, 2000 / freq);
}

// 伴奏とベースの倍音構成。melody の組から高倍音を落として作り、覚えておく。
const LAYER_TILT = { accomp: 0.7, bass: 0.45 };
const PARTIAL_CACHE = new Map();

function partialsOf(timbre, name, layer) {
  const table = timbre.partials;
  if (!Array.isArray(table)) return table[layer] ?? table.melody;
  if (layer === 'melody') return table;
  const key = `${name}:${layer}`;
  const hit = PARTIAL_CACHE.get(key);
  if (hit) return hit;
  const cut = LAYER_TILT[layer] ?? 1;
  const out = table.map((p, i) => (i === 0 ? p : { ...p, gain: p.gain * Math.pow(cut, i) }));
  PARTIAL_CACHE.set(key, out);
  return out;
}

// ノイズ×指数減衰のステレオIR。ヒーリング系はリバーブが音色の半分を作る。
function buildImpulseResponse(ctx) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * REVERB_SECONDS));
  const ir = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0; // 1極ローパス。生の白色ノイズのままだと残響が硬く痩せて聴こえる
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      lp += REVERB_TONE * (white - lp);
      const decay = Math.pow(1 - i / length, REVERB_DECAY_POWER);
      // 頭の数msだけ立ち上げ、初期反射がクリック状に飛び出すのを防ぐ
      const fadeIn = Math.min(1, i / (rate * 0.005));
      data[i] = (lp * 0.75 + white * 0.25) * decay * fadeIn;
    }
  }
  return ir;
}

/** 爪の音・息の音に使う白色ノイズ。1つ作って全音で使い回す。 */
function buildNoiseBuffer(ctx) {
  const length = Math.max(1, Math.floor(ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * Web Audio 音源を作る。
 *
 * @param {BaseAudioContext} audioCtx
 * @param {object} settings settings.js のサウンド系キーを持つオブジェクト
 * @returns {{
 *   playPiano: (time: number, midi: number, durSec: number, vel: number, layer: 'melody'|'accomp'|'bass') => void,
 *   playPad: (time: number, midis: number[], durSec: number, vel: number) => void,
 *   applySettings: (next: object) => void,
 *   dispose: () => void,
 * }}
 */
export function createEngine(audioCtx, settings) {
  const ctx = audioCtx;

  // --- 固定ノード（applySettings では作り直さず、値だけ書き換える） ---
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  const bus = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const convolver = ctx.createConvolver();
  const melodyGain = ctx.createGain();
  const accompGain = ctx.createGain();
  const padGain = ctx.createGain();

  // しきい値 -8 では、リミッタが音楽的なピークまで削っていた。
  // 実測（makeup 3.0）: -8 で曲中の抑揚が 11.6 → 8.6 dB へ潰れ、
  // -3 なら 11.6 dB のまま。突発的な山だけを受け止める高さに置く。
  limiter.threshold.value = -3;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  convolver.normalize = true;
  convolver.buffer = buildImpulseResponse(ctx);

  bus.gain.value = OUTPUT_MAKEUP;
  dry.gain.value = DRY_GAIN;

  melodyGain.connect(bus);
  accompGain.connect(bus);
  padGain.connect(bus);
  bus.connect(dry);
  bus.connect(convolver);
  convolver.connect(wet);
  dry.connect(limiter);
  wet.connect(limiter);
  limiter.connect(master);
  master.connect(ctx.destination);

  // ベースは伴奏バスに合流させる。伴奏音量ひとつで下支え全体が動くようにするため。
  const layerGains = { melody: melodyGain, accomp: accompGain, bass: accompGain };
  const layerPeaks = { melody: MELODY_PEAK, accomp: ACCOMP_PEAK, bass: BASS_PEAK };

  // 発音のたびに引く値は保持しておき、applySettings では書き換えるだけにする。
  let brightScale = 1;
  let ensemble = DEFAULT_LAYERS;
  let noiseBuffer = null; // ノイズを使う音色が来たときに初めて作る
  let disposed = false;

  // 鳴っている最中のノード。dispose のときに確実に止めて切断するため保持する。
  const voices = new Set();

  function track(source, nodes) {
    if (disposed) return;
    const voice = { source, nodes };
    voices.add(voice);
    source.onended = () => {
      voices.delete(voice);
      release(voice);
    };
  }

  function release(voice) {
    try {
      voice.source.disconnect();
    } catch (_) { /* 二重切断は無視 */ }
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch (_) { /* 同上 */ }
    }
  }

  /** 音量つまみと出力の天井を掛けた、実際のマスターゲイン */
  function masterGain() {
    return Math.max(pct(settings, 'masterVolume') * MASTER_CEILING, MIN_GAIN);
  }

  function applySettings(next) {
    if (next) settings = next;
    // ノードは作り直さない。既存のゲインノードの値を書き換えるだけ。
    master.gain.value = masterGain();
    melodyGain.gain.value = pct(settings, 'melodyVolume');
    accompGain.gain.value = pct(settings, 'accompVolume');
    padGain.gain.value = pct(settings, 'padVolume');
    wet.gain.value = pct(settings, 'reverbAmount') * WET_MAX;
    // 0 で基音のみに近く、100 で明るくきらびやか（2倍音以上を 0〜2倍にスケール）
    brightScale = pct(settings, 'brightness') * 2;
    // 楽器は「次の曲から」の設定なので、曲が変わるたびに player から呼ばれる。
    ensemble = ensembleFor(settings?.instrument);
  }

  applySettings(settings);

  // time は audioCtx.currentTime 基準の絶対秒。過去に落ちたときだけ現在時刻へ寄せる。
  function startAt(time) {
    const t = Number(time);
    const now = ctx.currentTime;
    return Number.isFinite(t) ? Math.max(t, now) : now;
  }

  /** 爪・息の音。帯域を絞った雑音を、音の頭に足す。 */
  function addNoise(spec, t0, amp, dest) {
    if (!noiseBuffer) noiseBuffer = buildNoiseBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(spec.hz, t0);
    band.Q.value = spec.q;

    const env = ctx.createGain();
    env.gain.setValueAtTime(MIN_GAIN, t0);
    env.gain.linearRampToValueAtTime(amp * spec.gain, t0 + 0.003);
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, t0 + 0.003 + spec.decay);

    src.connect(band);
    band.connect(env);
    env.connect(dest);
    src.start(t0);
    src.stop(t0 + 0.003 + spec.decay + TAIL_SEC);
    // !!! ここに共有ノード（フィルタ・トレモロ）を渡してはいけない !!!
    // 雑音は 50ms ほどで終わる。その onended で共有ノードまで切断すると、
    // まだ鳴っているはずの倍音が行き場を失って、音が頭だけで消える。
    track(src, [band, env]);
  }

  /**
   * 撥弦の「弾いた瞬間だけ明るい」を作るローパス。
   * to があれば hz から to へ閉じていく。これが無いと、どんな倍音構成でも
   * 一定の明るさで鳴り続けてしまい、ピアノとの違いが出ない。
   */
  function makeFilter(spec, t0) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = spec.q ?? 0.7;
    const top = Math.min(spec.hz, ctx.sampleRate * 0.45);
    filter.frequency.setValueAtTime(top, t0);
    if (spec.to) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(60, Math.min(spec.to, top)), t0 + (spec.time ?? 0.5));
    }
    return filter;
  }

  /** 音量の揺れ。エレピの指紋なので、ここだけは音そのものより先に耳が気づく。 */
  function makeTremolo(spec, t0, stopAt) {
    const trem = ctx.createGain();
    trem.gain.setValueAtTime(1 - spec.depth / 2, t0);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(spec.hz, t0);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(spec.depth / 2, t0);
    lfo.connect(depth);
    depth.connect(trem.gain); // GainNode の gain へ足し込む
    lfo.start(t0);
    lfo.stop(stopAt);
    track(lfo, [depth]);
    return trem;
  }

  /** ビブラート。1音につき1本の LFO を作り、全倍音のデチューンへ配る。 */
  function makeVibrato(spec, t0, stopAt) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(spec.hz, t0);
    const depth = ctx.createGain();
    // 掛かり始めるまでは深さ 0。遅れて掛かるから「歌っている」ように聴こえる。
    depth.gain.setValueAtTime(0, t0);
    depth.gain.setValueAtTime(0, t0 + spec.delay);
    depth.gain.linearRampToValueAtTime(spec.cents, t0 + spec.delay + 0.25);
    lfo.connect(depth);
    lfo.start(t0);
    lfo.stop(stopAt);
    track(lfo, [depth]);
    return depth;
  }

  /**
   * 単音を1つ鳴らす。倍音を足し合わせて作る（加算合成）。
   *
   * 名前が playPiano なのは、この関数がピアノ専用だった頃からの呼び出し規約。
   * 実際に鳴る楽器は layer とアンサンブルで決まる。
   */
  function playPiano(time, midi, durSec, vel, layer) {
    if (disposed) return;
    const dest = layerGains[layer] ?? melodyGain;
    const name = ensemble[layer] ?? ensemble.melody;
    const timbre = TIMBRES[name] ?? TIMBRES.piano;
    const partials = partialsOf(timbre, name, layer);
    const t0 = startAt(time);
    const dur = Math.max(0.05, Number(durSec) || 0.05);
    const v = clamp(Number(vel) || 0, 0, 1.2);
    if (v <= 0) return;

    const attack = Math.min(timbre.attack, dur * 0.5);
    const releaseSec = Math.max(dur * timbre.releaseRatio, timbre.minRelease);
    // 保つ音色は「音価のあいだ鳴って、そこから減衰」。撥弦・打鍵は最初から減衰し続ける。
    const holdUntil = timbre.sustain ? t0 + Math.max(attack, dur) : t0 + attack;
    const stopAt = holdUntil + releaseSec + TAIL_SEC;
    const peak = (layerPeaks[layer] ?? MELODY_PEAK) * (timbre.gain ?? 1) * v;
    // 実際の楽器同様、強く鳴らした音ほど倍音が出る
    const velBright = 0.6 + 0.4 * v;
    const f0 = midiToFreq(Number(midi));
    const nyquist = ctx.sampleRate * 0.45;

    // 音全体を通す枝。フィルタ → トレモロ → レイヤーのゲイン、の順に繋ぐ。
    // どちらも無ければ倍音は直接レイヤーへ挿す（標準のピアノは従来どおり）。
    const shared = [];
    let sink = dest;
    if (timbre.tremolo) {
      const trem = makeTremolo(timbre.tremolo, t0, stopAt);
      trem.connect(sink);
      shared.push(trem);
      sink = trem;
    }
    if (timbre.filter) {
      const filter = makeFilter(timbre.filter, t0);
      filter.connect(sink);
      shared.push(filter);
      sink = filter;
    }

    // 爪の音・息の音もフィルタを通す。頭の雑音だけが素通しだと張り付いて聴こえる。
    if (timbre.noise) addNoise(timbre.noise, t0, peak, sink);
    const vibrato = timbre.vibrato ? makeVibrato(timbre.vibrato, t0, stopAt) : null;

    // 共有ノードを片付ける役は、倍音のうち1本だけに持たせる。
    // 倍音はすべて同じ stopAt で止まるので、どれに持たせても結果は同じ。
    let anchored = false;

    for (const p of partials) {
      // 完全整数倍だと合成臭くなるため、実際の弦に倣ってごく僅かに上へずらす（決定論的）
      const freq = f0 * p.mul * (1 + (timbre.inharmonic ?? 0) * p.mul * p.mul);
      if (freq >= nyquist) continue;

      const harmonic = p.mul > 1;
      const amp = peak * p.gain * (harmonic ? brightScale * velBright * highTilt(freq) : 1);
      if (amp <= MIN_GAIN) continue;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(amp, t0 + attack);
      if (timbre.sustain) {
        // 保つあいだは倍音も一緒に保ち、離してから一斉に減衰させる。
        env.gain.setValueAtTime(amp, holdUntil);
        env.gain.exponentialRampToValueAtTime(MIN_GAIN, holdUntil + releaseSec);
      } else {
        // 倍音ほど短い減衰時間を与える。0 は渡せないので MIN_GAIN まで落とす。
        const decaySec = Math.max(0.05, releaseSec * p.decay);
        env.gain.exponentialRampToValueAtTime(MIN_GAIN, t0 + attack + decaySec);
      }

      const osc = ctx.createOscillator();
      osc.type = timbre.wave ?? 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (vibrato) vibrato.connect(osc.detune);
      osc.connect(env);
      env.connect(sink);
      osc.start(t0);
      osc.stop(stopAt); // 全オシレータを必ず止め、ノードをリークさせない
      track(osc, anchored ? [env] : [env, ...shared]);
      anchored = true;
    }

    // 倍音が1本も作られなかった（全部ナイキストを超えた等）ときの後始末。
    // 誰も片付けないまま残すとノードがリークする。
    if (!anchored) {
      for (const n of shared) {
        try {
          n.disconnect();
        } catch (_) { /* 未接続なら無視 */ }
      }
    }
  }

  /**
   * パッド和音。ゆっくり立ち上げて空間を埋める。
   * 波形とフィルタはアンサンブルごと（PADS）。
   */
  function playPad(time, midis, durSec, vel) {
    if (disposed) return;
    if (!Array.isArray(midis) || midis.length === 0) return;
    const preset = PADS[ensemble.pad] ?? PADS.warm;
    const t0 = startAt(time);
    const dur = Math.max(0.2, Number(durSec) || 0.2);
    const v = clamp(Number(vel) || 0, 0, 1.2);
    if (v <= 0) return;

    const attackSec = Math.min(preset.attack, Math.max(0.05, dur * 0.5));
    const releaseSec = Math.max(dur * 0.5, PAD_MIN_RELEASE_SEC);
    const endAt = t0 + dur;
    const stopAt = endAt + releaseSec + TAIL_SEC;
    const amp = (PAD_PEAK * preset.gain * v) / Math.sqrt(midis.length);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(preset.hz, t0);
    filter.Q.value = PAD_FILTER_Q;
    filter.connect(padGain);

    for (const midi of midis) {
      const freq = midiToFreq(Number(midi));
      if (!Number.isFinite(freq)) continue;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(amp, t0 + attackSec); // ゆっくり
      env.gain.setValueAtTime(amp, endAt); // attackSec <= dur*0.5 なので必ず立ち上がり後
      env.gain.exponentialRampToValueAtTime(MIN_GAIN, endAt + releaseSec);

      const osc = ctx.createOscillator();
      osc.type = preset.wave;
      osc.frequency.setValueAtTime(freq, t0);
      // ±4セント。個々の音をわずかにずらすことで厚みが出る（本ファイル限定の Math.random）
      osc.detune.setValueAtTime((Math.random() * 2 - 1) * PAD_DETUNE_CENTS, t0);
      osc.connect(env);
      env.connect(filter);
      osc.start(t0);
      osc.stop(stopAt);
      track(osc, [env, filter]);
    }
  }

  /**
   * 鳴っている音を全部消して、gapSec 秒の無音をはさんでから音量を戻す。
   *
   * 曲を手で切り替えるときに使う。何もしないと、前の曲の減衰とリバーブの尾
   * （最長3.5秒）が次の曲の頭に重なって、2曲が一瞬混ざって聴こえる。
   *
   * 予約済みのオシレータを止めるだけではリバーブの尾が残るので、
   * マスターごと落とす。落とす前に数十ミリ秒かけるのは、
   * 波形の途中で切るとプツッというクリックノイズが出るため。
   *
   * @param {number} gapSec 無音にしておく秒数
   */
  function silence(gapSec = 1) {
    if (disposed) return;
    const now = ctx.currentTime;
    const fade = Math.max(0.02, Math.min(SILENCE_FADE_SEC, gapSec * 0.4));
    const target = masterGain();

    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(master.gain.value, MIN_GAIN), now);
    master.gain.exponentialRampToValueAtTime(MIN_GAIN, now + fade);
    // 無音のあいだに次の曲の頭が来ても、戻すのは gapSec ちょうど。
    master.gain.setValueAtTime(MIN_GAIN, now + gapSec);
    master.gain.exponentialRampToValueAtTime(target, now + gapSec + RESTORE_SEC);

    // 予約済みの音は、フェードが終わったところで止める。
    // 止めておかないと、音量を戻した瞬間に前の曲の続きが鳴り出す。
    for (const voice of voices) {
      try {
        voice.source.stop(now + fade);
      } catch (_) { /* 既に停止済み */ }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const now = ctx.currentTime;
    for (const voice of voices) {
      voice.source.onended = null;
      try {
        voice.source.stop(now);
      } catch (_) { /* 既に停止済み */ }
      release(voice);
    }
    voices.clear();
    for (const node of [melodyGain, accompGain, padGain, bus, dry, wet, convolver, limiter, master]) {
      try {
        node.disconnect();
      } catch (_) { /* 同上 */ }
    }
  }

  return { playPiano, playPad, applySettings, silence, dispose };
}
