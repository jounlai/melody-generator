/**
 * 解説ページ（algorithm.html）の試聴と図の駆動。
 *
 * 本体（index.html）とは別の入口だが、鳴らしているのは同じ src/ のモジュールで、
 * 説明用に音を作り直してはいない。本文で述べた処理をその場で実行して鳴らす。
 *
 * 再生は一度に一つ。前の音が鳴っているうちに次を押したら、前を止めてから始める
 * （説明を聴き比べるページなので、重なって鳴ると比較にならない）。
 */
import { createEngine } from './src/synth.js';
import { composeSong } from './src/compose.js';
import { buildPerformance } from './src/perform.js';
import { degToMidi } from './src/theory.js';
import { createAudioSession } from './src/session.js';

const MELODIES_URL = new URL('./src/data/melodies.json', import.meta.url);
const PROGRESSIONS_URL = new URL('./src/data/progressions.json', import.meta.url);

/** 試聴の設定。本体より少しだけ乾いた音にして、細部を聴き取りやすくする。 */
const SETTINGS = { masterVolume: 85, reverbAmount: 34 };

let ctx = null;
let engine = null;
let data = null;
const session = createAudioSession();

/** 再生中のボタンと、それを止める予約 */
let active = null;
let stopTimer = null;

function audio() {
  if (ctx) return { ctx, engine };
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) throw new Error('このブラウザは Web Audio API に対応していません');
  ctx = new Ctor();
  engine = createEngine(ctx, SETTINGS);
  return { ctx, engine };
}

async function loadData() {
  if (data) return data;
  const [melodies, progressions] = await Promise.all([
    fetch(MELODIES_URL).then((r) => r.json()),
    fetch(PROGRESSIONS_URL).then((r) => r.json()),
  ]);
  data = { melodies, progressions };
  return data;
}

// ---------------------------------------------------------------------------
// 鳴らす
// ---------------------------------------------------------------------------

/** 度数で書かれた音符列を鳴らす。断片も旋律型も、この形で持っている。 */
function scheduleDegrees(notes, opts = {}) {
  const { mode = 'major', tonic = 60, tempo = 74, layer = 'melody', at = 0.12 } = opts;
  const { ctx: c, engine: e } = audio();
  const spb = 60 / tempo;
  const t0 = c.currentTime + at;
  let end = 0;
  for (const n of notes) {
    e.playPiano(t0 + n.beat * spb, degToMidi(n.deg, mode, tonic), n.dur * spb, n.vel ?? 0.72, layer);
    end = Math.max(end, (n.beat + n.dur) * spb);
  }
  return end + 1.2; // 余韻ぶん
}

/** 相対度数の列（旋律型）を、一定の音価で鳴らす。 */
function scheduleSteps(steps, opts = {}) {
  const base = opts.base ?? 8;
  const dur = opts.dur ?? 0.75;
  return scheduleDegrees(
    steps.map((s, i) => ({ deg: base + s, beat: i * dur, dur, vel: 0.72 })),
    opts,
  );
}

/** 演奏イベント列（perform.js の出力）をまとめて予約する。 */
function scheduleEvents(events, limitSec) {
  const { ctx: c, engine: e } = audio();
  const t0 = c.currentTime + 0.12;
  let end = 0;
  for (const ev of events) {
    if (ev.at > limitSec) continue;
    if (ev.kind === 'pad') e.playPad(t0 + ev.at, ev.midis, ev.dur, ev.vel);
    else e.playPiano(t0 + ev.at, ev.midi, ev.dur, ev.vel, ev.layer);
    end = Math.max(end, ev.at + ev.dur);
  }
  return Math.min(end, limitSec + 3) + 1.2;
}

function stop() {
  if (stopTimer !== null) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
  if (engine) engine.silence(0.25);
  if (active) {
    active.dataset.playing = 'false';
    active.setAttribute('aria-pressed', 'false');
    active = null;
  }
}

function begin(button, seconds) {
  active = button;
  button.dataset.playing = 'true';
  button.setAttribute('aria-pressed', 'true');
  stopTimer = setTimeout(() => {
    stopTimer = null;
    if (active === button) {
      button.dataset.playing = 'false';
      button.setAttribute('aria-pressed', 'false');
      active = null;
    }
  }, Math.max(500, seconds * 1000));
}

// ---------------------------------------------------------------------------
// 試聴の中身
//
// どれも「本文で説明した処理を、その場で実行して鳴らす」形にしてある。
// 説明のために別の音を用意すると、書いてあることと鳴っているものがずれる。
// ---------------------------------------------------------------------------

/** コーパスから引いた旋律型（3節）。相対度数の列をそのまま鳴らす。 */
const FORMULA_DEMOS = {
  'formula-descend': { steps: [0, -1, -2, -3], label: '順次下降' },
  'formula-turn': { steps: [0, 1, 0, -1, 0], label: '刺繍' },
  soar: { steps: [0, 3, 2, 1], label: '舞い上がり' },
  sigh: { steps: [0, 4, 3, 2, 1], label: 'ため息' },
};

const DEMOS = {
  // --- 2節: 同じ度数列が、旋法を替えるだけで別の色になる ---
  async 'degrees-major'(d) {
    return scheduleDegrees(pickFragment(d, 'm0100').notes, { mode: 'major', tonic: 60 });
  },
  async 'degrees-minor'(d) {
    return scheduleDegrees(pickFragment(d, 'm0100').notes, { mode: 'minor', tonic: 60 });
  },

  // --- 4節: スコアの上位と下位 ---
  async 'score-high'(d) {
    const f = [...d.melodies].sort((a, b) => b.score - a.score)[0];
    return scheduleDegrees(f.notes, { mode: 'major', tonic: 60 });
  },
  async 'score-low'(d) {
    const f = [...d.melodies].sort((a, b) => a.score - b.score)[0];
    return scheduleDegrees(f.notes, { mode: 'major', tonic: 60 });
  },

  // --- 7.2節: ゼクエンツ。同じ形が2度上で鳴り直す ---
  async 'sequence-a'(d) {
    return scheduleDegrees(pickFragment(d, 'm0100').notes, { mode: 'major', tonic: 60 });
  },
  async 'sequence-both'(d) {
    const f = pickFragment(d, 'm0100');
    const span = 8;
    const moved = f.notes.map((n) => ({ ...n, deg: n.deg + 2, beat: n.beat + span }));
    return scheduleDegrees([...f.notes, ...moved], { mode: 'major', tonic: 60 });
  },

  // --- 9節: 声部の配置。伴奏を旋律の上へ出すとどうなるか ---
  async 'voicing-good'(d) {
    return playSong(d, 'demo9', { bars: 8 });
  },
  async 'voicing-crossed'(d) {
    // 旧実装と同じ状態を作る。伴奏とパッドを1オクターブ持ち上げ、旋律の上へ出す。
    return playSong(d, 'demo9', { bars: 8, lift: 12 });
  },

  // --- 10節: 強弱設計。掛けた場合と平らにした場合 ---
  async 'dynamics-on'(d) {
    return playSong(d, 'demo10', { bars: 12 });
  },
  async 'dynamics-flat'(d) {
    return playSong(d, 'demo10', { bars: 12, flat: true });
  },

  // --- 11節: 通しで聴く ---
  async 'full-song'(d) {
    return playSong(d, 'demo11', { bars: 32, seconds: 60 });
  },
};

function pickFragment(d, id) {
  return d.melodies.find((f) => f.id === id) ?? d.melodies[0];
}

/**
 * 曲を組み立てて鳴らす。
 * lift を渡すと伴奏とパッドを持ち上げ（9節の対比）、flat を渡すと強弱を平らにする（10節）。
 */
function playSong(d, seed, { bars = 8, lift = 0, flat = false, seconds = null } = {}) {
  const settings = { ...SETTINGS, songBars: '32' };
  const song = composeSong(seed, d, settings);
  if (lift) {
    for (const n of song.accomp) {
      n.midi += lift;
      if (Array.isArray(n.midis)) n.midis = n.midis.map((m) => m + lift);
    }
    for (const p of song.pad) p.midis = p.midis.map((m) => m + lift);
  }
  const perf = buildPerformance(song, settings);
  let events = perf.events;
  if (flat) {
    // 強弱を平らにする。層の積（式21）を外した状態＝設計を入れる前の音。
    const mean = events.reduce((a, e) => a + e.vel, 0) / Math.max(1, events.length);
    events = events.map((e) => ({ ...e, vel: mean }));
  }
  const limit = seconds ?? (bars * 4 * 60) / song.tempo;
  return scheduleEvents(events, limit);
}

// ---------------------------------------------------------------------------
// 配線
// ---------------------------------------------------------------------------

// 3言語で同じスクリプトを共有しているので、画面に出る文字だけ lang で切り替える。
const FAILED_TEXT = {
  en: 'Playback failed',
  zh: '无法播放',
}[document.documentElement.lang] || '再生できませんでした';

async function run(button) {
  const key = button.dataset.demo;
  const wasActive = active === button;
  stop();
  if (wasActive) return; // 同じボタンをもう一度押したら止めるだけ

  // !!! クリックの中から呼ぶこと !!! iOS はそれ以外の再生を拒否する
  session.start();
  audio();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (err) {
      console.warn('AudioContext を再開できませんでした', err);
    }
  }

  try {
    let seconds;
    if (FORMULA_DEMOS[key]) {
      seconds = scheduleSteps(FORMULA_DEMOS[key].steps, { mode: 'major', tonic: 60, dur: 0.7 });
    } else if (DEMOS[key]) {
      seconds = await DEMOS[key](await loadData());
    } else {
      return;
    }
    begin(button, seconds);
  } catch (err) {
    console.error('試聴を再生できませんでした', err);
    button.textContent = FAILED_TEXT;
  }
}

for (const button of document.querySelectorAll('[data-demo]')) {
  button.addEventListener('click', () => run(button));
}

// ページを離れるとき、鳴りっぱなしにしない
globalThis.addEventListener('pagehide', stop);
