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
import { pick } from './rng.js';

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
      // 先取りも土台の一部。伴奏より上へ出ると、半拍とはいえ層が入れ替わる。
      // 音名は変えずオクターブだけ下げる（この小節のベースの1オクターブ下が限界）。
      let ant = nextBassNote;
      while (ant > ceiling && ant - 12 >= bassNote - 12) ant -= 12;
      midi = ant;
    }
    out.push({ midi, beat: barBeat + step.beat, dur, vel });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 伴奏型
//
// vel は「その型で同時に鳴る音の多さ」に合わせて決める。初版は8分が8個という
// 前提の 0.3 一本だったので、和音を8分で押す pulse8 にそのまま使うと
// 同時発音数が3倍になって旋律が埋もれる。厚い型ほど1音を弱くする。
// ---------------------------------------------------------------------------
const ARP8 = Array.from({ length: 8 }, (_, i) => ({ beat: i * 0.5, voice: 'arp', dur: 0.75 }));
const PULSE8 = Array.from({ length: 8 }, (_, i) => ({ beat: i * 0.5, voice: 'all', dur: 0.5 }));

export const ACCOMP_PATTERNS = {
  // いちばん薄い。Aメロの入りで、旋律だけを聴かせる
  sustain: { vel: 0.22, steps: [{ beat: 0, voice: 'all', dur: 4 }] },
  // broken の静かな版。低音を2拍伸ばし、その上に上声を落とす
  brokenHalf: {
    vel: 0.30,
    steps: [
      { beat: 0, voice: 'low', dur: 2 }, { beat: 1, voice: 'upper', dur: 1 },
      { beat: 2, voice: 'low', dur: 2 }, { beat: 3, voice: 'upper', dur: 1 },
    ],
  },
  // 低音→上声→低音→上声。歌謡曲バラードの左手そのもの
  broken: {
    vel: 0.32,
    steps: [
      { beat: 0, voice: 'low', dur: 1 }, { beat: 1, voice: 'upper', dur: 1 },
      { beat: 2, voice: 'low', dur: 1 }, { beat: 3, voice: 'upper', dur: 1 },
    ],
  },
  // 初版の型。左手を途切れさせずに流す
  arp8: { vel: 0.30, steps: ARP8 },
  // 8ビートの食い。拍を食って前へ押す
  syncope: {
    vel: 0.30,
    steps: [
      { beat: 0, voice: 'low', dur: 0.5 }, { beat: 0.5, voice: 'upper', dur: 1 },
      { beat: 1.5, voice: 'upper', dur: 1 }, { beat: 2.5, voice: 'upper', dur: 0.5 },
      { beat: 3, voice: 'low', dur: 0.5 }, { beat: 3.5, voice: 'upper', dur: 0.5 },
    ],
  },
  // サビ。和音を8分で押す。いちばん厚い
  pulse8: { vel: 0.22, steps: PULSE8 },
  // 低音を2拍伸ばし、上声も2拍で受ける。sustain の次に薄い
  halfBroken: {
    vel: 0.30,
    steps: [{ beat: 0, voice: 'low', dur: 2 }, { beat: 2, voice: 'upper', dur: 2 }],
  },
  // 裏拍に和音を置く。表が空くぶん前へ引っ張られる
  offbeat: {
    vel: 0.28,
    steps: [
      { beat: 0, voice: 'low', dur: 0.5 }, { beat: 0.5, voice: 'upper', dur: 1 },
      { beat: 1.5, voice: 'upper', dur: 0.5 }, { beat: 2, voice: 'low', dur: 0.5 },
      { beat: 2.5, voice: 'upper', dur: 1 }, { beat: 3.5, voice: 'upper', dur: 0.5 },
    ],
  },
  // 付点。歌謡曲の揺れを2分割で作る
  dotted: {
    vel: 0.31,
    steps: [
      { beat: 0, voice: 'low', dur: 1.5 }, { beat: 1.5, voice: 'upper', dur: 0.5 },
      { beat: 2, voice: 'low', dur: 1 }, { beat: 3, voice: 'upper', dur: 1 },
    ],
  },
  // 4分の和音刻み。pulse8 より軽く、サビの入口に使える
  pulse4: {
    vel: 0.26,
    steps: [0, 1, 2, 3].map((beat) => ({ beat, voice: 'all', dur: 1 })),
  },
};

// セクションごとの伴奏型の候補。組は [前半, 後半]。
// A メロは薄く、サビで一気に厚く、最後は収める——70〜80年代バラードの定石。
// 折り返し（セクションの半分）で型が1段上がる。A'' だけは逆に下げて着地させる。
export const ACCOMP_PLAN = [
  // A 提示。薄く入る
  [['sustain', 'halfBroken'], ['sustain', 'brokenHalf'], ['sustain', 'broken'],
    ['halfBroken', 'brokenHalf'], ['halfBroken', 'broken'], ['sustain', 'dotted']],
  // A' 高まり
  [['brokenHalf', 'broken'], ['broken', 'arp8'], ['dotted', 'arp8'],
    ['brokenHalf', 'dotted'], ['broken', 'offbeat'], ['halfBroken', 'broken']],
  // B サビ。いちばん厚い
  [['arp8', 'pulse8'], ['broken', 'syncope'], ['arp8', 'syncope'],
    ['offbeat', 'pulse8'], ['arp8', 'pulse4'], ['syncope', 'pulse8'], ['dotted', 'syncope']],
  // A'' 着地。ここだけ薄くなる方向
  [['broken', 'brokenHalf'], ['arp8', 'brokenHalf'], ['broken', 'halfBroken'],
    ['arp8', 'broken'], ['offbeat', 'broken'], ['pulse4', 'brokenHalf'], ['broken', 'sustain']],
];

// ---------------------------------------------------------------------------
// ベース型
//
// 初版は全小節が全音符だった。和音は変わるのに刻みが変わらないので、
// 土台がずっと止まって聴こえる。8ビートバラードの推進力は、ベースが
// 次の小節の根音を半拍先に鳴らす「食い」から出る。
// ---------------------------------------------------------------------------
export const BASS_PATTERNS = {
  whole: { vel: 0.5, steps: [{ beat: 0, kind: 'root', dur: 4 }] },
  rootFifth: {
    vel: 0.5,
    steps: [{ beat: 0, kind: 'root', dur: 2 }, { beat: 2, kind: 'fifth', dur: 2 }],
  },
  rootOctave: {
    vel: 0.5,
    steps: [{ beat: 0, kind: 'root', dur: 2 }, { beat: 2, kind: 'octave', dur: 2 }],
  },
  drive: { vel: 0.45, steps: [0, 1, 2, 3].map((beat) => ({ beat, kind: 'root', dur: 1 })) },
  // 拍3.5で次の小節の根音を先取りする。これが8ビートバラードの推進力の正体。
  anticipate: {
    vel: 0.5,
    steps: [{ beat: 0, kind: 'root', dur: 3.5 }, { beat: 3.5, kind: 'next', dur: 0.5 }],
  },
  // 根音を2回。踏み直すだけだが、全音符より土台が前へ出る
  pedal: {
    vel: 0.5,
    steps: [{ beat: 0, kind: 'root', dur: 2 }, { beat: 2, kind: 'root', dur: 2 }],
  },
  // 5度を裏拍へ。歌謡曲のベースの揺れ
  fifthOff: {
    vel: 0.5,
    steps: [{ beat: 0, kind: 'root', dur: 1.5 }, { beat: 1.5, kind: 'fifth', dur: 1.5 },
      { beat: 3, kind: 'root', dur: 1 }],
  },
  // オクターブで往復。サビの厚み
  octaveBounce: {
    vel: 0.48,
    steps: [{ beat: 0, kind: 'root', dur: 1 }, { beat: 1, kind: 'octave', dur: 1 },
      { beat: 2, kind: 'root', dur: 1 }, { beat: 3, kind: 'octave', dur: 1 }],
  },
  // 先取りに5度を挟む
  fifthAnticipate: {
    vel: 0.5,
    steps: [{ beat: 0, kind: 'root', dur: 2 }, { beat: 2, kind: 'fifth', dur: 1.5 },
      { beat: 3.5, kind: 'next', dur: 0.5 }],
  },
};

// セクションごとのベース型の候補。伴奏と同じく [前半, 後半]。
export const BASS_PLAN = [
  // A 提示
  [['whole', 'whole'], ['whole', 'rootFifth'], ['whole', 'pedal'],
    ['pedal', 'rootFifth'], ['whole', 'fifthOff'], ['pedal', 'pedal']],
  // A' 高まり
  [['rootFifth', 'rootFifth'], ['whole', 'rootOctave'], ['pedal', 'rootOctave'],
    ['rootFifth', 'fifthOff'], ['fifthOff', 'rootOctave'], ['rootFifth', 'octaveBounce']],
  // B サビ。先取りをここに集める
  [['rootOctave', 'anticipate'], ['rootFifth', 'drive'], ['anticipate', 'anticipate'],
    ['octaveBounce', 'anticipate'], ['rootOctave', 'fifthAnticipate'],
    ['drive', 'anticipate'], ['fifthOff', 'octaveBounce']],
  // A'' 着地
  [['whole', 'rootFifth'], ['whole', 'whole'], ['pedal', 'whole'],
    ['rootFifth', 'whole'], ['rootOctave', 'pedal'], ['fifthOff', 'whole'],
    ['pedal', 'rootFifth']],
];

const BASS_VEL = 0.5;
const PAD_VEL = 0.3;
const FINAL_ACCOMP_VEL = 0.4;
// 最終小節のパッドは小節をはみ出して余韻を作る。
const FINAL_PAD_DUR = 6;

/**
 * 曲を編曲する。音高は barInfo が既に決めてあるので、ここは時間だけを決める。
 *
 * rng は composeSong のものとは別の列（seed + ':arr'）。編曲を足し引きしても
 * 旋律と和声が動かない。
 *
 * @param {object} song bars を持つ曲
 * @param {Array<object>} barInfo 小節ごとの voicing / padVoicing / bassNote / pcs
 * @param {() => number} rng
 */
export function arrangeSong(song, barInfo, rng) {
  const bars = Number(song.bars);
  const barsPerSection = bars / 4;
  const half = Math.max(1, Math.floor(barsPerSection / 2));

  // 型の割り当て。乱数の消費はセクションごとに2回（伴奏の組・ベースの組で計8回）。
  const accompAt = [];
  const bassAt = [];
  const patterns = { accomp: [], bass: [] };
  for (let s = 0; s < 4; s++) {
    const [aFirst, aSecond] = pick(rng, ACCOMP_PLAN[s]);
    const [bFirst, bSecond] = pick(rng, BASS_PLAN[s]);
    const startBar = s * barsPerSection;
    patterns.accomp.push({ startBar, pattern: aFirst });
    patterns.accomp.push({ startBar: startBar + half, pattern: aSecond });
    patterns.bass.push({ startBar, pattern: bFirst });
    patterns.bass.push({ startBar: startBar + half, pattern: bSecond });
    for (let i = 0; i < barsPerSection; i++) {
      accompAt[startBar + i] = i < half ? aFirst : aSecond;
      bassAt[startBar + i] = i < half ? bFirst : bSecond;
    }
  }

  const accomp = [];
  const bass = [];
  const pad = [];
  for (let bar = 0; bar < bars; bar++) {
    const info = barInfo[bar];
    if (!info) continue;
    const barBeat = bar * BEATS_PER_BAR;
    const isFinal = bar === bars - 1;
    pad.push({
      midis: info.padVoicing.slice(),
      beat: barBeat,
      dur: isFinal ? FINAL_PAD_DUR : BEATS_PER_BAR,
      vel: PAD_VEL,
    });
    if (isFinal) {
      // 最終小節は終止。刻まず、先取りもしない。
      bass.push({ midi: info.bassNote, beat: barBeat, dur: BEATS_PER_BAR, vel: BASS_VEL });
      // 刻みをやめて和音を置く。刻み続けたまま終わると、耳は「まだ続く」と判断する。
      accomp.push({
        midi: info.voicing[0], midis: info.voicing.slice(),
        beat: barBeat, dur: BEATS_PER_BAR, vel: FINAL_ACCOMP_VEL,
      });
      continue;
    }
    const bp = BASS_PATTERNS[bassAt[bar]];
    const next = barInfo[bar + 1] ? barInfo[bar + 1].bassNote : null;
    // 上限はその小節の伴奏の最低音。土台（ベース < 伴奏）が入れ替わると濁る。
    for (const e of expandBass(bp.steps, barBeat, info.bassNote, next, info.pcs, bp.vel, info.voicing[0])) {
      bass.push(e);
    }
    const p = ACCOMP_PATTERNS[accompAt[bar]];
    for (const e of expandAccomp(p.steps, info.voicing, barBeat, p.vel)) accomp.push(e);
  }
  return { accomp, bass, pad, patterns };
}

// ---------------------------------------------------------------------------
// 食い（アンティシペーション）
//
// 小節の頭の音を半拍前へ出し、小節線をまたいで鳴らす。実測すると初版では
// 小節線をまたぐ音が 0.6%（85 / 14609）しか無かった。この時代のバラードの
// 推進力は、ほぼこの一点から出ている。
//
// 前の小節の和音との衝突は明示的には検査しない。この関数は声部配置より
// 前に走るので、パッドが唸る場合は withoutRub が削る。次の和音の和声音が
// 前の和音の上で鳴ること自体は潰さない——それが食いの響きそのもの。
//
// song.protectedBars は呼び出し側（compose.js）が「この小節は食わせるな」と
// 指定する小節番号の配列。転調の鍵が変わる小節や A'' の頭がそれに当たるが、
// この関数はその理由を知らない——いつ鳴らすか（声部配置の層）は、なぜそこか
// （曲の意味）を知らなくても成り立つ、という境界をここでも保つ。
// ---------------------------------------------------------------------------
const ANTICIPATE_SHIFT = 0.5;
// セクションごとの確率(%)。A / A' / B(サビ) / A''。
// サビに集めることで、曲を通して単調にならず、いちばん押したいところで前へ出る。
const ANTICIPATE_CHANCE = [15, 35, 70, 30];

export function anticipateMelody(song, rng) {
  const melody = Array.isArray(song?.melody) ? song.melody : [];
  if (melody.length === 0) return [];
  const bars = Number(song.bars);
  const barsPerSection = bars / 4;
  const climaxBeat = Number(song.climaxBeat);
  const breathBar = song.breathBar === undefined ? null : song.breathBar;
  const protectedBars = Array.isArray(song.protectedBars) ? song.protectedBars : [];
  const firstBeat = Math.min(...melody.map((n) => n.beat));
  const moved = [];

  // 拍の早い順に見る。同じ拍なら元の並び順のまま（乱数の消費順を固定するため）。
  const order = melody.map((_, i) => i)
    .sort((a, b) => melody[a].beat - melody[b].beat || a - b);

  for (const i of order) {
    const n = melody[i];
    if (n.beat % BEATS_PER_BAR !== 0) continue;   // 小節の頭の音だけ
    const bar = n.beat / BEATS_PER_BAR;
    if (bar === 0) continue;                      // 前の小節が無い
    if (n.beat === firstBeat) continue;           // 曲の1音目。拍の位置を示す役目がある
    if (bar === bars - 1) continue;               // 最終小節。終止は動かさない
    if (n.beat === climaxBeat) continue;          // 頂点。テヌートと二重に掛かる
    if (breathBar !== null && bar === breathBar + 1) continue;  // 息継ぎの直後
    if (protectedBars.includes(bar)) continue;    // 呼び出し側が食わせないと決めた小節
    const from = n.beat - ANTICIPATE_SHIFT;
    // 食い込む半拍が空いているか。鳴っている区間で見る。
    if (melody.some((m) => m !== n && m.beat < n.beat && m.beat + m.dur > from)) continue;
    const section = Math.min(3, Math.floor(bar / barsPerSection));
    if (!(rng() * 100 < ANTICIPATE_CHANCE[section])) continue;
    n.beat = from;
    n.dur += ANTICIPATE_SHIFT;   // 終わりの位置は動かさない
    n.anticipated = true;
    moved.push(from);
  }
  melody.sort((a, b) => a.beat - b.beat);
  return moved;
}

// ---------------------------------------------------------------------------
// タイ（フレーズ末の伸ばし）
//
// 初版では旋律の音価の中央値が0.5拍で、2拍以上伸ばす音は 5.0% しか無かった。
// フレーズの終わりが短く切れて次まで無音、という形が繰り返される。
// 伸ばし切ってから息を吸う——それがフレーズを「歌」にする。
//
// 次の音の手前に必ず0.5拍を残すので、間は潰れない。
// ---------------------------------------------------------------------------
const PHRASE_GAP = 0.5;
const MAX_HOLD = 4;

export function sustainPhraseEnds(song) {
  const melody = Array.isArray(song?.melody) ? song.melody : [];
  if (melody.length === 0) return 0;
  const bars = Number(song.bars);
  const endBeat = bars * BEATS_PER_BAR;
  const breathBeat = song.breathBar === null || song.breathBar === undefined
    ? null
    : song.breathBar * BEATS_PER_BAR;

  // フレーズ末のスロットが占める拍の範囲。スロットは2小節ひとかたまり。
  const ranges = [];
  for (const s of song.sections ?? []) {
    const slots = Array.isArray(s?.slots) ? s.slots : [];
    for (let k = 0; k < slots.length; k++) {
      if (!slots[k]?.phraseEnd) continue;
      const from = (Number(s.startBar) + 2 * k) * BEATS_PER_BAR;
      ranges.push([from, from + 2 * BEATS_PER_BAR]);
    }
  }

  const sorted = melody.slice().sort((a, b) => a.beat - b.beat);
  let held = 0;
  for (const [from, to] of ranges) {
    // その範囲で最後に鳴り出す音がフレーズ末の音。
    let last = null;
    for (const n of sorted) {
      if (n.beat >= from && n.beat < to && (last === null || n.beat >= last.beat)) last = n;
    }
    if (last === null) continue;
    // 曲の最後の音は、終止として既に最終小節の終わりまで伸ばしてある。触らない。
    if (last.beat + last.dur >= endBeat) continue;
    const next = sorted.find((n) => n.beat > last.beat);
    let limit = next ? next.beat - PHRASE_GAP : endBeat;
    // 息継ぎの小節へは伸ばさない。
    if (breathBeat !== null && last.beat < breathBeat) limit = Math.min(limit, breathBeat);
    const dur = Math.min(MAX_HOLD, limit - last.beat);
    if (dur > last.dur) {
      last.dur = dur;
      held += 1;
    }
  }
  return held;
}
