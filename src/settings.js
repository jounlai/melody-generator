import { instrumentOptions, DEFAULT_INSTRUMENT } from './instrument.js';

export const GROUP_LABELS = {
  sound: '音',
  compose: '曲',
  humanize: '演奏',
};

const KEY_OPTIONS = [
  ['random', 'ランダム'],
  ['0', 'C'], ['1', 'C#'], ['2', 'D'], ['3', 'D#'], ['4', 'E'], ['5', 'F'],
  ['6', 'F#'], ['7', 'G'], ['8', 'G#'], ['9', 'A'], ['10', 'A#'], ['11', 'B'],
];

// 雰囲気とテンポは、聴いて違いがはっきり分かる2つだけを表に出し、
// 内部の細かい値（長調比率・テンポ範囲）はここで導出する。
const MOOD_MAP = {
  bright: { majorRatio: 90 },
  balanced: { majorRatio: 55 },
  wistful: { majorRatio: 12 },
};

const TEMPO_MAP = {
  slow: { tempoMin: 66, tempoMax: 74 },
  normal: { tempoMin: 78, tempoMax: 88 },
  flowing: { tempoMin: 92, tempoMax: 102 },
};

// 調整可能パラメータの唯一の定義。UIパネルはこの配列から自動生成される。
//
// ui: true のものだけを画面に出す。false のものは「耳で決めるべき値」ではなく
// 「決め切ってよい値」なので、最適と判断した値で固定してある。
// 出し戻したくなったら ui を true にするだけでよい。
export const PARAM_DEFS = [
  // ---- 画面に出す3つ ----
  // 既定は 85。曲そのものが静かなので、つまみまで控えめにすると
  // スマートフォンの内蔵スピーカーでは聴き取れなくなる。
  { key: 'masterVolume', group: 'sound', label: '音量', type: 'range', min: 0, max: 100, step: 1, def: 85, unit: '%', apply: 'live', ui: true },
  { key: 'mood', group: 'compose', label: '曲の雰囲気', type: 'choice', apply: 'next', ui: true, code: 'md', def: 'balanced',
    hint: '長調と短調のどちらを多く引くか',
    options: [['bright', '明るめ'], ['balanced', 'バランス'], ['wistful', '切なめ']] },
  { key: 'tempoFeel', group: 'compose', label: 'テンポ', type: 'choice', apply: 'next', ui: true, code: 'tp', def: 'normal',
    options: [['slow', 'ゆっくり'], ['normal', 'ふつう'], ['flowing', '少し速め']] },
  // 楽器。曲の中身は変えず、鳴らす音だけを変える（instrument.js が唯一の定義）。
  { key: 'instrument', group: 'sound', label: '楽器', type: 'choice', apply: 'next', ui: true, code: 'it',
    hint: '曲の作りはそのまま、鳴らす楽器だけが変わります',
    def: DEFAULT_INSTRUMENT.key, options: instrumentOptions() },

  // ---- 以下は固定値。画面には出さない ----

  // 音のバランス。メロディーを最前面に、伴奏とパッドは下支えに徹させる
  { key: 'melodyVolume', group: 'sound', label: 'メロディー音量', type: 'range', min: 0, max: 100, step: 1, def: 100, unit: '%', apply: 'live', ui: false },
  { key: 'accompVolume', group: 'sound', label: '伴奏音量', type: 'range', min: 0, max: 100, step: 1, def: 80, unit: '%', apply: 'live', ui: false },
  { key: 'padVolume', group: 'sound', label: 'パッド音量', type: 'range', min: 0, max: 100, step: 1, def: 62, unit: '%', apply: 'live', ui: false },
  { key: 'reverbAmount', group: 'sound', label: 'リバーブ量', type: 'range', min: 0, max: 100, step: 1, def: 48, unit: '%', apply: 'live', ui: false },
  { key: 'brightness', group: 'sound', label: '音色の明るさ', type: 'range', min: 0, max: 100, step: 1, def: 42, unit: '%', apply: 'live', ui: false },

  // 人間らしさ。数値をいじる対象ではないので固定
  { key: 'timingJitterMs', group: 'humanize', label: 'タイミングの揺らぎ', type: 'range', min: 0, max: 30, step: 1, def: 12, unit: 'ms', apply: 'next', ui: false },
  { key: 'velocityJitter', group: 'humanize', label: 'ベロシティの揺らぎ', type: 'range', min: 0, max: 25, step: 1, def: 10, unit: '%', apply: 'next', ui: false },
  { key: 'tenuto', group: 'humanize', label: '頂点音のテヌート', type: 'toggle', def: true, apply: 'next', ui: false },
  { key: 'ritardando', group: 'humanize', label: '終盤のリタルダンド', type: 'toggle', def: true, apply: 'next', ui: false },
  { key: 'gapSeconds', group: 'humanize', label: '曲間の余韻', type: 'range', min: 0, max: 10, step: 0.5, def: 3.5, unit: '秒', apply: 'live', ui: false },

  // 作曲。mood / tempoFeel から導出されるか、変える意味が薄いので固定
  { key: 'tempoMin', group: 'compose', label: 'テンポ下限', type: 'range', min: 52, max: 92, step: 1, def: 64, unit: 'BPM', apply: 'next', ui: false },
  { key: 'tempoMax', group: 'compose', label: 'テンポ上限', type: 'range', min: 52, max: 92, step: 1, def: 74, unit: 'BPM', apply: 'next', ui: false },
  { key: 'musicKey', group: 'compose', label: 'キー', type: 'choice', options: KEY_OPTIONS, def: 'random', apply: 'next', ui: false },
  { key: 'majorRatio', group: 'compose', label: '長調の比率', type: 'range', min: 0, max: 100, step: 5, def: 55, unit: '%', apply: 'next', ui: false },
  { key: 'songBars', group: 'compose', label: '曲の長さ', type: 'choice', options: [['16', '16小節'], ['32', '32小節'], ['64', '64小節']], def: '32', apply: 'next', ui: false },
  { key: 'curveStrength', group: 'compose', label: '起伏カーブの強さ', type: 'range', min: 0, max: 100, step: 5, def: 100, unit: '%', apply: 'next', ui: false },
  { key: 'maxLeap', group: 'compose', label: '接続の跳躍許容度', type: 'range', min: 2, max: 6, step: 1, def: 2, unit: '度', apply: 'next', ui: false },
  { key: 'motifRecall', group: 'compose', label: 'モチーフ再登場', type: 'toggle', def: true, apply: 'next', ui: false },
];

/** 画面に出すパラメータだけを返す。UI はこれだけを描く。 */
export function visibleParams() {
  return PARAM_DEFS.filter((d) => d.ui === true);
}

export function coerce(def, raw) {
  if (def.type === 'toggle') {
    return raw === true || raw === 1 || raw === '1' || raw === 'true';
  }
  if (def.type === 'choice') {
    const v = String(raw);
    return def.options.some(([o]) => o === v) ? v : def.def;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return def.def;
  return Math.min(def.max, Math.max(def.min, n));
}

export function normalizeSettings(obj) {
  const src = obj ?? {};
  const out = {};
  for (const d of PARAM_DEFS) {
    out[d.key] = d.key in src ? coerce(d, src[d.key]) : d.def;
  }
  if (out.tempoMax < out.tempoMin) {
    [out.tempoMin, out.tempoMax] = [out.tempoMax, out.tempoMin];
  }
  return out;
}

/**
 * 画面の選択（雰囲気・テンポ）を、compose.js が読む内部キーへ展開する。
 * 再生系に渡す前に必ずこれを通すこと。
 */
export function resolveSettings(obj) {
  const s = normalizeSettings(obj);
  return { ...s, ...MOOD_MAP[s.mood], ...TEMPO_MAP[s.tempoFeel] };
}

export function defaultSettings() {
  return normalizeSettings({});
}

export function composeParamKeys() {
  return PARAM_DEFS.filter((d) => d.code).map((d) => d.key);
}

export function encodeSongCode(seed, settings) {
  const parts = [`s=${seed}`];
  for (const d of PARAM_DEFS) {
    if (!d.code) continue;
    const v = settings[d.key];
    parts.push(`${d.code}=${d.type === 'toggle' ? (v ? 1 : 0) : v}`);
  }
  return parts.join('&');
}

export function decodeSongCode(str) {
  const map = new Map();
  for (const kv of String(str ?? '').replace(/^#/, '').split('&')) {
    const i = kv.indexOf('=');
    if (i <= 0) continue;
    map.set(kv.slice(0, i), kv.slice(i + 1));
  }
  const raw = {};
  for (const d of PARAM_DEFS) {
    if (d.code && map.has(d.code)) raw[d.key] = map.get(d.code);
  }
  const seed = map.get('s');
  return {
    seed: seed && /^[0-9a-z]+$/i.test(seed) ? seed : null,
    settings: normalizeSettings(raw),
  };
}
