/**
 * 再生スケジューラと曲の連結。
 *
 * setTimeout で1音ずつ鳴らすと数十msの誤差が乗って演奏がヨレる。
 * ここでは「短い周期で回して、少し先までのイベントを絶対時刻で予約する」
 * 先読み方式を採る。タイマーが遅れても、予約済みの音は Web Audio 側の
 * 正確な時計で鳴るのでリズムは崩れない。
 *
 * 曲が終わったら余韻（gapSeconds）を置いて新しいシードで次の曲を作る。
 * 止めるまで無限に続く。曲数の上限は持たない。
 *
 * 聴いた曲はシードだけ履歴に積む（曲そのものはシードから完全に再構築できる）。
 * 前へ戻ると履歴を遡り、そこから先へ進むときは「もう一度聴いた曲」を順に辿る。
 * プレイリストと同じ挙動で、履歴の末尾まで来たときだけ新しい曲が生まれる。
 */
import { composeSong as composeClaudeSong } from './compose.js';
import { composeVocalSong } from './vocalCompose.js';
import { composeVocalSongV2 } from './vocalComposeV2.js';
import { composeVocalSongV3 } from './vocalComposeV3.js';
import { composeVocalSongV4 } from './vocalComposeV4.js';
import { composeVocalSongV5 } from './vocalComposeV5.js';
import { composeVocalSongV6 } from './vocalComposeV6.js';
import { buildPerformance } from './perform.js';

/** スケジューラの起動間隔。短いほど正確だが、25ms あれば先読み幅で十分吸収できる */
const TICK_MS = 25;

/** 各ティックで予約する未来の幅。TICK_MS より十分大きく取る */
const HORIZON_SEC = 0.25;

/**
 * 曲の頭に置く助走。作曲にかかった時間ぶん過去の時刻を予約してしまわないための余白。
 * 予約は組み立て直後の同じティック内で始まるので、これだけあれば足りる。
 */
const LEAD_IN_SEC = 0.15;

/** 1ティックで曲をまたぐ回数の上限。異常時に無限ループへ落ちないための保険 */
const MAX_ADVANCE_PER_TICK = 4;

const SEED_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SEED_LENGTH = 6;

/** 曲間の余韻の既定値と範囲（settings.js の gapSeconds に合わせる） */
const GAP_DEFAULT = 3.5;
const GAP_MIN = 0;
const GAP_MAX = 10;

/** 履歴に残す曲数。シード6文字なので上限は事実上メモリではなく「戻れる距離」の設計値 */
const HISTORY_MAX = 100;

/**
 * 手で曲を切り替えたときに置く無音の長さ（秒）。
 *
 * 曲の終わりで勝手に次へ行くときは、前の曲の余韻に重ねたほうが途切れずに聴こえる。
 * だが「次へ」「前へ」を押したときは違う。押した瞬間まで鳴っていた音が
 * 減衰しきるのに数秒かかり、リバーブの尾はさらに残るので、そこへ次の曲を
 * 重ねると2曲が混ざる。いったん全部消してから始めるほうが、切り替えたことが
 * はっきり伝わる。
 */
const MANUAL_GAP_SEC = 1;

/**
 * 曲コードの検証（`/^[0-9a-z]+$/i`）を通る 6 文字のシードを作る。
 * 毎回違う曲を出すのが目的なので、ここは Math.random を使ってよい唯一の場所。
 * @returns {string}
 */
export function randomSeed() {
  let out = '';
  for (let i = 0; i < SEED_LENGTH; i += 1) {
    out += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
  }
  return out;
}

/** 外から渡されたシードを [0-9a-z] だけに正規化する。空になったら null */
function normalizeSeed(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).toLowerCase().replace(/[^0-9a-z]/g, '');
  return cleaned ? cleaned.slice(0, 32) : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 無限に曲を生成し続けるプレイヤーを作る。
 *
 * @param {BaseAudioContext} audioCtx
 * @param {{
 *   playPiano: (time: number, midi: number, durSec: number, vel: number, layer: string) => void,
 *   playPad: (time: number, midis: number[], durSec: number, vel: number) => void,
 *   applySettings: (next: object) => void,
 * }} engine synth.js の createEngine が返すもの
 * @param {object} data melodies / progressions を束ねたデータ（composeSong にそのまま渡す）
 * @param {() => object} getSettings 呼ぶたび最新の設定を返す関数
 */
export function createPlayer(audioCtx, engine, data, getSettings) {
  if (!audioCtx) throw new Error('createPlayer: audioCtx が必要です');
  if (!engine) throw new Error('createPlayer: engine が必要です');

  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let playing = false;

  /** @type {object | null} 再生中の曲 */
  let song = null;
  /** @type {Array<object>} 現在の曲の演奏イベント（at 昇順） */
  let events = [];
  /** 現在の曲の長さ（秒） */
  let durationSec = 0;
  /** 現在の曲の絶対開始時刻（audioCtx.currentTime 基準） */
  let songStartAt = 0;
  /**
   * 次に予約すべきイベントの位置。予約したぶんだけ前へ進め、決して戻さない。
   * これが二重予約を防ぐ唯一の仕掛けなので、曲を差し替えるときは必ず 0 に戻す。
   */
  let cursor = 0;

  /** start() の世代番号。await 中に別の start/stop が入った場合に古い呼び出しを捨てる */
  let generation = 0;

  /** @type {string[]} 聴いた順のシード。曲はシードから完全に再構築できる */
  const history = [];
  /** history の中で今どこを鳴らしているか。まだ何も鳴らしていなければ -1 */
  let index = -1;

  /** @type {Set<(song: object) => void>} */
  const songListeners = new Set();

  /** 設定は一切キャッシュしない。必要になった時点で毎回取り直す */
  function currentSettings() {
    if (typeof getSettings !== 'function') return {};
    return getSettings() ?? {};
  }

  /** 曲間の余韻（秒）。設定が壊れていても既定値へ落として再生は続ける */
  function gapSeconds() {
    const raw = Number(currentSettings().gapSeconds);
    return Number.isFinite(raw) ? clamp(raw, GAP_MIN, GAP_MAX) : GAP_DEFAULT;
  }

  function emitSongChange(next) {
    for (const cb of songListeners) {
      try {
        cb(next);
      } catch (err) {
        // 表示側の失敗で再生を止めない
        console.error('onSongChange のコールバックが失敗しました', err);
      }
    }
  }

  /**
   * 新しい曲を組み立てて現在の曲として据える。
   * 開始時刻は「組み立て終わったあとの時計」で決める。作曲に時間がかかっても
   * 過去の時刻を予約せずに済む。
   */
  function beginSong(seed, leadSec = LEAD_IN_SEC) {
    const settings = currentSettings();
    // 楽器は音階スタイルに紐づいていて、スタイルは「次の曲から」反映される設定。
    // 曲の切り替わりがその境目なので、ここで音源へ渡し直す。
    engine.applySettings(settings);
    const nextSong = settings.composerEngine === 'claude'
      ? composeClaudeSong(seed, data, settings)
      : (settings.composerEngine === 'codex6'
        ? composeVocalSongV6(seed, data, settings, composeClaudeSong)
        : settings.composerEngine === 'codex5'
        ? composeVocalSongV5(seed, data, settings, composeClaudeSong)
        : settings.composerEngine === 'codex4'
        ? composeVocalSongV4(seed, data, settings, composeClaudeSong)
        : settings.composerEngine === 'codex3'
        ? composeVocalSongV3(seed, data, settings, composeClaudeSong)
        : settings.composerEngine === 'codex2'
        ? composeVocalSongV2(seed, data, settings, composeClaudeSong)
        : composeVocalSong(seed, data, settings, composeClaudeSong));
    const performance = buildPerformance(nextSong, settings);

    song = nextSong;
    events = performance.events ?? [];
    durationSec = Number(performance.durationSec) || 0;
    cursor = 0;
    songStartAt = audioCtx.currentTime + leadSec;

    emitSongChange(song);
  }

  /** 履歴の末尾に積んで、そこを現在地にする。上限を超えたぶんは古いほうから捨てる。 */
  function pushHistory(seed) {
    history.push(seed);
    if (history.length > HISTORY_MAX) history.shift();
    index = history.length - 1;
  }

  /**
   * 鳴っている音を全部消し、無音をはさんでから曲を差し替える。
   * 手で切り替えたときだけ通る道。
   */
  function cutTo(seed) {
    engine.silence?.(MANUAL_GAP_SEC);
    beginSong(seed, MANUAL_GAP_SEC);
    scheduleDue();
  }

  /**
   * 次の曲へ。履歴の途中にいるなら、次に聴いたその曲へ進む（プレイリストと同じ）。
   * 末尾にいるときだけ新しい曲が生まれる。
   *
   * @param {boolean} manual 手で押したか。押されたときだけ無音をはさむ
   */
  function advance(manual) {
    let seed;
    if (index >= 0 && index < history.length - 1) {
      index += 1;
      seed = history[index];
    } else {
      seed = randomSeed();
      pushHistory(seed);
    }
    if (manual) cutTo(seed);
    else beginSong(seed);
  }

  /**
   * いま予約すべきイベント（horizon までに鳴るもの）を絶対時刻で engine へ渡す。
   * 予約済みのぶんは cursor から先にしか進まないので二重予約は起きない。
   */
  function scheduleDue() {
    const horizon = audioCtx.currentTime + HORIZON_SEC;
    while (cursor < events.length) {
      const ev = events[cursor];
      // イベントの at は曲頭からの相対秒。絶対時刻に直してから渡す。
      const at = songStartAt + ev.at;
      if (at > horizon) break;
      cursor += 1;
      if (ev.kind === 'pad') {
        engine.playPad(at, ev.midis, ev.dur, ev.vel);
      } else {
        engine.playPiano(at, ev.midi, ev.dur, ev.vel, ev.layer);
      }
    }
  }

  /** 全イベントを予約し終え、余韻ぶんの時間も過ぎたか */
  function readyForNextSong() {
    if (cursor < events.length) return false;
    return audioCtx.currentTime > songStartAt + durationSec + gapSeconds();
  }

  function tick() {
    try {
      // 曲の終わりをまたぐティックでは、次の曲の頭ぶんもこの場で予約する。
      // 予約が1ティック遅れると曲頭が詰まって聴こえるため。
      for (let i = 0; i < MAX_ADVANCE_PER_TICK; i += 1) {
        scheduleDue();
        if (!readyForNextSong()) return;
        // 曲の終わりで勝手に進むときは、リバーブの尾を残したまま次へ移る。
        advance(false);
      }
    } catch (err) {
      // 25ms ごとに同じ例外を吐き続けても直らないので、いったん止めて表に出す
      console.error('再生スケジューラが停止しました', err);
      stopTimer();
      playing = false;
    }
  }

  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  /** 今の曲の長さ（拍）。totalBeats が無い曲でも小節数から出す */
  function songTotalBeats() {
    const total = Number(song?.totalBeats);
    if (Number.isFinite(total) && total > 0) return total;
    const bars = Number(song?.bars);
    return Number.isFinite(bars) && bars > 0 ? bars * 4 : 0;
  }

  return {
    /**
     * 再生を開始する。seed を省略すると新しいランダムな曲になる。
     * すでに再生中でも、その場で新しい曲に差し替える。
     * @param {string} [seed]
     */
    async start(seed) {
      const token = (generation += 1);

      // 自動再生制限。最初のクリックで resume しないと一切音が出ない。
      if (audioCtx.state === 'suspended') {
        try {
          await audioCtx.resume();
        } catch (err) {
          console.warn('AudioContext を再開できませんでした', err);
        }
      }
      // await の間に stop() や別の start() が入っていたら、この呼び出しは無効
      if (token !== generation) return;

      const wasPlaying = playing;
      stopTimer();
      playing = true;
      const wanted = normalizeSeed(seed);
      // 同じ曲を作り直すとき（設定を変えて「今すぐ作り直す」）は履歴を伸ばさない。
      // 押すたびに履歴が積み上がると、戻るボタンが同じ曲を何度も辿ることになる。
      let next;
      if (wanted !== null && history[index] === wanted) next = wanted;
      else {
        next = wanted ?? randomSeed();
        pushHistory(next);
      }
      // すでに鳴っている最中の差し替えなら、手で切り替えたときと同じ扱いにする。
      // 止まっているところから押したときは、待たせずにすぐ始める。
      if (wasPlaying) cutTo(next);
      else {
        beginSong(next);
        scheduleDue();
      }
      timer = setInterval(tick, TICK_MS);
    },

    /** 停止する。予約済みの音は止めず、自然に減衰させる */
    stop() {
      generation += 1;
      stopTimer();
      playing = false;
    },

    /**
     * 次の曲へ。履歴の途中にいるなら、次に聴いたその曲へ進む。
     * 末尾にいるときだけ新しい曲が生まれる。予約済みの音はそのまま鳴り終わる。
     */
    next() {
      if (!playing) return;
      advance(true);
    },

    /**
     * 一つ前に聴いた曲へ戻る。履歴の先頭にいるときは何もしない。
     * @returns {boolean} 実際に戻れたか
     */
    prev() {
      if (!playing || index <= 0) return false;
      index -= 1;
      cutTo(history[index]);
      return true;
    },

    /** 戻れる曲があるか。ボタンの活殺に使う */
    hasPrev() {
      return playing && index > 0;
    },

    isPlaying() {
      return playing;
    },

    getCurrentSong() {
      return song;
    },

    /**
     * 今鳴っている曲の、曲頭からの拍位置。楽譜の追従表示のために使う。
     *
     * 「今なにも指していない」状態は全部 null にまとめる。停止中、助走ぶんで
     * まだ一音も鳴っていない間、曲の終端を過ぎて次の曲を待っている余韻の間。
     * 呼ぶ側は null をそのまま「プレイヘッドを消す」と読めばよい。
     *
     * song と songStartAt は beginSong の中で同じ同期処理として差し替わるので、
     * 曲の切り替わりに割り込んで古い開始時刻と新しい曲を混ぜて読むことはない。
     *
     * @returns {number | null}
     */
    getPositionBeats() {
      if (!playing || !song) return null;
      const tempo = Number(song.tempo);
      if (!Number.isFinite(tempo) || tempo <= 0) return null;
      const beats = (audioCtx.currentTime - songStartAt) * (tempo / 60);
      // LEAD_IN_SEC ぶんは負になる。曲はまだ始まっていない。
      if (!Number.isFinite(beats) || beats < 0) return null;
      const total = songTotalBeats();
      if (total > 0 && beats > total) return null;
      return beats;
    },

    /**
     * 曲が切り替わるたびに呼ばれる。登録解除用の関数を返す。
     * @param {(song: object) => void} cb
     */
    onSongChange(cb) {
      if (typeof cb !== 'function') return () => {};
      songListeners.add(cb);
      return () => songListeners.delete(cb);
    },

    /** サウンド系の設定を即座に反映する（engine へ委譲するだけ） */
    applySettings(settings) {
      engine.applySettings(settings);
    },
  };
}
