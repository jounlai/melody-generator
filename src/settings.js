import { instrumentOptions, DEFAULT_INSTRUMENT } from './instrument.js';

// 表示文字列そのものではなく i18n のキーを持つ。
// 画面に出すときに ui.js が t() を通す（言語を切り替えても定義は1つのまま）。
export const GROUP_LABELS = {
  sound: 'group.sound',
  compose: 'group.compose',
  humanize: 'group.humanize',
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
  { key: 'masterVolume', group: 'sound', label: 'param.masterVolume', type: 'range', min: 0, max: 100, step: 1, def: 85, unit: '%', apply: 'live', ui: true },
  { key: 'mood', group: 'compose', label: 'param.mood', type: 'choice', apply: 'next', ui: true, code: 'md', def: 'balanced',
    hint: 'hint.mood',
    options: [['bright', 'opt.mood.bright'], ['balanced', 'opt.mood.balanced'], ['wistful', 'opt.mood.wistful']] },
  { key: 'tempoFeel', group: 'compose', label: 'param.tempoFeel', type: 'choice', apply: 'next', ui: true, code: 'tp', def: 'normal',
    options: [['slow', 'opt.tempo.slow'], ['normal', 'opt.tempo.normal'], ['flowing', 'opt.tempo.flowing']] },
  // 楽器。曲の中身は変えず、鳴らす音だけを変える（instrument.js が唯一の定義）。
  { key: 'instrument', group: 'sound', label: 'param.instrument', type: 'choice', apply: 'next', ui: true, code: 'it',
    hint: 'hint.instrument',
    def: DEFAULT_INSTRUMENT.key, options: instrumentOptions() },

  // ---- 以下は固定値。画面には出さない ----

  // 音のバランス。メロディーを最前面に、伴奏とパッドは下支えに徹させる
  { key: 'melodyVolume', group: 'sound', label: 'param.melodyVolume', type: 'range', min: 0, max: 100, step: 1, def: 100, unit: '%', apply: 'live', ui: false },
  { key: 'accompVolume', group: 'sound', label: 'param.accompVolume', type: 'range', min: 0, max: 100, step: 1, def: 80, unit: '%', apply: 'live', ui: false },
  { key: 'padVolume', group: 'sound', label: 'param.padVolume', type: 'range', min: 0, max: 100, step: 1, def: 62, unit: '%', apply: 'live', ui: false },
  { key: 'reverbAmount', group: 'sound', label: 'param.reverbAmount', type: 'range', min: 0, max: 100, step: 1, def: 48, unit: '%', apply: 'live', ui: false },
  { key: 'brightness', group: 'sound', label: 'param.brightness', type: 'range', min: 0, max: 100, step: 1, def: 42, unit: '%', apply: 'live', ui: false },

  // 人間らしさ。数値をいじる対象ではないので固定
  { key: 'timingJitterMs', group: 'humanize', label: 'param.timingJitterMs', type: 'range', min: 0, max: 30, step: 1, def: 12, unit: 'ms', apply: 'next', ui: false },
  { key: 'velocityJitter', group: 'humanize', label: 'param.velocityJitter', type: 'range', min: 0, max: 25, step: 1, def: 10, unit: '%', apply: 'next', ui: false },
  { key: 'tenuto', group: 'humanize', label: 'param.tenuto', type: 'toggle', def: true, apply: 'next', ui: false },
  { key: 'ritardando', group: 'humanize', label: 'param.ritardando', type: 'toggle', def: true, apply: 'next', ui: false },
  { key: 'gapSeconds', group: 'humanize', label: 'param.gapSeconds', type: 'range', min: 0, max: 10, step: 0.5, def: 3.5, unit: '秒', apply: 'live', ui: false },

  // 作曲。mood / tempoFeel から導出されるか、変える意味が薄いので固定
  { key: 'tempoMin', group: 'compose', label: 'param.tempoMin', type: 'range', min: 52, max: 92, step: 1, def: 64, unit: 'BPM', apply: 'next', ui: false },
  { key: 'tempoMax', group: 'compose', label: 'param.tempoMax', type: 'range', min: 52, max: 92, step: 1, def: 74, unit: 'BPM', apply: 'next', ui: false },
  { key: 'musicKey', group: 'compose', label: 'param.musicKey', type: 'choice', options: KEY_OPTIONS, def: 'random', apply: 'next', ui: false },
  { key: 'majorRatio', group: 'compose', label: 'param.majorRatio', type: 'range', min: 0, max: 100, step: 5, def: 55, unit: '%', apply: 'next', ui: false },
  { key: 'songBars', group: 'compose', label: 'param.songBars', type: 'choice', options: [['16', '16小節'], ['32', '32小節'], ['64', '64小節']], def: '32', apply: 'next', ui: false },
  { key: 'curveStrength', group: 'compose', label: 'param.curveStrength', type: 'range', min: 0, max: 100, step: 5, def: 100, unit: '%', apply: 'next', ui: false },
  { key: 'maxLeap', group: 'compose', label: 'param.maxLeap', type: 'range', min: 2, max: 6, step: 1, def: 2, unit: '度', apply: 'next', ui: false },
  { key: 'motifRecall', group: 'compose', label: 'param.motifRecall', type: 'toggle', def: true, apply: 'next', ui: false },

  // ---- 生成器の版 ----
  //
  // 選び方や材料を変えると、同じ曲コードから別の曲が出る。共有された URL が
  // 別の曲を鳴らすのは、この道具では壊れたのと同じことなので、版で分ける。
  //
  // 曲コードに桁が無い＝この項目がまだ無かった時代のコード＝初版。
  // decodeSongCode がそこだけ既定値ではなく LEGACY_VERSION に倒す。
  // 逆に新しい曲は必ず桁を書く（encodeSongCode の短縮形は初版のときだけ）。
  //
  { key: 'generatorVersion', group: 'compose', label: 'param.generatorVersion', type: 'choice', apply: 'next', ui: false, code: 'gv',
    def: '2',
    options: [['1', 'opt.gv.1'], ['2', 'opt.gv.2']] },
  // 既存の曲コードを壊さないため、コード付きの新項目は必ず末尾へ足す。
  { key: 'composerEngine', group: 'compose', label: 'param.composerEngine', type: 'choice', apply: 'next', ui: true, code: 'ce',
    hint: 'hint.composerEngine', def: 'codex3',
    options: [['codex', 'opt.engine.codex'], ['claude', 'opt.engine.claude'], ['codex2', 'opt.engine.codex2'], ['codex3', 'opt.engine.codex3']] },
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

/**
 * 曲コード。URL のハッシュに載せるので、短さがそのまま使い勝手になる。
 *
 * 形式は `<シード>` または `<シード>.<選択肢の添字を1文字ずつ>`。
 * 添字は PARAM_DEFS で code を持つ選択肢パラメータの並び順で、36進数1桁。
 * すべて既定値のときは添字ごと省く（共有される曲の大半がこれに当たる）。
 *
 *   既定のまま      #k3f9zq
 *   雰囲気と楽器を変更  #k3f9zq.204
 *
 * !!! 位置で意味が決まるので、code を持つパラメータを途中に挿入しないこと !!!
 * 追加するときは必ず末尾に足す（古い URL の添字がずれる）。
 */
// 桁が足りない曲コードが指す版。初版の曲コードには gv の桁が無い。
export const LEGACY_VERSION = '1';

const CODE_DEFS = () => PARAM_DEFS.filter((d) => d.code && d.type === 'choice');

function optionIndex(def, value) {
  const i = def.options.findIndex(([o]) => o === String(value));
  return i < 0 ? def.options.findIndex(([o]) => o === def.def) : i;
}

export function composeParamKeys() {
  return CODE_DEFS().map((d) => d.key);
}

export function encodeSongCode(seed, settings) {
  const s = normalizeSettings(settings);
  const defs = CODE_DEFS();
  const digits = defs.map((d) => optionIndex(d, s[d.key]));
  // 全部が既定値なら添字を書かない。いちばん短い形にする。
  // ただし「既定値」の基準は**初版**の値。桁の無いコードは初版として解かれるので、
  // 版2の曲で桁を省くと、自分の曲コードが別の曲を指すことになる。
  const shortDef = (d) => {
    if (d.key === 'generatorVersion') return LEGACY_VERSION;
    if (d.key === 'composerEngine') return 'claude';
    return d.def;
  };
  if (digits.every((v, i) => v === optionIndex(defs[i], shortDef(defs[i])))) return String(seed);
  return `${seed}.${digits.map((v) => v.toString(36)).join('')}`;
}

/**
 * 曲コードを解く。古い形式（`s=...&md=...`）も読めるようにしてある。
 * 共有済みの URL を壊さないため。
 */
export function decodeSongCode(str) {
  const text = String(str ?? '').replace(/^#/, '').trim();

  // --- 旧形式 ---
  if (text.includes('=')) {
    const map = new Map();
    for (const kv of text.split('&')) {
      const i = kv.indexOf('=');
      if (i <= 0) continue;
      map.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const raw = {};
    for (const d of PARAM_DEFS) {
      if (d.code && map.has(d.code)) raw[d.key] = map.get(d.code);
    }
    const old = map.get('s');
    // 旧形式のコードは、生成器が1つしか無かった時代のもの。
    if (!('generatorVersion' in raw)) raw.generatorVersion = LEGACY_VERSION;
    if (!('composerEngine' in raw)) raw.composerEngine = 'claude';
    return {
      seed: old && /^[0-9a-z]+$/i.test(old) ? old : null,
      settings: normalizeSettings(raw),
    };
  }

  // --- 現行形式 ---
  const dot = text.indexOf('.');
  const seed = dot < 0 ? text : text.slice(0, dot);
  const digits = dot < 0 ? '' : text.slice(dot + 1);
  const raw = {};
  CODE_DEFS().forEach((d, i) => {
    const ch = digits[i];
    if (ch === undefined) {
      // 桁が無い＝その項目がまだ無かった時代のコード。生成器の版だけは
      // 既定値（＝最新）ではなく初版に倒す。共有済みの URL を守るため。
      if (d.key === 'generatorVersion') raw[d.key] = LEGACY_VERSION;
      if (d.key === 'composerEngine') raw[d.key] = 'claude';
      return;
    }
    const n = parseInt(ch, 36);
    if (Number.isFinite(n) && n >= 0 && n < d.options.length) raw[d.key] = d.options[n][0];
  });
  return {
    seed: seed && /^[0-9a-z]+$/i.test(seed) ? seed : null,
    settings: normalizeSettings(raw),
  };
}
