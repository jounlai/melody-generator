/**
 * 設定パネルの自動生成と、設定の保存・読み込み。
 *
 * このファイルには個々のパラメータ（音量やテンポなど）を一切書かない。
 * すべて `PARAM_DEFS` を走査して組み立てる。パラメータを増やすときに
 * 触るファイルが settings.js だけで済むようにするため。
 */
import {
  PARAM_DEFS,
  GROUP_LABELS,
  visibleParams,
  normalizeSettings,
  defaultSettings,
} from './settings.js';
import { t } from './i18n.js';

const STORAGE_KEY = 'melodyGenerator.settings';

const DEF_BY_KEY = new Map(PARAM_DEFS.map((d) => [d.key, d]));

/**
 * localStorage から設定を読む。無い・壊れている・localStorage が使えない場合は
 * 既定値を返す。例外は投げない。
 * @returns {Record<string, unknown>}
 */
export function loadStoredSettings() {
  try {
    const store = globalThis.localStorage;
    const raw = store ? store.getItem(STORAGE_KEY) : null;
    if (!raw) return defaultSettings();
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

/**
 * 設定を localStorage に保存する。プライベートモードや容量超過で
 * 書き込めない場合は黙って諦める（機能は継続する）。
 * @param {Record<string, unknown>} settings
 */
export function storeSettings(settings) {
  try {
    const store = globalThis.localStorage;
    if (!store) return;
    store.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch {
    /* 保存できなくても再生は続けられるので無視する */
  }
}

/** step から小数桁数を求める（0.5 なら 1 桁） */
function decimalsOf(step) {
  const text = String(step ?? 1);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** 現在値の表示文字列。unit があれば後ろに付ける */
function formatValue(def, value) {
  const num = Number(value);
  const text = Number.isFinite(num)
    ? num.toFixed(decimalsOf(def.step))
    : String(value);
  if (!def.unit) return text;
  // 'ms' や 'BPM' は半角空きを入れ、'%' '秒' '度' は詰める
  const gap = /^[A-Za-z]/.test(def.unit) ? ' ' : '';
  return `${text}${gap}${def.unit}`;
}

/** GROUP_LABELS の順を基本に、未知のグループは後ろへ回す */
function groupOrder() {
  const order = [];
  const seen = new Set();
  for (const key of Object.keys(GROUP_LABELS)) {
    order.push(key);
    seen.add(key);
  }
  for (const def of PARAM_DEFS) {
    if (!seen.has(def.group)) {
      order.push(def.group);
      seen.add(def.group);
    }
  }
  return order;
}

/**
 * 設定パネルを rootEl の中に構築する。
 *
 * @param {HTMLElement} rootEl 差し込み先の空要素
 * @param {{
 *   settings?: Record<string, unknown>,
 *   onChange?: (key: string, value: unknown, next: Record<string, unknown>) => void,
 * }} [options]
 * @returns {{ setSettings: (s: Record<string, unknown>) => void }}
 */
export function createSettingsPanel(rootEl, options = {}) {
  if (!rootEl) throw new Error('createSettingsPanel: rootEl が必要です');

  const doc = rootEl.ownerDocument || globalThis.document;
  const onChange =
    typeof options.onChange === 'function' ? options.onChange : () => {};

  let settings = normalizeSettings(options.settings);
  /** @type {Map<string, (value: unknown) => void>} コントロールへ値を書き戻す関数 */
  const syncers = new Map();

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  rootEl.textContent = '';
  rootEl.classList.add('settings');

  // ---- 値の反映 -------------------------------------------------------
  function syncOne(key, value) {
    const sync = syncers.get(key);
    if (sync) sync(value);
  }

  /**
   * 変更を取り込む。normalizeSettings を通すので、範囲外の値や
   * テンポ上下限の逆転はここで整合が取られ、その結果でコントロールも同期される。
   */
  function applyPatch(patch) {
    const next = normalizeSettings({ ...settings, ...patch });
    // クランプで値が戻された場合にも表示を合わせるため、触ったキーは必ず同期
    for (const key of Object.keys(patch)) syncOne(key, next[key]);

    const changed = Object.keys(next).filter((k) => next[k] !== settings[k]);
    if (changed.length === 0) return;

    settings = next;
    for (const key of changed) syncOne(key, next[key]);
    for (const key of changed) onChange(key, next[key], next);
  }

  // ---- コントロールの生成 ---------------------------------------------
  function buildField(def) {
    const field = el('div', `field field-${def.type}`);
    const id = `param-${def.key}`;

    const head = el('div', 'field-head');
    const label = el('label', 'field-label', t(def.label));
    label.htmlFor = id;
    head.append(label);

    let control;
    let sync;

    if (def.type === 'toggle') {
      control = doc.createElement('input');
      control.type = 'checkbox';
      control.addEventListener('change', () =>
        applyPatch({ [def.key]: control.checked }),
      );
      sync = (value) => {
        control.checked = Boolean(value);
      };
    } else if (def.type === 'choice') {
      control = doc.createElement('select');
      for (const [value, text] of def.options || []) {
        const option = doc.createElement('option');
        option.value = String(value);
        option.textContent = t(String(text));
        control.append(option);
      }
      control.addEventListener('change', () =>
        applyPatch({ [def.key]: control.value }),
      );
      sync = (value) => {
        control.value = String(value);
      };
    } else {
      // range
      const readout = el('span', 'field-value');
      head.append(readout);
      control = doc.createElement('input');
      control.type = 'range';
      control.min = String(def.min);
      control.max = String(def.max);
      control.step = String(def.step);
      control.addEventListener('input', () =>
        applyPatch({ [def.key]: Number(control.value) }),
      );
      sync = (value) => {
        control.value = String(value);
        readout.textContent = formatValue(def, value);
      };
    }

    control.id = id;
    control.classList.add('field-input');
    if (def.apply === 'next') field.dataset.apply = 'next';

    // トグルはラベル行の右端に置き、それ以外はラベル行の下に敷く
    if (def.type === 'toggle') {
      head.append(control);
      field.append(head);
    } else {
      field.append(head, control);
    }

    // 補足があれば操作の下に添える。何が起きるか分かってから触れるようにする。
    if (def.hint) {
      const hint = el('p', 'field-hint', t(def.hint));
      hint.id = `${id}-hint`;
      control.setAttribute('aria-describedby', hint.id);
      field.append(hint);
    }

    syncers.set(def.key, sync);
    return field;
  }

  function build() {
  for (const group of groupOrder()) {
    const defs = visibleParams().filter((def) => def.group === group);
    if (defs.length === 0) continue;

    const details = el('details', 'settings-group');
    // 出す項目を絞ってあるので、畳む意味がない。常に開いておく。
    details.open = true;
    details.append(
      el('summary', 'settings-group-title', t(GROUP_LABELS[group] || group)),
    );

    const fields = el('div', 'settings-fields');
    for (const def of defs) fields.append(buildField(def));
    details.append(fields);
    rootEl.append(details);
  }

  // ---- 既定値に戻す ---------------------------------------------------
  const footer = el('div', 'settings-footer');
  const resetButton = el('button', 'settings-reset', t('settings.reset'));
  resetButton.type = 'button';
  resetButton.addEventListener('click', () => applyPatch(defaultSettings()));
  footer.append(resetButton);
  rootEl.append(footer);

  // 初期表示
  for (const key of syncers.keys()) syncOne(key, settings[key]);
  }

  build();

  return {
    /** 言語が変わったときに、ラベルごと作り直す */
    rebuild() {
      syncers.clear();
      rootEl.textContent = '';
      build();
    },
    /** 外部から値を流し込む。onChange は発火しない */
    setSettings(nextSettings) {
      settings = normalizeSettings(nextSettings);
      for (const key of syncers.keys()) syncOne(key, settings[key]);
    },
  };
}
