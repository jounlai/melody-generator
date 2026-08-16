// Web Audio によるヒーリング系ピアノ音源。サンプルファイルは一切使わず、
// すべてオシレータと手続き生成のインパルス応答で合成する。
//
// シグナルチェーン:
//   メロディー/伴奏/パッド → 各レイヤーゲイン → バス
//     → ドライ ─────────────┐
//     → コンボルバー → ウェット ┴→ リミッタ → マスターゲイン → destination
//
// 本ファイル内に限り Math.random() の使用を許可する（リバーブIRとパッドのデチューン）。
// 作曲・演奏の経路はシード由来のPRNGを使うため、ここでの乱数は曲の再現性に影響しない。

// --- 定数（音作りの骨格。ユーザーが触る値は settings 側にある） ---

const MIN_GAIN = 0.0001; // exponentialRampToValueAtTime に 0 は渡せないため、実質無音のこの値を使う
const ATTACK_SEC = 0.008; // ピアノのアタック（リニアランプ）
const MIN_RELEASE_SEC = 1.6; // サステインペダル相当の最短リリース
const RELEASE_RATIO = 0.9; // リリース = max(durSec * RELEASE_RATIO, MIN_RELEASE_SEC)
const TAIL_SEC = 0.05; // stop() をリリース終端よりわずかに後ろへ置く余裕

const REVERB_SECONDS = 3.5;
const REVERB_DECAY_POWER = 2.6; // 大きいほど尾が速く消える
const REVERB_TONE = 0.28; // 1極ローパスの係数。小さいほど暗い残響
const WET_MAX = 1.1; // reverbAmount = 100 のときのウェットゲイン
const DRY_GAIN = 1.0;

const PAD_FILTER_HZ = 1400;
const PAD_FILTER_Q = 0.5;
const PAD_ATTACK_SEC = 2.0; // ゆっくり立ち上げる
const PAD_MIN_RELEASE_SEC = 2.0;
const PAD_DETUNE_CENTS = 4; // ±4セントのランダムデチューンで厚みを出す

// 各レイヤーの1音あたりのピーク振幅。レイヤーゲイン(=設定値)の手前に掛ける。
const MELODY_PEAK = 0.30;
const ACCOMP_PEAK = 0.26;
const PAD_PEAK = 0.10; // パッドは非常に控えめ。和音の音数でさらに割る

// 倍音構成。decay は基音のリリースに対する倍率で、倍音ほど速く減衰させる。
const PARTIALS = {
  // メロディー: 倍音を多めに残して前へ出す
  melody: [
    { mul: 1, gain: 1.00, decay: 1.00 },
    { mul: 2, gain: 0.50, decay: 0.55 },
    { mul: 3, gain: 0.26, decay: 0.34 },
    { mul: 4, gain: 0.15, decay: 0.22 },
  ],
  // 伴奏: 高倍音を削って下支えに回す
  accomp: [
    { mul: 1, gain: 1.00, decay: 1.00 },
    { mul: 2, gain: 0.34, decay: 0.45 },
    { mul: 3, gain: 0.12, decay: 0.26 },
    { mul: 4, gain: 0.05, decay: 0.16 },
  ],
};

// settings.js の PARAM_DEFS における既定値の写し。
// settings が未指定・欠損でも音が出なくならないための保険であり、正は settings.js 側。
const FALLBACK = {
  masterVolume: 70,
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

/**
 * Web Audio 音源を作る。
 *
 * @param {BaseAudioContext} audioCtx
 * @param {object} settings settings.js のサウンド系キーを持つオブジェクト
 * @returns {{
 *   playPiano: (time: number, midi: number, durSec: number, vel: number, layer: 'melody'|'accomp') => void,
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

  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  convolver.normalize = true;
  convolver.buffer = buildImpulseResponse(ctx);

  bus.gain.value = 1;
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

  const layerGains = { melody: melodyGain, accomp: accompGain };

  // brightness は「以降に発音する音」から反映されればよいので、値を保持して発音時に読む。
  let brightScale = 1;
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

  function applySettings(next) {
    if (next) settings = next;
    // ノードは作り直さない。既存のゲインノードの値を書き換えるだけ。
    master.gain.value = pct(settings, 'masterVolume');
    melodyGain.gain.value = pct(settings, 'melodyVolume');
    accompGain.gain.value = pct(settings, 'accompVolume');
    padGain.gain.value = pct(settings, 'padVolume');
    wet.gain.value = pct(settings, 'reverbAmount') * WET_MAX;
    // 0 で基音のみに近く、100 で明るくきらびやか（2倍音以上を 0〜2倍にスケール）
    brightScale = pct(settings, 'brightness') * 2;
  }

  applySettings(settings);

  // time は audioCtx.currentTime 基準の絶対秒。過去に落ちたときだけ現在時刻へ寄せる。
  function startAt(time) {
    const t = Number(time);
    const now = ctx.currentTime;
    return Number.isFinite(t) ? Math.max(t, now) : now;
  }

  /**
   * ピアノ1音。基音＋2/3/4倍音の加算合成で、倍音ほど速く減衰する。
   */
  function playPiano(time, midi, durSec, vel, layer) {
    if (disposed) return;
    const dest = layerGains[layer] ?? melodyGain;
    const partials = PARTIALS[layer] ?? PARTIALS.melody;
    const t0 = startAt(time);
    const dur = Math.max(0.05, Number(durSec) || 0.05);
    const v = clamp(Number(vel) || 0, 0, 1.2);
    if (v <= 0) return;

    // コードが変わるまで引きずるサステインペダル相当の長いリリース
    const releaseSec = Math.max(dur * RELEASE_RATIO, MIN_RELEASE_SEC);
    const stopAt = t0 + releaseSec + TAIL_SEC;
    const peak = (layer === 'accomp' ? ACCOMP_PEAK : MELODY_PEAK) * v;
    // 実際のピアノ同様、強く弾いた音ほど倍音が出る
    const velBright = 0.6 + 0.4 * v;
    const f0 = midiToFreq(Number(midi));
    const nyquist = ctx.sampleRate * 0.45;

    for (const p of partials) {
      // 完全整数倍だと合成臭くなるため、実際のピアノに倣ってごく僅かに上へずらす（決定論的）
      const freq = f0 * p.mul * (1 + 0.0004 * p.mul * p.mul);
      if (freq >= nyquist) continue;

      const harmonic = p.mul > 1;
      const amp = peak * p.gain * (harmonic ? brightScale * velBright * highTilt(freq) : 1);
      if (amp <= MIN_GAIN) continue;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(amp, t0 + ATTACK_SEC);
      // 倍音ほど短い減衰時間を与える。0 は渡せないので MIN_GAIN まで落とす。
      const decaySec = Math.max(0.05, releaseSec * p.decay);
      env.gain.exponentialRampToValueAtTime(MIN_GAIN, t0 + ATTACK_SEC + decaySec);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      osc.connect(env);
      env.connect(dest);
      osc.start(t0);
      osc.stop(stopAt); // 全オシレータを必ず止め、ノードをリークさせない
      track(osc, [env]);
    }
  }

  /**
   * パッド和音。三角波＋ローパスを2秒かけて立ち上げ、空間を埋める。
   */
  function playPad(time, midis, durSec, vel) {
    if (disposed) return;
    if (!Array.isArray(midis) || midis.length === 0) return;
    const t0 = startAt(time);
    const dur = Math.max(0.2, Number(durSec) || 0.2);
    const v = clamp(Number(vel) || 0, 0, 1.2);
    if (v <= 0) return;

    const attackSec = Math.min(PAD_ATTACK_SEC, Math.max(0.05, dur * 0.5));
    const releaseSec = Math.max(dur * 0.5, PAD_MIN_RELEASE_SEC);
    const endAt = t0 + dur;
    const stopAt = endAt + releaseSec + TAIL_SEC;
    const amp = (PAD_PEAK * v) / Math.sqrt(midis.length);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(PAD_FILTER_HZ, t0);
    filter.Q.value = PAD_FILTER_Q;
    filter.connect(padGain);

    for (const midi of midis) {
      const freq = midiToFreq(Number(midi));
      if (!Number.isFinite(freq)) continue;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(amp, t0 + attackSec); // 2秒かけてゆっくり
      env.gain.setValueAtTime(amp, endAt); // attackSec <= dur*0.5 なので必ず立ち上がり後
      env.gain.exponentialRampToValueAtTime(MIN_GAIN, endAt + releaseSec);

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
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

  return { playPiano, playPad, applySettings, dispose };
}
