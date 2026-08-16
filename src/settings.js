export const GROUP_LABELS = {
  sound: 'サウンド（すぐ反映）',
  humanize: '演奏（次の曲から）',
  compose: '作曲（次の曲から）',
};

const KEY_OPTIONS = [
  ['random', 'ランダム'],
  ['0', 'C'], ['1', 'C#'], ['2', 'D'], ['3', 'D#'], ['4', 'E'], ['5', 'F'],
  ['6', 'F#'], ['7', 'G'], ['8', 'G#'], ['9', 'A'], ['10', 'A#'], ['11', 'B'],
];

// 調整可能パラメータの唯一の定義。UIパネルはこの配列から自動生成される。
export const PARAM_DEFS = [
  // サウンド：ゲイン値の書き換えだけなので即座に反映する
  { key: 'masterVolume', group: 'sound', label: '全体音量', type: 'range', min: 0, max: 100, step: 1, def: 70, unit: '%', apply: 'live' },
  { key: 'melodyVolume', group: 'sound', label: 'メロディー音量', type: 'range', min: 0, max: 100, step: 1, def: 100, unit: '%', apply: 'live' },
  { key: 'accompVolume', group: 'sound', label: '伴奏音量', type: 'range', min: 0, max: 100, step: 1, def: 45, unit: '%', apply: 'live' },
  { key: 'padVolume', group: 'sound', label: 'パッド音量', type: 'range', min: 0, max: 100, step: 1, def: 35, unit: '%', apply: 'live' },
  { key: 'reverbAmount', group: 'sound', label: 'リバーブ量', type: 'range', min: 0, max: 100, step: 1, def: 45, unit: '%', apply: 'live' },
  { key: 'brightness', group: 'sound', label: '音色の明るさ', type: 'range', min: 0, max: 100, step: 1, def: 50, unit: '%', apply: 'live' },

  // 演奏：曲の組み立て時に適用済みなので次の曲から
  { key: 'timingJitterMs', group: 'humanize', label: 'タイミングの揺らぎ', type: 'range', min: 0, max: 30, step: 1, def: 10, unit: 'ms', apply: 'next' },
  { key: 'velocityJitter', group: 'humanize', label: 'ベロシティの揺らぎ', type: 'range', min: 0, max: 25, step: 1, def: 8, unit: '%', apply: 'next' },
  { key: 'tenuto', group: 'humanize', label: '頂点音のテヌート', type: 'toggle', def: true, apply: 'next' },
  { key: 'ritardando', group: 'humanize', label: '終盤のリタルダンド', type: 'toggle', def: true, apply: 'next' },
  { key: 'gapSeconds', group: 'humanize', label: '曲間の余韻', type: 'range', min: 0, max: 10, step: 0.5, def: 3.5, unit: '秒', apply: 'live' },

  // 作曲：曲コードに含める
  { key: 'tempoMin', group: 'compose', label: 'テンポ下限', type: 'range', min: 52, max: 92, step: 1, def: 64, unit: 'BPM', apply: 'next', code: 'tn' },
  { key: 'tempoMax', group: 'compose', label: 'テンポ上限', type: 'range', min: 52, max: 92, step: 1, def: 76, unit: 'BPM', apply: 'next', code: 'tx' },
  { key: 'musicKey', group: 'compose', label: 'キー', type: 'choice', options: KEY_OPTIONS, def: 'random', apply: 'next', code: 'k' },
  { key: 'majorRatio', group: 'compose', label: '長調の比率', type: 'range', min: 0, max: 100, step: 5, def: 55, unit: '%', apply: 'next', code: 'mj' },
  { key: 'songBars', group: 'compose', label: '曲の長さ', type: 'choice', options: [['16', '16小節'], ['32', '32小節'], ['64', '64小節']], def: '32', apply: 'next', code: 'b' },
  { key: 'curveStrength', group: 'compose', label: '起伏カーブの強さ', type: 'range', min: 0, max: 100, step: 5, def: 100, unit: '%', apply: 'next', code: 'cv' },
  { key: 'maxLeap', group: 'compose', label: '接続の跳躍許容度', type: 'range', min: 2, max: 6, step: 1, def: 2, unit: '度', apply: 'next', code: 'lp' },
  { key: 'motifRecall', group: 'compose', label: 'モチーフ再登場', type: 'toggle', def: true, apply: 'next', code: 'mr' },
];

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
