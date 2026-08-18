/**
 * iOS の音声セッション対策と、ロック画面・通知領域の再生操作。
 *
 * ---------------------------------------------------------------------------
 * なぜ必要か
 *
 * iOS の Safari は、音の出どころによって「音声セッションの種類」を変える。
 *
 *   Web Audio API だけで鳴らしている  → 環境音（ambient）扱い。
 *                                     本体側面の消音スイッチで黙る。
 *   <audio> / <video> を再生している  → 再生（playback）扱い。
 *                                     消音スイッチを無視して鳴る。
 *
 * この曲生成器はオシレータだけで音を作っていて <audio> を1つも使わないため、
 * 前者に該当する。iPhone の消音スイッチが入っていると、どれだけ音量を上げても
 * 一切聴こえない。ユーザーからは「壊れている」ようにしか見えない。
 *
 * 対策は、無音の音声を <audio> でループ再生し、セッションを後者へ移すこと。
 * 鳴らすのは本当に何も入っていない波形なので、音は1ミリも変わらない。
 * 変わるのは「iOS がこのページをどう分類するか」だけである。
 *
 * !!! muted にしてはいけない !!!
 * 消音した要素は再生とみなされず、セッションを取れない。無音の波形を
 * 音量1で鳴らす、という一見おかしな形にしているのはそのため。
 *
 * ---------------------------------------------------------------------------
 * 効かない場合もある
 *
 * この挙動は iOS のバージョンで変わってきた歴史があり、将来また変わりうる。
 * だから音の本流（AudioContext → destination）はこれまで通り一切触らない。
 * ここが失敗しても、消音スイッチが切れている端末では今まで通り鳴る。
 * 足すだけで、壊さない。
 */

/** 無音の WAV を作る。長さは1秒あれば十分（loop で回し続ける）。 */
const SILENT_SECONDS = 1;
const SILENT_RATE = 8000;

function silentWavBlob() {
  const samples = SILENT_RATE * SILENT_SECONDS;
  const bytes = new ArrayBuffer(44 + samples * 2);
  const dv = new DataView(bytes);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) dv.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);   // fmt チャンクの長さ
  dv.setUint16(20, 1, true);    // PCM
  dv.setUint16(22, 1, true);    // モノラル
  dv.setUint32(24, SILENT_RATE, true);
  dv.setUint32(28, SILENT_RATE * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ascii(36, 'data');
  dv.setUint32(40, samples * 2, true);
  // 中身は全部 0。ArrayBuffer は 0 で初期化されるので何も書かない。
  return new Blob([bytes], { type: 'audio/wav' });
}

/**
 * 音声セッションの保持役を作る。
 *
 * @returns {{ start: () => void, stop: () => void, dispose: () => void }}
 *   start はユーザー操作（クリック）の中から呼ぶこと。iOS はそれ以外の
 *   タイミングでの再生を拒否する。
 */
export function createAudioSession() {
  /** @type {HTMLAudioElement | null} */
  let el = null;
  let url = null;

  function ensure() {
    if (el) return el;
    try {
      url = URL.createObjectURL(silentWavBlob());
      el = new Audio();
      el.src = url;
      el.loop = true;
      el.volume = 1; // muted にするとセッションを取れない（上の説明のとおり）
      el.preload = 'auto';
      // iOS で全画面に乗っ取られないための指定。audio 要素でも付けておく。
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      // 文書に入れる。切り離したままでも鳴る実装は多いが、iOS には
      // 文書に無い要素の再生を渋る版があった。見えない大きさで置いておく。
      el.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
      document.body.appendChild(el);
    } catch (err) {
      console.warn('無音の音声を用意できませんでした', err);
      el = null;
    }
    return el;
  }

  return {
    start() {
      const node = ensure();
      if (!node) return;
      const played = node.play();
      // 拒否されても本流の音には関係しないので、警告だけ出して続行する。
      if (played && typeof played.catch === 'function') {
        played.catch((err) => console.warn('無音の音声を再生できませんでした', err));
      }
    },

    stop() {
      if (!el) return;
      try {
        el.pause();
      } catch (err) {
        console.warn('無音の音声を止められませんでした', err);
      }
    },

    dispose() {
      this.stop();
      if (el?.parentNode) el.parentNode.removeChild(el);
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch (_) { /* 解放済みは無視 */ }
        url = null;
      }
      el = null;
    },
  };
}

/**
 * ロック画面・通知領域・ヘッドセットのボタンから操作できるようにする。
 *
 * 消音スイッチ対策とは別の話だが、出どころは同じ「音声セッション」で、
 * セッションを持っているあいだしか出せない。同じ場所で面倒を見る。
 *
 * @param {{ play: () => void, pause: () => void, prev: () => void, next: () => void }} actions
 */
export function bindMediaKeys(actions) {
  const ms = globalThis.navigator?.mediaSession;
  if (!ms || typeof ms.setActionHandler !== 'function') return;
  const bind = (name, fn) => {
    try {
      ms.setActionHandler(name, fn);
    } catch (_) {
      // 端末が対応していない操作は黙って諦める（stop など）
    }
  };
  bind('play', actions.play);
  bind('pause', actions.pause);
  bind('previoustrack', actions.prev);
  bind('nexttrack', actions.next);
}

/** ロック画面に出す曲名。曲が変わるたびに呼ぶ。 */
export function setNowPlaying(title, subtitle) {
  const ms = globalThis.navigator?.mediaSession;
  if (!ms) return;
  try {
    if (typeof globalThis.MediaMetadata === 'function') {
      ms.metadata = new globalThis.MediaMetadata({
        title: String(title ?? ''),
        artist: String(subtitle ?? ''),
        album: '無限ヒーリングピアノ',
      });
    }
  } catch (err) {
    console.warn('再生中の曲名を渡せませんでした', err);
  }
}

/** ロック画面のボタンの見た目（再生中か停止中か）を合わせる。 */
export function setPlaybackState(isPlaying) {
  const ms = globalThis.navigator?.mediaSession;
  if (!ms) return;
  try {
    ms.playbackState = isPlaying ? 'playing' : 'paused';
  } catch (_) { /* 対応していない端末は無視 */ }
}
