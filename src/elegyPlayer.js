// 「別れ」のページの入口。楽譜を描き、押されたら鳴らす。
// ここは out/elegy.html からのみ使う（本体のアプリとは別）。
import { createEngine } from './synth.js';
import { buildPerformance } from './perform.js';
import { renderScore } from './notation.js';
import { defaultSettings } from './settings.js';

const song = JSON.parse(document.getElementById('song').textContent);
const settings = {
  ...defaultSettings(), instrument: 'piano', reverbAmount: 55, brightness: 38,
};

try {
  document.getElementById('score').innerHTML = renderScore(song, settings).svg;
} catch (err) {
  console.warn('楽譜を描けなかった', err);
}

let ctx = null;
let engine = null;
let busy = false;
const btn = document.getElementById('play');

btn.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  btn.textContent = '再生中';
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  if (!engine) engine = createEngine(ctx, settings);
  const { events, durationSec } = buildPerformance(song, settings);
  const t0 = ctx.currentTime + 0.3;
  for (const e of events) {
    if (e.kind === 'pad') engine.playPad(t0 + e.at, e.midis, e.dur, e.vel);
    else engine.playNote(t0 + e.at, e.midi, e.dur, e.vel, e.layer);
  }
  window.setTimeout(() => {
    busy = false;
    btn.disabled = false;
    btn.textContent = 'もう一度';
  }, (durationSec + 1.5) * 1000);
});
