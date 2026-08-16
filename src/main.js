/**
 * 起動と配線。
 *
 * ここでしか DOM と AudioContext に触らない。
 * 音の生成（synth）・曲の生成（compose）・再生（player）・設定 UI（ui）は
 * すべてこのファイルから組み合わせるだけで、互いを直接は知らない。
 */
import {
  PARAM_DEFS,
  normalizeSettings,
  resolveSettings,
  encodeSongCode,
  decodeSongCode,
} from './settings.js';
import { createEngine } from './synth.js';
import { createPlayer } from './player.js';
import { loadStoredSettings, storeSettings, createSettingsPanel } from './ui.js';

const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

// ページの URL ではなくモジュールの位置を基準に解決する。
// index.html がどの階層にあっても src/data/ を正しく指す。
const MELODIES_URL = new URL('./data/melodies.json', import.meta.url);
const PROGRESSIONS_URL = new URL('./data/progressions.json', import.meta.url);

const DEF_BY_KEY = new Map(PARAM_DEFS.map((d) => [d.key, d]));

/** 曲コードに載るキー（＝曲の内容を決めるパラメータ）だけを抜き出す */
const CODE_KEYS = PARAM_DEFS.filter((d) => d.code).map((d) => d.key);

function pickComposeParams(source) {
  const out = {};
  for (const key of CODE_KEYS) {
    if (source && key in source) out[key] = source[key];
  }
  return out;
}

/** 「C 長調 ・ 68 BPM ・ 32小節」の形にする */
function describeSong(song) {
  const tonic = Math.round(Number(song?.tonicMidi));
  const name = Number.isFinite(tonic) ? NOTE_NAMES[((tonic % 12) + 12) % 12] : '?';
  const mode = song?.mode === 'minor' ? '短調' : '長調';
  const tempo = Math.round(Number(song?.tempo)) || 0;
  const bars = Number(song?.bars) || 0;
  return `${name} ${mode} ・ ${tempo} BPM ・ ${bars}小節`;
}

/** input でも div でも同じように書けるようにする */
function setFieldValue(el, text) {
  if (!el) return;
  if ('value' in el) el.value = text;
  else el.textContent = text;
}

function getFieldValue(el) {
  if (!el) return '';
  return String(('value' in el ? el.value : el.textContent) ?? '').trim();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function init() {
  const byId = (id) => document.getElementById(id);
  const els = {
    playToggle: byId('play-toggle'),
    skip: byId('skip'),
    songCode: byId('song-code'),
    copyCode: byId('copy-code'),
    loadCode: byId('load-code'),
    nowPlaying: byId('now-playing'),
    settingsPanel: byId('settings-panel'),
    status: byId('status'),
  };

  // ---- 状態 -----------------------------------------------------------
  let settings = normalizeSettings(loadStoredSettings());
  /** 次の再生で使うシード（URL ハッシュや曲コード由来）。使ったら捨てる */
  let pendingSeed = null;
  /** @type {object | null} */
  let data = null;
  /** @type {AudioContext | null} */
  let audioCtx = null;
  let engine = null;
  let player = null;
  let panel = null;
  let statusTimer = null;

  // ---- ステータス表示 --------------------------------------------------
  function setStatus(text, clearAfterMs) {
    if (statusTimer !== null) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    if (els.status) els.status.textContent = text;
    if (clearAfterMs) {
      statusTimer = setTimeout(() => {
        statusTimer = null;
        if (els.status) els.status.textContent = '';
      }, clearAfterMs);
    }
  }

  // index.html の初期ラベル「▶ 再生する」に合わせて記号ごと差し替える
  function setPlayLabel(isPlaying) {
    if (!els.playToggle) return;
    els.playToggle.textContent = isPlaying ? '⏸ 停止する' : '▶ 再生する';
    els.playToggle.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
  }

  // ---- URL ハッシュ：作曲パラメータとシードを上書きする -------------------
  // サウンド系は曲の内容に関係しないので localStorage の値を保つ。
  const hash = String(globalThis.location?.hash ?? '').replace(/^#/, '');
  if (hash) {
    const decoded = decodeSongCode(hash);
    settings = normalizeSettings({
      ...settings,
      ...pickComposeParams(decoded.settings),
    });
    pendingSeed = decoded.seed;
  }

  // ---- 音まわりの生成は最初のクリックまで遅らせる -------------------------
  // ページ読み込み時に AudioContext を作ると自動再生制限で suspended のまま残る。
  function ensureAudio() {
    if (player) return player;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) throw new Error('このブラウザは Web Audio API に対応していません');
    audioCtx = new Ctor();
    engine = createEngine(audioCtx, resolveSettings(settings));
    // 設定は関数越しに渡す。player 側でキャッシュさせないため。
    player = createPlayer(audioCtx, engine, data, () => resolveSettings(settings));
    player.onSongChange(handleSongChange);
    return player;
  }

  function startPlayback(seed) {
    if (!data) {
      setStatus('データを読み込めていないため再生できません');
      return;
    }
    let p;
    try {
      p = ensureAudio();
    } catch (err) {
      setStatus(`音声を初期化できませんでした: ${err.message}`);
      return;
    }
    setPlayLabel(true);
    Promise.resolve(p.start(seed ?? undefined)).catch((err) => {
      console.error(err);
      setPlayLabel(false);
      setStatus(`再生を開始できませんでした: ${err.message}`);
    });
  }

  // ---- 曲が切り替わったとき -------------------------------------------
  function handleSongChange(song) {
    if (!song) return;
    const code = encodeSongCode(song.seed, settings);
    setFieldValue(els.songCode, code);

    // リロードしても同じ曲に戻れるようにハッシュを合わせる。
    // 履歴を汚さないよう replaceState を優先する（URL の見た目は同じ）。
    try {
      const { history, location } = globalThis;
      if (history?.replaceState) {
        history.replaceState(null, '', `${location.pathname}${location.search}#${code}`);
      } else if (location) {
        location.hash = code;
      }
    } catch (err) {
      console.warn('URL ハッシュを更新できませんでした', err);
    }

    if (els.nowPlaying) els.nowPlaying.textContent = describeSong(song);
  }

  // ---- 設定パネル ------------------------------------------------------
  if (els.settingsPanel) {
    panel = createSettingsPanel(els.settingsPanel, {
      settings,
      onChange(key, value, next) {
        settings = normalizeSettings(next);
        storeSettings(settings);
        // サウンド系だけは鳴っている最中でも即座に反映する。
        // 作曲・演奏系は曲の組み立て時にすでに使われているので次の曲から。
        if (DEF_BY_KEY.get(key)?.apply === 'live' && player) {
          player.applySettings(resolveSettings(settings));
        }
      },
      onRebuild() {
        // 同じシードのまま、新しい設定で作り直す
        const seed = player?.getCurrentSong()?.seed ?? pendingSeed ?? undefined;
        startPlayback(seed);
      },
    });
  }

  // ---- ボタン ----------------------------------------------------------
  const gatedButtons = [els.playToggle, els.skip, els.loadCode].filter(Boolean);
  for (const button of gatedButtons) button.disabled = true;

  setPlayLabel(false);

  if (els.playToggle) {
    els.playToggle.addEventListener('click', () => {
      if (player?.isPlaying()) {
        player.stop();
        setPlayLabel(false);
        return;
      }
      const seed = pendingSeed;
      pendingSeed = null;
      startPlayback(seed);
    });
  }

  if (els.skip) {
    els.skip.addEventListener('click', () => {
      if (player?.isPlaying()) {
        player.skip();
        return;
      }
      // 停止中に押されたら、そのまま新しい曲で再生を始める
      pendingSeed = null;
      startPlayback();
    });
  }

  if (els.copyCode) {
    els.copyCode.addEventListener('click', async () => {
      const code = getFieldValue(els.songCode);
      if (!code) {
        setStatus('コピーする曲コードがまだありません', 2000);
        return;
      }
      const clipboard = globalThis.navigator?.clipboard;
      if (clipboard?.writeText) {
        try {
          await clipboard.writeText(code);
          setStatus('コピーしました', 1500);
          return;
        } catch (err) {
          console.warn('クリップボードへの書き込みに失敗しました', err);
        }
      }
      // http:// や古いブラウザではクリップボード API が使えない。
      // 選択状態にして、手でコピーしてもらう。
      try {
        els.songCode?.focus?.();
        els.songCode?.select?.();
      } catch (err) {
        console.warn('曲コードを選択できませんでした', err);
      }
      setStatus('コピーできませんでした。選択してあるので Ctrl+C を押してください', 4000);
    });
  }

  if (els.loadCode) {
    els.loadCode.addEventListener('click', () => {
      const raw = getFieldValue(els.songCode);
      if (!raw) {
        setStatus('曲コードを入力してください', 2500);
        return;
      }
      const decoded = decodeSongCode(raw);
      if (!decoded.seed) {
        setStatus('曲コードが正しくありません', 3000);
        return;
      }
      // 作曲パラメータだけ取り込む。音量やリバーブは今の設定のまま。
      settings = normalizeSettings({
        ...settings,
        ...pickComposeParams(decoded.settings),
      });
      storeSettings(settings);
      panel?.setSettings(settings);
      panel?.clearPending();
      if (player) player.applySettings(resolveSettings(settings));
      pendingSeed = null;
      setStatus('曲コードを読み込みました', 2000);
      startPlayback(decoded.seed);
    });
  }

  // ---- データ読み込み --------------------------------------------------
  setStatus('データを読み込んでいます…');
  Promise.all([fetchJson(MELODIES_URL), fetchJson(PROGRESSIONS_URL)])
    .then(([melodies, progressions]) => {
      if (!Array.isArray(melodies) || melodies.length === 0) {
        throw new Error('melodies.json の中身が配列ではありません');
      }
      if (!Array.isArray(progressions) || progressions.length === 0) {
        throw new Error('progressions.json の中身が配列ではありません');
      }
      data = { melodies, progressions };
      for (const button of gatedButtons) button.disabled = false;
      setStatus('');
    })
    .catch((err) => {
      console.error(err);
      // 黙って壊れないこと。原因（file:// 直開きが多い）まで出す。
      for (const button of gatedButtons) button.disabled = true;
      setPlayLabel(false);
      setStatus(
        `データを読み込めませんでした（${err.message}）。` +
          'ローカルサーバー経由で開いてください（npm start）。',
      );
    });
}

// type="module" は defer 相当なので、この時点の readyState は 'interactive'。
// DOMContentLoaded はまだ来ていないので待てる。動的 import などで 'complete' に
// なってから読み込まれた場合はもう来ないので、その場で起動する。
if (document.readyState === 'complete') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init, { once: true });
}
