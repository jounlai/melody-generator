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
import { renderScore, keySignature } from './notation.js';
import { toMusicXML, toMidi, suggestFilename } from './export.js';
import { loadStoredSettings, storeSettings, createSettingsPanel } from './ui.js';

const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

// ページの URL ではなくモジュールの位置を基準に解決する。
// index.html がどの階層にあっても src/data/ を正しく指す。
const MELODIES_URL = new URL('./data/melodies.json', import.meta.url);
const PROGRESSIONS_URL = new URL('./data/progressions.json', import.meta.url);

const DEF_BY_KEY = new Map(PARAM_DEFS.map((d) => [d.key, d]));

/** プレイヘッドを枠のどこに置くか。中央よりやや左に置くと先が読める */
const FOLLOW_RATIO = 0.4;

/** 手で動かしたあと、自動追従に戻るまでの時間 */
const USER_SCROLL_HOLD_MS = 3000;

/** 自分で動かしたスクロールと手で動かされたスクロールを見分ける許容差（px） */
const SCROLL_EPSILON = 2;

/** 追従の追いつき具合。1 に近いほど機敏で、小さいほどぬるりと動く */
const SCROLL_EASE = 0.25;

/** 曲コードに載るキー（＝曲の内容を決めるパラメータ）だけを抜き出す */
const CODE_KEYS = PARAM_DEFS.filter((d) => d.code).map((d) => d.key);

function pickComposeParams(source) {
  const out = {};
  for (const key of CODE_KEYS) {
    if (source && key in source) out[key] = source[key];
  }
  return out;
}

/** 楽譜と同じ調名。notation.js が出せなくても表示は続けたいので握りつぶす */
function keyLabel(song) {
  try {
    const label = String(keySignature(song?.tonicMidi, song?.mode)?.label ?? '').trim();
    return label || null;
  } catch (err) {
    console.warn('調名を出せませんでした', err);
    return null;
  }
}

/** 「ハ長調（C） ・ 68 BPM ・ 32小節」の形にする */
function describeSong(song) {
  const tonic = Math.round(Number(song?.tonicMidi));
  const name = Number.isFinite(tonic) ? NOTE_NAMES[((tonic % 12) + 12) % 12] : '?';
  const mode = song?.mode === 'minor' ? '短調' : '長調';
  const tempo = Math.round(Number(song?.tempo)) || 0;
  const bars = Number(song?.bars) || 0;
  // 調名は楽譜の調号と同じ呼び方（ハ長調）で出す。括弧の中は和音を追う人向けの音名。
  const label = keyLabel(song);
  const key = label ? `${label}（${name}）` : `${name} ${mode}`;
  return `${key} ・ ${tempo} BPM ・ ${bars}小節`;
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

// ---- ファイルの保存 ----------------------------------------------------
// このページは1枚の HTML として配られ、ダブルクリック（file://）で開かれる。
// その状況では blob: からのダウンロードを断るブラウザがあるので、
// 失敗したら data: URL に切り替えて必ず手元に届くようにする。

const MUSICXML_MIME = 'application/vnd.recordare.musicxml+xml';
const MIDI_MIME = 'audio/midi';

/**
 * blob: URL を解放するまでの猶予。click() の直後に消すと、
 * ダウンロードが始まる前に URL が無効になるブラウザがある。
 */
const OBJECT_URL_TTL_MS = 250;

/** 文字列を UTF-8 のバイト列にする（日本語の曲名などを壊さないため） */
function textToBytes(text) {
  const source = String(text);
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(source);
  // TextEncoder が無い環境向け。encodeURIComponent が作る %XX は UTF-8 の1バイト。
  const escaped = encodeURIComponent(source);
  const out = [];
  for (let i = 0; i < escaped.length; i += 1) {
    if (escaped[i] === '%') {
      out.push(parseInt(escaped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(escaped.charCodeAt(i));
    }
  }
  return new Uint8Array(out);
}

/**
 * バイト列を base64 にする。
 * btoa が受け取れるのは「1文字 = 1バイト」の文字列だけなので、
 * Uint8Array を一度その形に直してから渡す。引数の個数には上限があるため小分けにする。
 */
function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const encode = globalThis.btoa;
  if (typeof encode !== 'function') {
    throw new Error('この環境では base64 に変換できません');
  }
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return encode(binary);
}

/** @param {Uint8Array | string} payload */
function toDataUrl(payload, mime) {
  const bytes = typeof payload === 'string' ? textToBytes(payload) : payload;
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** ダウンロード用のリンクを作って押す。文書に入れないと反応しないブラウザがある */
function clickDownloadLink(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
}

function revokeSoon(url) {
  const revoke = () => {
    try {
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('blob URL を解放できませんでした', err);
    }
  };
  if (typeof setTimeout === 'function') setTimeout(revoke, OBJECT_URL_TTL_MS);
  else revoke();
}

/**
 * ファイルを1つ保存させる。blob: が駄目なら data: URL でやり直す。
 * どちらも駄目なら例外はそのまま投げる（呼び出し側が画面に出す）。
 *
 * @param {Uint8Array | string} payload
 * @param {string} filename
 * @param {string} mime
 */
function downloadFile(payload, filename, mime) {
  let objectUrl = null;
  try {
    const blob = new Blob([payload], { type: mime });
    objectUrl = URL.createObjectURL(blob);
  } catch (err) {
    console.warn('blob URL を作れませんでした。data: URL で保存します', err);
    objectUrl = null;
  }

  if (objectUrl) {
    try {
      clickDownloadLink(objectUrl, filename);
      return;
    } catch (err) {
      console.warn('blob URL から保存できませんでした。data: URL で保存し直します', err);
    } finally {
      revokeSoon(objectUrl);
    }
  }

  clickDownloadLink(toDataUrl(payload, mime), filename);
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
    scoreView: byId('score-view'),
    scoreToggle: byId('score-toggle'),
    exportMusicXml: byId('export-musicxml'),
    exportMidi: byId('export-midi'),
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

  // ---- 楽譜 ------------------------------------------------------------
  // 描くのは曲ごとに一度きり。毎フレームやるのはプレイヘッドの移動と、
  // 鳴り始めた／鳴り終わった音符の付け外しだけにする。
  const score = {
    visible: true,
    /** @type {((beat: number) => number) | null} */
    beatToX: null,
    /** @type {number[]} 小節の開始 x 座標。beatToX が無いときの補間に使う */
    barX: [],
    /** @type {HTMLElement | null} */
    playhead: null,
    /**
     * 拍位置の昇順に並べた音符。前から順に舐めるだけで済むので、
     * 1000 個あっても毎フレーム見るのは新しく鳴り始めたぶんだけ。
     * @type {Array<{ el: Element, beat: number, end: number }>}
     */
    notes: [],
    /** notes のうち、ここより手前は「もう鳴り始めた」と判定済み */
    cursor: 0,
    /** いま is-playing が付いている音符。同時に鳴るのはせいぜい数個 */
    active: [],
    /** 直前のフレームの拍位置。null は「今は何も鳴っていない」 */
    lastPos: null,
    /** 自分で入れたスクロール位置。手で動かされたかの判定に使う */
    autoScrollLeft: -1,
    /** この時刻までは自動追従を止める */
    holdUntil: 0,
  };

  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  const raf = typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : null;

  function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function clearHighlight() {
    for (const note of score.active) note.el.classList.remove('is-playing');
    score.active.length = 0;
  }

  /** 楽譜を捨てて、代わりに一言だけ置く */
  function showScorePlaceholder(text) {
    if (!els.scoreView) return;
    const p = document.createElement('p');
    p.className = 'score-empty';
    p.textContent = text;
    els.scoreView.innerHTML = '';
    els.scoreView.appendChild(p);
    score.beatToX = null;
    score.barX = [];
    score.playhead = null;
    score.notes = [];
    score.active = [];
    score.cursor = 0;
    score.lastPos = null;
  }

  function buildScore(song) {
    if (!els.scoreView) return;
    let rendered;
    try {
      rendered = renderScore(song);
    } catch (err) {
      // 楽譜が描けないだけで音は鳴らせる。再生は止めない。
      console.error('楽譜を描けませんでした', err);
      showScorePlaceholder('この曲の楽譜は表示できませんでした');
      return;
    }

    const canvas = document.createElement('div');
    canvas.className = 'score-canvas';
    // notation.js が返す文字列はエスケープ済み（あちら側のテストで保証）
    canvas.innerHTML = String(rendered?.svg ?? '');

    const playhead = document.createElement('div');
    playhead.className = 'score-playhead';
    playhead.hidden = true;
    canvas.appendChild(playhead);

    els.scoreView.innerHTML = '';
    els.scoreView.appendChild(canvas);

    const notes = [];
    for (const el of canvas.querySelectorAll('.note')) {
      const beat = Number(el.getAttribute('data-beat'));
      if (!Number.isFinite(beat)) continue;
      const dur = Number(el.getAttribute('data-dur'));
      notes.push({ el, beat, end: beat + (Number.isFinite(dur) && dur > 0 ? dur : 0) });
    }
    notes.sort((a, b) => a.beat - b.beat);

    score.beatToX = typeof rendered?.beatToX === 'function' ? rendered.beatToX : null;
    score.barX = Array.isArray(rendered?.barX) ? rendered.barX : [];
    score.playhead = playhead;
    score.notes = notes;
    score.active = [];
    score.cursor = 0;
    score.lastPos = null;
    score.holdUntil = 0;
    els.scoreView.scrollLeft = 0;
    score.autoScrollLeft = els.scoreView.scrollLeft;
  }

  /** 拍位置 → 楽譜上の x。beatToX が無い版でも小節線から補間して出す */
  function beatX(beat) {
    if (score.beatToX) {
      const x = Number(score.beatToX(beat));
      if (Number.isFinite(x)) return x;
    }
    const bars = score.barX;
    if (bars.length >= 2) {
      const inBars = beat / 4;
      const i = Math.max(0, Math.min(bars.length - 2, Math.floor(inBars)));
      const a = Number(bars[i]);
      const b = Number(bars[i + 1]);
      if (Number.isFinite(a) && Number.isFinite(b)) return a + (b - a) * (inBars - i);
    }
    return null;
  }

  function updateHighlight(pos) {
    const notes = score.notes;
    if (score.lastPos === null || pos < score.lastPos) {
      // 曲の切り替わりやスキップで位置が戻ったとき。索引を頭からやり直す。
      // 曲に一度きりなので、毎フレームの負担にはならない。
      clearHighlight();
      score.cursor = 0;
    }
    let i = score.cursor;
    while (i < notes.length && notes[i].beat <= pos) {
      const note = notes[i];
      // 追いついた時点ですでに鳴り終わっている音符は、付けずに読み飛ばす
      if (note.end > pos) {
        note.el.classList.add('is-playing');
        score.active.push(note);
      }
      i += 1;
    }
    score.cursor = i;

    const active = score.active;
    let kept = 0;
    for (let r = 0; r < active.length; r += 1) {
      const note = active[r];
      if (note.end > pos) active[kept++] = note;
      else note.el.classList.remove('is-playing');
    }
    active.length = kept;
  }

  function followScroll(x) {
    const view = els.scoreView;
    if (!view) return;
    if (nowMs() < score.holdUntil) return; // 手で動かした直後は追いかけない
    const width = view.clientWidth;
    const max = view.scrollWidth - width;
    if (!(max > 0)) return;
    const target = Math.max(0, Math.min(max, x - width * FOLLOW_RATIO));
    const current = view.scrollLeft;
    const diff = target - current;
    if (Math.abs(diff) < 0.5) return;
    // reduced motion のときは補間せず、その場に飛ばす
    view.scrollLeft = reducedMotion?.matches ? target : current + diff * SCROLL_EASE;
    score.autoScrollLeft = view.scrollLeft;
  }

  /** 何も鳴っていないときの後片付け。すでに片付いていれば何もしない */
  function idleScore() {
    if (score.lastPos === null) return;
    clearHighlight();
    score.cursor = 0;
    score.lastPos = null;
    if (score.playhead) score.playhead.hidden = true;
  }

  function frame() {
    if (raf) raf(frame);
    // 隠しているあいだは何も計算しない
    if (!score.visible || !els.scoreView) return;
    const pos = player?.getPositionBeats?.() ?? null;
    if (pos === null) {
      idleScore();
      return;
    }
    updateHighlight(pos);
    const x = beatX(pos);
    if (score.playhead && x !== null) {
      score.playhead.hidden = false;
      score.playhead.style.transform = `translateX(${x}px)`;
      followScroll(x);
    }
    score.lastPos = pos;
  }

  function setScoreVisible(visible) {
    score.visible = visible;
    if (els.scoreView) els.scoreView.hidden = !visible;
    if (els.scoreToggle) {
      els.scoreToggle.textContent = visible ? '楽譜を隠す' : '楽譜を出す';
      els.scoreToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
    }
    // 隠すあいだに付けっぱなしにしない。出したら次のフレームで付け直す。
    if (!visible) idleScore();
  }

  if (els.scoreToggle) {
    els.scoreToggle.addEventListener('click', () => setScoreVisible(!score.visible));
  }

  if (els.scoreView) {
    const holdFollow = () => {
      score.holdUntil = nowMs() + USER_SCROLL_HOLD_MS;
    };
    els.scoreView.addEventListener('wheel', holdFollow, { passive: true });
    els.scoreView.addEventListener('touchstart', holdFollow, { passive: true });
    els.scoreView.addEventListener('touchmove', holdFollow, { passive: true });
    els.scoreView.addEventListener('keydown', holdFollow);
    els.scoreView.addEventListener('scroll', () => {
      // 自分で入れた値と違っていれば、動かしたのは人間。つまみのドラッグもここで拾う。
      if (Math.abs(els.scoreView.scrollLeft - score.autoScrollLeft) > SCROLL_EPSILON) {
        holdFollow();
      }
    }, { passive: true });
    if (raf) raf(frame);
  }

  // ---- 楽譜の書き出し --------------------------------------------------
  const exportButtons = [els.exportMusicXml, els.exportMidi].filter(Boolean);

  /** 書き出せる曲。まだ一度も再生していなければ null */
  function exportableSong() {
    return player?.getCurrentSong?.() ?? null;
  }

  // 曲が無いあいだは押せないようにしておく。止めたあとは、楽譜が画面に
  // 残っているのだから、そのまま保存できたほうが自然なので押せるままにする。
  function updateExportButtons() {
    const ready = Boolean(exportableSong());
    for (const button of exportButtons) button.disabled = !ready;
  }

  /** @param {'musicxml' | 'mid'} ext */
  function exportSong(ext) {
    const song = exportableSong();
    if (!song) {
      setStatus('先に再生してください', 2500);
      return;
    }
    let filename = `piano.${ext}`;
    try {
      const suggested = String(suggestFilename(song, ext) ?? '').trim();
      if (suggested) filename = suggested;
      if (ext === 'mid') downloadFile(toMidi(song), filename, MIDI_MIME);
      else downloadFile(String(toMusicXML(song)), filename, MUSICXML_MIME);
    } catch (err) {
      // 握りつぶさない。失敗したことと理由を必ず画面に出す。
      console.error('保存できませんでした', err);
      setStatus(`保存できませんでした: ${err.message}`);
      return;
    }
    setStatus(`${filename} を保存しました`, 2000);
  }

  if (els.exportMusicXml) {
    els.exportMusicXml.addEventListener('click', () => exportSong('musicxml'));
  }
  if (els.exportMidi) {
    els.exportMidi.addEventListener('click', () => exportSong('mid'));
  }
  updateExportButtons();

  // ---- 曲が切り替わったとき -------------------------------------------
  function handleSongChange(song) {
    if (!song) return;
    buildScore(song);
    updateExportButtons();
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
