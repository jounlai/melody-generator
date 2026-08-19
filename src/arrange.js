//
// 曲を「どう鳴らすか」を決める層。compose.js が決めるのは音高（どの音を鳴らすか）で、
// ここが決めるのは時間（いつ鳴らすか）。この境界を跨がないこと。
//
// 初版はここが無く、伴奏は全曲・全小節が同じ8分アルペジオだった。実測すると
// 32小節の曲でリズムの変化が1つも無く、旋律がどれだけ良くても「同じことを
// 繰り返している」としか聴こえない。70〜80年代のバラードは、Aメロを薄く置いて
// サビで一気に厚くする。その落差そのものが感情を作る。
//
// 乱数は composeSong の rng とは別の列（seed + ':arr'）を使う。編曲を足し引きしても
// 旋律と和声が動かないので、同じ曲コードから同じ曲が出続ける。
const BEATS_PER_BAR = 4;

export { BEATS_PER_BAR };

/**
 * 分散和音の何番目の構成音を鳴らすか。上行して下行する三角波で巡回する。
 * 構成音3つなら 0,1,2,1,0,1,2,1、4つなら 0,1,2,3,2,1,0,1。
 * 単純な i % v の繰り返しは折り返しが無く、機械的に聴こえる。
 */
export function arpeggioIndex(i, voices) {
  if (voices <= 1) return 0;
  const period = 2 * (voices - 1);
  const t = ((i % period) + period) % period;
  return t < voices ? t : period - t;
}

/**
 * 伴奏型を実際の音に展開する。
 *
 * voicing は placeUnder が返した昇順の実音で、長さは2〜4で変動する。だから型は
 * 添字ではなく役割（low / upper / all / arp）で書く。添字で書くと、和音を天井の
 * 下へ収めるために上の音を省いた小節で型が壊れる。
 *
 * @param {Array<{beat:number, voice:'low'|'upper'|'all'|'arp', dur:number}>} steps
 * @param {number[]} voicing 昇順の実音
 * @param {number} barBeat その小節の先頭の拍（曲頭からの通し）
 * @param {number} vel
 */
export function expandAccomp(steps, voicing, barBeat, vel) {
  const out = [];
  if (!Array.isArray(voicing) || voicing.length === 0) return out;
  let arp = 0;
  for (const step of steps) {
    // 小節線で切る。隣と重ねてペダルのように繋ぐための長さでも、小節をはみ出すと
    // 和音が変わったところへ古い和音が残る（強拍の半音衝突の27%がここから出ていた）。
    const dur = Math.min(step.dur, BEATS_PER_BAR - step.beat);
    if (!(dur > 0)) continue;
    const beat = barBeat + step.beat;
    if (step.voice === 'arp') {
      out.push({ midi: voicing[arpeggioIndex(arp, voicing.length)], beat, dur, vel });
      arp += 1;
      continue;
    }
    if (step.voice === 'low') {
      out.push({ midi: voicing[0], beat, dur, vel });
      continue;
    }
    const midis = step.voice === 'all' ? voicing.slice() : voicing.slice(1);
    if (midis.length === 0) continue;
    // midi は単音しか読まない再生系のための代表音。鳴らしたい全部は midis に入れる。
    out.push({ midi: midis[0], midis, beat, dur, vel });
  }
  return out;
}

/** 5度。和音の音でなければオクターブ上へ逃がす（半音で押し込むと別の和音になる）。 */
function fifthOf(bassNote, pcs, ceiling) {
  const fifth = bassNote + 7;
  const pc = ((fifth % 12) + 12) % 12;
  if (fifth <= ceiling && Array.isArray(pcs) && pcs.includes(pc)) return fifth;
  return octaveOf(bassNote, ceiling);
}

function octaveOf(bassNote, ceiling) {
  const up = bassNote + 12;
  return up <= ceiling ? up : bassNote;
}

/**
 * ベース型を実際の音に展開する。
 *
 * @param {Array<{beat:number, kind:'root'|'fifth'|'octave'|'next', dur:number}>} steps
 * @param {number} barBeat その小節の先頭の拍
 * @param {number} bassNote その小節のベース音
 * @param {number|null} nextBassNote 次の小節のベース音。無ければ null
 * @param {number[]} pcs その小節の和音の実音ピッチクラス
 * @param {number} vel
 * @param {number} ceiling ベースが越えてはいけない高さ。伴奏の最低音を渡す。
 *   土台（ベース < 伴奏）が入れ替わると和音が濁る。定数の音域を別に持つより、
 *   その小節で実際に伴奏がいる高さを見るほうが正しく、定義も1か所で済む。
 */
export function expandBass(steps, barBeat, bassNote, nextBassNote, pcs, vel, ceiling) {
  const out = [];
  for (const step of steps) {
    const dur = Math.min(step.dur, BEATS_PER_BAR - step.beat);
    if (!(dur > 0)) continue;
    let midi = bassNote;
    if (step.kind === 'fifth') midi = fifthOf(bassNote, pcs, ceiling);
    else if (step.kind === 'octave') midi = octaveOf(bassNote, ceiling);
    else if (step.kind === 'next') {
      // 次の小節の根音の先取り（食い）。曲の最終小節では鳴らさない。
      if (nextBassNote === null || nextBassNote === undefined) continue;
      midi = nextBassNote;
    }
    out.push({ midi, beat: barBeat + step.beat, dur, vel });
  }
  return out;
}
