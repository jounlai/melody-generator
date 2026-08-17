// 事前データ（メロディー断片999個・コード進行99個）から1曲を組み立てる中核モジュール。
//
// 断片をただランダムに並べても「綺麗な断片の羅列」にしかならず、絶対に泣けない。
// ここでやるのは次の4つだけで、その4つが「断片の列」を「曲」に変える。
//
//   1. 楽節構造     — セクションの中を a - a' - b - a'' にする（下記）
//   2. 接続の滑らかさ — 前の断片の終わりと次の断片の始まりを近い音でつなぐ
//   3. 曲全体の起伏   — A→A'→B→A'' の中で緊張を積み上げ、B で一度だけ頂点を作る
//   4. モチーフの再登場 — A で鳴った旋律を、変形した進行の上へ帰ってこさせる
//
// 1 が最も効く。無関係な断片を4つ並べても「ランダムな音程の列」にしか聴こえない。
// 旋律が旋律に聴こえるのは、同じ形が少しずつ姿を変えて戻ってくるからで、
// セクション内の a' と a'' は a のリズムと音形をそのまま保ったまま
// スケール度数を平行移動（ゼクエンツ）して、次のコードの上へ乗せ直したものにする。
//
// 乱数は composeSong の中で作る1本だけを使う。Math.random() は使わない。
// 消費順を変えると同じシードでも同じ曲にならなくなるので、処理順は固定。
import { makeRng, seedFromString, randInt, pick } from './rng.js';
import {
  degToMidi, degToSemitone, chordVoicing, bassMidi, nearestChordToneDeg, chordIndex,
  splitBars, fitsBar, hasSuspension, chordSemitones, CHORD_VOCAB,
} from './theory.js';
import { normalizeSettings } from './settings.js';

/**
 * @typedef {{ deg: number, beat: number, dur: number, vel: number }} FragNote
 * @typedef {{ id: string, notes: FragNote[], startDeg: number, endDeg: number,
 *             contour: string, peakDeg: number, peakCount: number, tension: number,
 *             fit: Record<string, number[][]>, sus: Record<string, number[][]> }} Fragment
 * @typedef {{ id: string, mode: string, bars: {chord: string}[] }} Progression
 */

export const SECTION_NAMES = ['A', "A'", 'B', "A''"];

// どのセクションがどちらの進行を、どれだけ崩して使うか。
// A / A' / A'' を同じ進行の変形で通すことで統一感が出て、B だけが「よそへ行く」。
const SECTION_PLAN = [
  { source: 0, level: 0 }, // A
  { source: 0, level: 1 }, // A'   2小節目を転回形に
  { source: 1, level: 0 }, // B    別の進行
  { source: 0, level: 2 }, // A''  転回形＋終止をサブドミナントマイナーへ
];

// 伴奏のアルペジオ位置。8分音符で途切れさせない。
// 4点だけだと左手が止まって聴こえ、曲全体が停滞する（実際のピアノの左手は流れ続ける）。
const ACCOMP_OFFSETS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
// 8分の長さ(0.5)より少し伸ばして、ペダルのように隣同士を重ねる。
const ACCOMP_DUR = 0.75;
// 音数が倍になるぶん、1音あたりは弱くする。
const ACCOMP_VEL = 0.3;
const BEATS_PER_BAR = 4;
const ACCOMP_LOWEST = 48;
const PAD_VEL = 0.3;
const PAD_LOWEST = 55;
const BASS_VEL = 0.5;
const BASS_LOWEST = 36;

// 声部進行（ボイスリーディング）で使う音域。
//
// theory.js の chordVoicing / bassMidi は和音を**1つずつ**
// [lowest, lowest+12) へ正規化する。単体の規則としては正しいが、前の和音を見ないので
// I - V/3 - vi - I/5 のような下降ベースが C3 → B3 → A3 → G3 と、
// 最初の1歩だけ7度跳ね上がってから降りる形になる。下降ベースはバラードの背骨なので、
// ここが跳ねると「じわじわ沈んでいく」という進行そのものが聴こえなくなる。
//
// そこで小節ごとに、直前の小節にいちばん近いオクターブを選び直す。
// 範囲は E1〜G3（ベース）と C3〜C5（伴奏）。下限に張り付かないよう範囲で止める
// （止めたところで跳躍が出るのは許容する。無限に下がるよりよい）。
const BASS_RANGE = [28, 55];
const ACCOMP_RANGE = [48, 72];

// ---------------------------------------------------------------------------
// 声部の上下関係
//
// 上の ACCOMP_RANGE は「絶対的な音域」でしかなく、旋律がどこを歌っているかを
// 見ていない。実測すると、旋律の音の 33.8% が伴奏かパッドに追い越されていた
// （60曲・既定設定）。伴奏が旋律の上を横切ると主従が入れ替わり、
// どれだけ良い旋律を書いても埋もれて聴こえなくなる。
// ピアノ譜で左手が右手を越えるのは、越えること自体を聴かせたいときだけである。
//
// そこで小節ごとに「その小節で旋律がいちばん低いところ」を天井にして、
// 伴奏とパッドはその下に押し込む。LAYER_GAP は天井との間に空ける最小の隙間。
// 2半音空けておけば、旋律の最低音と伴奏の最高音が同度・半音で混ざらない。
// ---------------------------------------------------------------------------
const LAYER_GAP = 2;
// 旋律が休んでいる小節の天井。旋律が無い小節まで下げる理由が無いので、
// 伴奏の本来の上限をそのまま使う。
const NO_MELODY_CEILING = ACCOMP_RANGE[1];

// 終止の形。実際のピアノ曲は、終わりで左手の刻みを止めて和音を置く。
// 刻み続けたまま終わると、耳は「まだ続く」と判断して曲が閉じない。
// 最終小節だけ分散をやめて和音を保持し、パッドは小節をはみ出して余韻を作る。
const FINAL_ACCOMP_VEL = 0.4;
const FINAL_PAD_DUR = 6;
// 曲の最後の音は、最終小節の終わりまで伸ばす（短くても3拍）。
// 長く伸びた主音の上に主和音が鳴る、これが「終わった」という感覚を作る。
const FINAL_NOTE_MIN_DUR = 3;

// フレーズ末で「息を吸う」ための、メロディーだけの1小節の休み。
// 伴奏・ベース・パッドは鳴り続けるので音楽は止まらない。1曲に最大1回。
const BREATH_SECTIONS = [0, 1];

// 断片が1件も適合しなかったときに鳴らす音の強さ。
const FALLBACK_VEL = [0.55, 0.5];
// 断片が小節を空けていたときに埋める音の強さ。
const FILL_VEL = 0.5;

// メロディーのベロシティに掛ける余裕（ヘッドルーム）。
//
// 断片の vel は 0.55〜0.85 で来る。演奏側（perform.js）はこれに
// セクション基準(最大1.10)×フレーズ内スウェル×クライマックスカーブ(頂点1.20) を掛けるので、
// 素のまま渡すと頂点付近が 1.0 に張り付いて潰れる。クレッシェンドの行き先が
// 天井では、いちばん効かせたい一音が「他と同じ大きさ」になってしまう。
// 0.82 倍して 0.45〜0.70 にしておけば 0.70×1.10×1.20 = 0.92 で天井に当たらない。
// 伴奏・ベース・パッドは元々天井に当たらないので触らない。
const MELODY_VEL_SCALE = 0.82;

// 頂点を越えた直後の脱力。頂点の音のあと RELEASE_BEATS 拍かけて
// RELEASE_FLOOR 倍から等倍へ戻す（＝直後がいちばん小さく、そこから戻っていく）。
//
// 断片の中の抑揚はデータに焼き込まれていて、頂点音の「あと」も普通に鳴り続ける。
// 実測では頂点直後4拍の素ベロシティが直前4拍より大きい曲が64%あり、
// 緊張度と音域の天井を下げただけでは 36% までしか直らなかった
// （直後4拍の音の64%は頂点と同じスロットの中にあり、スロット単位の手当てでは届かない）。
// 泣けるのは高い音そのものではなく、そのあとの静けさとの落差のほう。
// 戻し切るのは、A'' を素の側で削ると伴奏に埋もれるから（A'' の減衰は演奏側が掛ける）。
const RELEASE_FLOOR = 0.72;
const RELEASE_BEATS = 8;

// 進行データが空、あるいはそのモードの進行が1つも無いときの最終手段。
// データ不備で曲が生成できないより、平凡でも鳴るほうがましという判断。
const DEFAULT_PROGRESSION = {
  major: {
    id: 'default-major',
    mode: 'major',
    bars: [{ chord: 'I' }, { chord: 'V' }, { chord: 'vi' }, { chord: 'IV' }],
    cadence: 'open',
    tension: [1, 4, 2, 2],
  },
  minor: {
    id: 'default-minor',
    mode: 'minor',
    bars: [{ chord: 'i' }, { chord: 'VII' }, { chord: 'VI' }, { chord: 'V' }],
    cadence: 'open',
    tension: [1, 3, 2, 4],
  },
};

// level 2 で終止に差し込む「翳り」のコード。長調でも短調の色を1つ混ぜると泣ける。
// ただし置く場所は最終小節の**1つ前**。サブドミナントマイナーは語彙の中で最も
// 未解決な響きなので、ここで曲を終わらせると「途中で切れた」ようにしか聴こえない。
const SUBDOMINANT_MINOR = { major: 'iv', minor: 'VI' };
// 最終小節は主和音で閉じる。iv → I はアーメン終止と呼ばれる形で、
// 陰りを落としてからちゃんと帰ってくる。曲と曲の切れ目はここで決まる。
const TONIC_CHORD = { major: 'I', minor: 'i' };

// クライマックスに要求する最低の頂点度数。curveFor の minPeak と
// 転調の天井（modulatedPeakCap）が同じ数字を見ていないと、
// 「曲中の最高音がちょうど1回」が転調で静かに壊れる。定義は1か所に置く。
const CLIMAX_MIN_PEAK = 12;

// ---------------------------------------------------------------------------
// 最終セクションの転調
//
// 70〜80年代のアメリカとイタリアのラブソング、そして韓国のバラード。
// この3つの伝統に共通していて、断片の組み立てだけでは絶対に出てこない最大の
// 高揚装置が「最後のサビで半音か全音上がる」。同じ旋律が同じ形のまま、
// ほんの少し高いところで鳴り直す。歌い手が最後にもう一段振り絞ったように聴こえる。
//
//   - A''（4つ目のセクション）だけを新しい主音で描く。
//     コード記号（I / vi / iv …）は主音からの相対表記なので**1つも書き換えない**。
//     動くのは主音だけで、進行も楽節構造もゼクエンツもそのまま持ち上がる。
//   - B の最終小節を**新しい調のドミナント**に差し替える（つなぎ目）。
//     いきなり半音上がると唐突に聴こえる。属和音を1小節挟むと、耳がそこで
//     新しい調を受け入れてから A'' の主和音に着地する（実際のバラードもこうする）。
//     この1小節は和音もメロディーも新しい調で鳴らす＝転調は属和音から始まる。
//     ただしその小節がクライマックスのスロットに入る長さ（16小節）では置かない。
//     理由は composeSong の pivots のところに書く。代わりに A'' の頭を拍0から始める。
//
// 音域の天井は、curveFor が A'' に与える maxPeak 10（主音から16半音、短調は15半音）
// で足りている。クライマックスは peakDeg >= 12 ＝ 19半音を要求するので、
// +2 しても 18 < 19 で並ばない。
// ただし**モチーフの再登場だけは例外**で、A のスロットをそのまま持ってくるため
// A'' 側の天井を通らない（A の天井は 11 ＝ 17半音で、+2 すると 19 でちょうど並ぶ）。
// そこで「あとで A'' へ帰る A のスロット」にも転調後の天井を掛ける。
// ---------------------------------------------------------------------------
const MODULATION_CHANCE = 40;      // %
const MODULATION_STEPS = [1, 2];   // 半音
const MODULATION_SECTION = 3;      // A''
// つなぎ目の属和音。V7 が使えなければ V（どちらの語彙にも必ずどちらかはある）。
const PIVOT_CHORDS = ['V7', 'V'];

// ---------------------------------------------------------------------------
// 上げ幅の選び方 — 調号の近さ
//
// +1 と +2 を機械的に半々で引くと、調号が飛ぶ組み合わせが出る。
// 実例: 変ニ長調（フラット5つ）から +1半音 で ニ長調（シャープ2つ）。
// 五度圏を7つも移動する、最も遠い跳び方で、楽譜では橋渡しの小節に臨時記号が9個並び、
// 響きとしても唐突になる。同じ変ニ長調でも +2半音 なら 変ホ長調（フラット3つ）＝距離2で、
// フラット系に留まったまま持ち上がる。こちらのほうが読みやすく、自然に聴こえる。
//
// そこで上げ幅は「転調後の調号が近いほう」を強く優先して引く。
// ただし決め打ちにはしない（同じ調でいつも同じ上げ幅では単調になる）。
//
// なお **+1半音の転調は、原理的にどうやっても調号が5つ以上動く**
// （1半音 = 五度圏で7つ ＝ 反対回りに5つ）。+1 を残す以上「全部が近い」にはできないので、
// ここで潰すのは「5でも済むのに7も動く」ほうだけ。
// 距離7（最悪）を捨てて距離5（+1で可能な最小）を残す、というのがこの重みの意図。
// ---------------------------------------------------------------------------

// 主音のピッチクラスごとの、慣用の綴りでの五度圏の位置（シャープが＋、フラットが−）。
// 例: 長調のピッチクラス1は 嬰ハ長調(シャープ7つ)ではなく 変ニ長調(フラット5つ)＝−5。
// !!! notation.js の keySignature が返す調号と一致していること !!!
// ここがずれると「楽譜に出る臨時記号の数」と「ここで最適化している距離」が食い違う。
// 一致は compose.test.js で keySignature と突き合わせて検査している。
const KEY_FIFTHS = {
  major: [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5],
  minor: [-3, 4, -1, -6, 1, -4, 3, -2, 5, 0, -5, 2],
};
// 距離がこれ以上なら「遠い」。どちらの上げ幅も遠いときは抽選せず近いほうを採る。
const MODULATION_FAR = 5;
// 近さの効かせ方。1/(1+距離)^n で重みを作る。n を上げるほど近いほうへ寄る。
// 実測（600曲・転調249曲）の平均距離と、最悪の距離7が出た割合:
//   半々で機械的に引く  4.58 / 20.5%（距離10も8.4%出る）
//   n = 2              3.17 /  6.0%
//   n = 3              2.94 /  3.6%   ← 採用
// 「平均3.0以下」と「距離7は5%以下」を同時に満たすのは n=3 から。
// n をさらに上げると +1 がほぼ出なくなり、半音上げというバラードの定石そのものが消える。
const MODULATION_DISTANCE_POWER = 3;

/** 調号の五度圏上の位置。シャープが＋、フラットが−、ハ長調とイ短調が0。 */
export function keyFifths(tonicMidi, mode) {
  const pc = ((Math.round(Number(tonicMidi)) % 12) + 12) % 12;
  return (KEY_FIFTHS[mode] ?? KEY_FIFTHS.major)[pc];
}

/** その上げ幅で転調したとき、調号が五度圏をいくつ動くか。 */
export function keyDistance(tonicMidi, semitones, mode) {
  return Math.abs(keyFifths(tonicMidi + semitones, mode) - keyFifths(tonicMidi, mode));
}

/**
 * 上げ幅を1つ引く。調号が近いほうを強く優先し、どちらも遠ければ近いほうに決め打つ。
 * 乱数の消費は決め打ちの場合も含めて必ず1回（消費数が揺れると曲が別物になる）。
 */
export function chooseModulationStep(rng, tonicMidi, mode) {
  const options = MODULATION_STEPS.map((semitones) => ({
    semitones,
    distance: keyDistance(tonicMidi, semitones, mode),
  }));
  const drawn = pickWeighted(rng, options,
    (o) => 1 / ((1 + o.distance) ** MODULATION_DISTANCE_POWER));
  const nearest = options.reduce((a, b) => (b.distance < a.distance ? b : a));
  // 両方遠いなら多様性より読みやすさ。B→Db（距離10）のような綴りの飛びを避ける。
  return options.every((o) => o.distance >= MODULATION_FAR) ? nearest.semitones : drawn.semitones;
}

/**
 * 転調した調で鳴らしてよい頂点度数の上限。
 *
 * クライマックス（主音 + degToSemitone(CLIMAX_MIN_PEAK) 半音）に**並ばない**
 * 最大の度数を返す。並んだ瞬間に「曲中の最高音がちょうど1回」が壊れるので、
 * ここだけは実測ではなく計算で決める（長調と短調で音程が違うので mode も見る）。
 */
export function modulatedPeakCap(semitones, mode) {
  const ceiling = degToSemitone(CLIMAX_MIN_PEAK, mode);
  const up = Number.isFinite(semitones) ? semitones : 0;
  for (let d = DEG_MAX; d >= DEG_MIN; d--) {
    if (degToSemitone(d, mode) + up < ceiling) return d;
  }
  return DEG_MIN;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

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
 * 直前の音にいちばん近いオクターブへ寄せる（声部進行）。
 * 候補は ±2オクターブまで。[lo, hi] に収まるものだけを見て、同点なら低いほうを採る。
 * prev が無い（曲の1小節目）なら、正規化された値をそのまま使う。
 *
 * 範囲に候補が1つも無いときは、範囲の中へオクターブ単位で押し込む。
 * 跳躍は出るが、音域を外れて鳴らせなくなるよりよい。
 */
export function nearestOctave(midi, prev, range) {
  const [lo, hi] = range;
  if (prev === null || prev === undefined) return clamp(midi, lo, hi);
  let best = null;
  for (let j = -2; j <= 2; j++) {
    const c = midi + 12 * j;
    if (c < lo || c > hi) continue;
    if (best === null) { best = c; continue; }
    const d = Math.abs(c - prev);
    const bd = Math.abs(best - prev);
    if (d < bd || (d === bd && c < best)) best = c;
  }
  if (best !== null) return best;
  let c = midi;
  while (c < lo) c += 12;
  while (c > hi) c -= 12;
  return clamp(c, lo, hi);
}

/**
 * クライマックスを置くスロット番号。
 * 最後のスロットに置くと余韻が無いので、1つ手前を頂点にして着地を残す。
 */
export function climaxSlot(slots) {
  return slots >= 3 ? slots - 2 : slots - 1;
}

// カーブを掛ける前の理想の緊張度（1〜5の連続値）。
export function rawTension(sectionIdx, slotIdx, slots) {
  if (sectionIdx === 2) {
    // B は頂点へ向かって登り、頂点を過ぎたら**はっきり**緩める。
    // ここを 4 のままにすると、頂点を越えたあとも緊張度の高い断片＝素のベロシティの
    // 大きい断片が選ばれ続け、演奏側がディミヌエンドを掛けても押し返してしまう。
    // 「脱力の落差」は感動の要。上げて、頂点で解放し、下りてくる。
    const cs = climaxSlot(slots);
    if (slotIdx < cs) return 3 + (2 * slotIdx) / Math.max(1, cs);
    if (slotIdx === cs) return 5;
    return 3;
  }
  const t = slots === 1 ? 0 : slotIdx / (slots - 1);
  // A: 1→2（提示）、A': 2→3（高まり）、A'': 3→1（着地）
  const [from, to] = sectionIdx === 0 ? [1, 2] : sectionIdx === 1 ? [2, 3] : [3, 1];
  return from + (to - from) * t;
}

/**
 * スロットに要求する緊張度と音高帯を決める。
 *
 * 非クライマックスの maxPeak を 11 に抑え、クライマックスだけ minPeak 12 を要求する。
 * これで「曲中の最高音が、ただ一度だけ鳴る」が構造的に保証される。
 * 涙腺に効くのは高い音そのものではなく、"そこで初めて届いた" という一回性のほう。
 *
 * @param {number} strength 0〜1に正規化した起伏の強さ。0なら制約なし。
 */
export function curveFor(sectionIdx, slotIdx, slots, strength) {
  const st = clamp(Number.isFinite(strength) ? strength : 1, 0, 1);
  const raw = rawTension(sectionIdx, slotIdx, slots);
  const tension = clamp(Math.round(3 + (raw - 3) * st), 1, 5);
  const cs = climaxSlot(slots);
  const isClimax = sectionIdx === 2 && slotIdx === cs;
  // 頂点を過ぎたスロットと A'' は、音域の天井も1つ下げる。
  // 緊張度だけ下げても高い音が鳴り続ければ「まだ登っている」ように聴こえる。
  const afterClimax = sectionIdx === 2 && slotIdx > cs;
  return {
    tension,
    maxPeak: st === 0 || isClimax ? 15 : sectionIdx === 3 || afterClimax ? 10 : 11,
    minPeak: st === 0 ? 1 : isClimax ? CLIMAX_MIN_PEAK : 1,
  };
}

/**
 * 進行を段階的に崩す。同じ4小節でも、崩し方でセクションの表情が変わる。
 * 変形後の記号が CHORD_VOCAB に無ければ、その変形は諦めて原形を残す
 * （語彙外のコードは断片の fit に載っていないので、選択が全滅する）。
 */
export function varyProgression(prog, level) {
  const bars = prog.bars.map((b) => ({ ...b }));
  const out = { ...prog, bars };
  if (Array.isArray(prog.tension)) out.tension = prog.tension.slice();
  const mode = prog.mode;
  const usable = (sym) => chordIndex(mode, sym) >= 0;

  if (level >= 1 && bars.length >= 2) {
    // 2小節目を第1転回形に。ベースが動くだけで進行が滑り出す。
    const sym = bars[1].chord;
    if (!sym.includes('/')) {
      const inv = `${sym}/3`;
      if (usable(inv)) bars[1].chord = inv;
    }
  }
  if (level >= 2 && bars.length >= 1) {
    const tonic = TONIC_CHORD[mode];
    if (tonic && usable(tonic)) bars[bars.length - 1].chord = tonic;
    const sub = SUBDOMINANT_MINOR[mode];
    if (bars.length >= 2 && sub && usable(sub)) bars[bars.length - 2].chord = sub;
  }
  return out;
}

function fitsChords(m, ctx) {
  const fit = m?.fit?.[ctx.mode];
  if (!Array.isArray(fit) || !Array.isArray(fit[0]) || !Array.isArray(fit[1])) return false;
  return fit[0].includes(ctx.chordAIdx) && fit[1].includes(ctx.chordBIdx);
}

/**
 * 断片フィルタ。level が高いほど厳しい。
 *
 * どのレベルでも譲らないのが「コード適合」と「音高の窓」の2つ。候補が枯れたときに
 * 緩めてよいのは接続と緊張度だけで、音高の窓を緩めた瞬間に非クライマックスの
 * スロットが12度以上を引けてしまい、"最高音は一度だけ" が壊れる。
 *
 *   1: コード適合 ＋ 音高の窓（上限・下限・頂点の一回性）
 *   2: ＋前の断片との接続の滑らかさ
 *   3: ＋緊張度の一致
 */
export function passesFilters(m, ctx, level) {
  if (!fitsChords(m, ctx)) return false;

  if (m.peakDeg > (ctx.maxPeak ?? 15)) return false;
  if (m.peakDeg < (ctx.minPeak ?? 1)) return false;
  // 頂点のスロットでは、断片の中で最高音が2回以上鳴るものを弾く。
  // 他のスロットは天井(11)で頂点に届かないので、曲全体の最高音の一回性は
  // ここだけで守られる。届いた瞬間が2回あると、その1回性が消える。
  if (ctx.soloPeak && (m.peakCount ?? 1) > 1) return false;

  if (level >= 2 && ctx.prevEndDeg !== null && ctx.prevEndDeg !== undefined) {
    if (Math.abs(m.startDeg - ctx.prevEndDeg) > ctx.maxLeap) return false;
  }

  if (level >= 3) {
    if (Math.abs(m.tension - ctx.tension) > 1) return false;
  }
  return true;
}

// 適合する断片が1件も無いときの保険。2小節を全音符2つで埋める。
// 退屈でも構わない。無音の小節を作ること＝音楽が止まることだけは許さない。
function fallbackFragment(ctx) {
  const around = ctx.prevEndDeg ?? 5;
  const degA = nearestChordToneDeg(ctx.chordA, ctx.mode, around);
  const degB = nearestChordToneDeg(ctx.chordB, ctx.mode, degA);
  const lo = Math.min(degA, degB);
  const hi = Math.max(degA, degB);
  return {
    id: 'fallback',
    notes: [
      { deg: degA, beat: 0, dur: 4, vel: FALLBACK_VEL[0] },
      { deg: degB, beat: 4, dur: 4, vel: FALLBACK_VEL[1] },
    ],
    startDeg: degA,
    endDeg: degB,
    contour: 'answer',
    range: [lo, hi],
    span: 0,
    peakDeg: hi,
    peakBeat: degB > degA ? 4 : 0,
    peakCount: 1,
    tension: 1,
    density: 0.25,
    tags: [],
    score: 0,
  };
}

// 陰りのコード。ここが鳴る瞬間が、その曲でいちばん感情の動くところ。
// 転回や7thが付いていても正体は同じなので、根音の記号だけを見る（iv7、bVI/3 も同じ扱い）。
const DARK_CHORDS = new Set(['iv', 'bVI', 'bVII']);

export function isDarkChord(symbol) {
  const m = /^b?[ivIV]+/.exec(String(symbol ?? ''));
  return m ? DARK_CHORDS.has(m[0]) : false;
}

function hasSus(m, ctx) {
  const sus = m?.sus?.[ctx.mode];
  if (!Array.isArray(sus)) return false;
  const [a = [], b = []] = sus;
  return a.includes(ctx.chordAIdx) || b.includes(ctx.chordBIdx);
}

// 断片が「口ずさめる」かどうかは、ほぼペンタトニックかどうかで決まる。
// タグは makeMelodies 側が付ける（major は度数4と7、minor は度数2と6を使わない断片）。
const PENTATONIC_TAG = { major: 'penta-major', minor: 'penta-minor' };

function hasPentatonic(m, mode) {
  const tags = m?.tags;
  return Array.isArray(tags) && tags.includes(PENTATONIC_TAG[mode]);
}

// ---------------------------------------------------------------------------
// 楽節計画（フレーズの長さ）
//
// 断片は2小節なので、1スロット＝1断片＝1フレーズにすると、曲じゅうのフレーズが
// 2小節ちょうどに切り揃う。2小節ごとに律儀に息継ぎされると、聴き手には
// 「歌」ではなく「断片の列」に聴こえる。Yesterday の7小節フレーズが象徴するように、
// 名バラードのフレーズは非対称で、息の長さが揃っていない。
//
// そこでセクションごとに「どのスロットまでを1フレーズとみなすか」を抽選する。
// 数字は1フレーズが使うスロット数（1 = 2小節、2 = 4小節）。
//
// 断片そのものや楽節の役割（a / a' / b / a''）は変えない。変えるのは
// 「どこで息継ぎするか」だけ。フレーズ末では終止感のある断片を、フレーズ途中では
// 終止感の**無い**断片を選ぶ。途中のスロットが閉じずに次の小節へ流れ込むから、
// 2小節の断片2つが1つの4小節フレーズとして聴こえる。
// ---------------------------------------------------------------------------

const PHRASE_PLANS_4 = [
  { groups: [1, 1, 1, 1], weight: 2 }, // 2+2+2+2（従来）
  { groups: [2, 1, 1], weight: 3 },    // 4+2+2
  { groups: [1, 1, 2], weight: 3 },    // 2+2+4
  { groups: [2, 2], weight: 2 },       // 4+4
  { groups: [1, 2, 1], weight: 2 },    // 2+4+2
];
const PHRASE_PLANS_2 = [
  { groups: [1, 1], weight: 2 },       // 2+2
  { groups: [2], weight: 3 },          // 4
];

/**
 * セクションのスロットをフレーズにまとめる計画を抽選する。
 * slots は 2 / 4 / 8。8 は4スロットぶんの計画を2つ連結する
 * （2周目に別の計画が出るので、後半で息の長さが変わる）。
 *
 * rng の消費は計画1つにつき1回。想定外の slots でも必ずスロット数と一致する
 * 計画を返す（合計が slots に満たない計画は絶対に返さない）。
 */
export function phrasePlan(rng, slots) {
  const out = [];
  let left = Number.isFinite(slots) ? Math.max(0, Math.floor(slots)) : 0;
  while (left >= 4) {
    out.push(...pickWeighted(rng, PHRASE_PLANS_4, (p) => p.weight).groups);
    left -= 4;
  }
  if (left >= 2) {
    out.push(...pickWeighted(rng, PHRASE_PLANS_2, (p) => p.weight).groups);
    left -= 2;
  }
  for (let i = 0; i < left; i++) out.push(1);
  return out;
}

/**
 * 計画から「そのスロットがフレーズ末か」を求める。
 * グループの最後のスロットがフレーズ末で、それ以外は途中。
 * セクションの最後のスロットは、計画が何であれ必ずフレーズ末にする。
 */
export function phraseEndFlags(plan, slots) {
  const n = Number.isFinite(slots) ? Math.max(0, Math.floor(slots)) : 0;
  const ends = new Array(n).fill(false);
  let k = 0;
  for (const g of Array.isArray(plan) ? plan : []) {
    k += g;
    if (k >= 1 && k <= n) ends[k - 1] = true;
  }
  if (n > 0) ends[n - 1] = true;
  return ends;
}

// 「息継ぎのある終わり方」の判定。
//
// long-ending タグは analyze.js が「最後の音が1.5拍以上」で付ける。データの作り方に
// よってはプールの全断片が持ってしまい（実測: 999/999）、タグだけでは
// フレーズ末と途中の区別がつかない。そこでタグを第1段、最後の音の長さそのものを
// 第2段に置き、タグが効くデータでも効かないデータでも区別がつくようにする。
const LONG_ENDING_TAG = 'long-ending';
const BREATH_HOLD = 2;

function endingHold(m) {
  const notes = m?.notes;
  if (!Array.isArray(notes) || notes.length === 0) return 0;
  return Number(notes[notes.length - 1].dur) || 0;
}

export function hasLongEnding(m) {
  const tags = m?.tags;
  return Array.isArray(tags) && tags.includes(LONG_ENDING_TAG);
}

// フレーズ末が欲しい断片：まず「タグ付き＋長く伸ばす」、次に「タグ付き」。
const CLOSING_TIERS = [
  (m) => hasLongEnding(m) && endingHold(m) >= BREATH_HOLD,
  (m) => hasLongEnding(m),
];
// フレーズ途中が欲しい断片：まず「タグ無し」、次に「伸ばさない」。
const FLOWING_TIERS = [
  (m) => !hasLongEnding(m),
  (m) => endingHold(m) < BREATH_HOLD,
];

// 楽節の a（アンカー）のスロットだけは、候補がこれを下回るなら息の流れで絞らない。
//
// a はそのまま a' と a'' へ移調されて、楽節3スロットぶんを支配する。ここで候補を
// 痩せさせると、移調先の和音に乗る平行移動量が見つからなくなって楽節そのものが崩れる。
// 実測（200シード×3つの長さ＝600曲、シードを別ブロックに変えても同じ傾向）:
//   息の流れを掛けない          94.1%
//   下限なしで無条件に掛ける    93.9%
//   下限12                     94.6%   ← 掛けないときより上
// それでいてフレーズ末との差は79ポイント残る（要求は20ポイント）。
// 下限を 4/8/16/24/32 と振っても 12 がいちばん高く、かつ2つのシード集合で一致した。
const ANCHOR_MIN_CANDIDATES = 12;

// ---------------------------------------------------------------------------
// クライマックスの「舞い上がり」
//
// Hey Jude の "better"、Can't Help Falling in Love の上昇。頂点に効くのは
// 高さそのものではなく、**そこへどう到達したか**。大きく跳び上がって着地し、
// そこから順次進行で降りてくる形が、いちばん息を呑ませる。
// じわじわ上がって着いた同じ高さの音は、同じ効果を持たない。
// ---------------------------------------------------------------------------
const SOAR_LEAP = 4;  // 頂点へ跳び上がる度数差（4度以上）
const SOAR_STEP = 2;  // 頂点の直後の順次下降（1〜2度）

export function soarsToPeak(fragment) {
  const notes = fragment?.notes;
  if (!Array.isArray(notes) || notes.length < 3) return false;
  const peak = Number.isFinite(fragment.peakDeg)
    ? fragment.peakDeg
    : Math.max(...notes.map((n) => n.deg));
  let i = notes.findIndex((n) => n.deg === peak && n.beat === fragment.peakBeat);
  if (i < 0) i = notes.findIndex((n) => n.deg === peak);
  if (i <= 0 || i >= notes.length - 1) return false;
  const rise = notes[i].deg - notes[i - 1].deg;
  const fall = notes[i].deg - notes[i + 1].deg;
  return rise >= SOAR_LEAP && fall >= 1 && fall <= SOAR_STEP;
}

/**
 * ctx が要求するフィルタを通った候補。厳しいレベルから試し、
 * 候補が見つかった時点で打ち切る（妥協は最小限に留める）。
 */
export function fragmentCandidates(melodies, ctx) {
  const pool = Array.isArray(melodies) ? melodies : [];
  for (const level of [3, 2, 1]) {
    const candidates = pool.filter((m) => passesFilters(m, ctx, level));
    if (candidates.length > 0) return candidates;
  }
  return [];
}

/**
 * 候補を好みの順に絞り込む。どの絞り込みも「該当が無ければ絞らない」。
 * データにタグが無い環境でも安全に動くのが条件。
 *
 *   1. 対比      — 楽節の b は a と違う輪郭にする
 *   2. 舞い上がり — クライマックスは「跳び上がって着地し、順次で降りる」形に限る
 *   3. 終止      — 楽節のどこにいるかで「終わり方」を変える（下記 CADENCE_BY_ROLE）
 *   4. 息の流れ   — フレーズ末は閉じ、フレーズ途中は閉じない（楽節計画）
 *   5. ペンタトニック — 大衆的で口ずさめる旋律の最大の要因
 *   6. 掛留      — 頂点の直前と陰りのコードの上。泣けるかどうかはここで決まる
 *
 * 終止をペンタトニック・掛留より先に掛けるのは、いちばん広い候補の中から
 * 選ばせるため。あとに回すと、絞り込まれた小さな集合の中に目当ての終止音が
 * 残っておらず「該当なし」で素通りしてしまう。
 *
 * 舞い上がりを終止より先に掛けるのは、クライマックスの1スロットだけの話だから。
 * そこで最優先なのは「どう頂点へ届いたか」で、終止音の好みはその次でいい。
 */
function narrowCandidates(candidates, ctx) {
  let out = candidates;
  if (ctx.avoidContour) {
    const contrast = out.filter((m) => m.contour !== ctx.avoidContour);
    if (contrast.length > 0) out = contrast;
  }
  // 曲の出だしだけは、拍0から鳴り出す断片を採る。
  // 弱起の断片で始まると、聴き手はどこが1拍目か掴めないまま曲に入ることになる。
  if (ctx.preferDownbeat) {
    const onBeat = out.filter((m) => (m.notes?.[0]?.beat ?? 0) === 0);
    if (onBeat.length > 0) out = onBeat;
  }
  // 頂点へは跳び上がって届き、そこから順次で降りる。
  if (ctx.preferSoar) {
    const soaring = out.filter(soarsToPeak);
    if (soaring.length > 0) out = soaring;
  }
  if (Array.isArray(ctx.endDegrees)) {
    for (const tier of ctx.endDegrees) {
      const closed = out.filter((m) => tier.includes(scaleDegreeOf(m.endDeg)));
      if (closed.length > 0) { out = closed; break; }
    }
  }
  // 楽節計画の要。フレーズ末は閉じ、フレーズ途中は閉じずに次の小節へ流し込む。
  // 「該当が無ければ絞らない」に加えて、楽節の a では「痩せすぎるなら絞らない」。
  const keep = ctx.isAnchor ? ANCHOR_MIN_CANDIDATES : 1;
  const enough = (n) => n > 0 && n >= keep;
  if (ctx.phraseEnd === true) {
    for (const tier of CLOSING_TIERS) {
      const closing = out.filter(tier);
      if (enough(closing.length)) { out = closing; break; }
    }
  } else if (ctx.phraseEnd === false) {
    for (const tier of FLOWING_TIERS) {
      const flowing = out.filter(tier);
      if (enough(flowing.length)) { out = flowing; break; }
    }
    // 途中でトニックに着地すると、そこで一度曲が閉じてしまう。
    const open = out.filter((m) => scaleDegreeOf(m.endDeg) !== 1);
    if (enough(open.length)) out = open;
  }
  // 陰りのコードの上では、掛留がその瞬間の主役。ペンタトニックより先に掛ける。
  // あとに回すと、ペンタトニックで絞ったあとの小さな集合に掛留が残っておらず、
  // 「該当なし」で素通りしてしまう（実測でここが効かず、掛留率がほぼ動かなかった）。
  if (ctx.preferSus && ctx.susOverPenta) {
    const sus = out.filter((m) => hasSus(m, ctx));
    if (sus.length > 0) out = sus;
  }
  if (ctx.preferPenta) {
    const penta = out.filter((m) => hasPentatonic(m, ctx.mode));
    if (penta.length > 0) out = penta;
  }
  // 登り坂の出だしは、天井いっぱいの断片を引かない。
  // ゼクエンツは音形ごと平行移動するので、元が天井に着いていると上へ動かせず、
  // 「少しずつ上げてクライマックスへ」が最初のスロットで詰む。低く始めて余地を残す。
  // 口ずさめること（ペンタトニック）のほうが上なので、その中から低いものを採る。
  if (ctx.headroom) {
    const low = out.filter((m) => m.peakDeg <= ctx.headroom);
    if (low.length > 0) out = low;
  }
  if (ctx.preferSus) {
    const sus = out.filter((m) => hasSus(m, ctx));
    if (sus.length > 0) out = sus;
  }
  return out;
}

/** スロットを埋める断片を1つ引く。 */
export function selectFragment(rng, melodies, ctx) {
  const candidates = fragmentCandidates(melodies, ctx);
  if (candidates.length === 0) return fallbackFragment(ctx);
  return pick(rng, narrowCandidates(candidates, ctx));
}

// ---------------------------------------------------------------------------
// 楽節構造（セクションの中身）
//
// セクションを a - a' - b - a'' の楽節にする。a' と a'' は a のゼクエンツ
// （リズムと音形をそのまま保ったままスケール度数を平行移動したもの）で、
// これが「同じ歌が続いている」という感覚を作る。b だけは通常選択で、
// a と違う輪郭を要求して対比を置く。
// ---------------------------------------------------------------------------

const DEG_MIN = 1;
const DEG_MAX = 15;

// 平行移動量の既定の試行順。近い順に ±3 まで試し、そこまでで乗らなければ
// ±7（オクターブ＝音名は同じまま音域だけ移す）、±4、±5 まで広げる。
// 曲を組むときは下の phraseOffsets が返す「向きのある」順を使う。
const PHRASE_OFFSETS = [0, -1, 1, -2, 2, -3, 3, -7, 7, -4, 4, -5, 5];

/**
 * セクションと役割ごとの平行移動量の優先順。**この表がこのファイルの心臓部**。
 *
 * 適合する量を近い順に試して最初に乗ったものを採ると、オフセットが場当たり的になり、
 * ゼクエンツが上がったり下がったりして旋律に方向が生まれない。
 * 感動させる音楽は数小節かけて音域を少しずつ上げ、頂点で解放し、そして下りてくる。
 * ゼクエンツが上行していくこと自体が感情を作る（賛歌やサビの盛り上がりの正体）。
 *
 *   A   静かに提示し、少しだけ上げる
 *   A'  明確に上昇させる
 *   B   クライマックスへ駆け上がる
 *   A'' 家へ帰る。下降して収める ← 上がりっぱなしでは終われない
 *
 * 64小節（1セクション8スロット＝2周）でも周ごとに向きは変えない。
 * 2周目で上下を入れ替えると、せっかく作った方向がその場で打ち消される。
 */
const SEQUENCE_OFFSETS = {
  0: { "a'": [0, 1, 2, -1, 3, -2], "a''": [1, 2, 0, 3, -1, -2] },
  1: { "a'": [1, 2, 3, 0, -1], "a''": [2, 3, 1, 0, -1] },
  2: { "a'": [2, 3, 1, 4, 0], "a''": [3, 4, 2, 1, 0] },
  3: { "a'": [0, -1, -2, 1, -3], "a''": [-2, -3, -1, 0, -4] },
};

// セクションの向き。表に無い量を最後に並べるときの符号の好みに使う。
const SECTION_DIRECTION = [1, 1, 1, -1];
const EXTRA_OFFSETS = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7];

/**
 * そのセクション・その役割で平行移動量を試す順。
 *
 * 既定では表の量だけを返す。表に無い量（±4以上やオクターブ）を混ぜると
 * 「乗りさえすれば何でも使う」に戻って方向がその場で消える
 * （±7 は音名が同じままなのでコード適合が変わらず、下降指定のセクションでも上へ跳ぶ）。
 *
 * wide は最後の手段専用。リズム一致の断片も見つからず、このままでは楽節が
 * 無関係な断片に置き換わる、というときだけ広げる。広げるときも
 * 表の量を先頭に残し、そのあとはセクションの向きに合う符号から並べる。
 */
export function phraseOffsets(sectionIdx, roleName, wide = false) {
  const primary = SEQUENCE_OFFSETS[sectionIdx]?.[roleName];
  if (!primary) return PHRASE_OFFSETS;
  if (!wide) return primary;
  const dir = SECTION_DIRECTION[sectionIdx] ?? 1;
  const extra = EXTRA_OFFSETS
    .filter((o) => !primary.includes(o))
    .sort((a, b) => (Math.sign(b) === dir) - (Math.sign(a) === dir) || Math.abs(a) - Math.abs(b));
  return [...primary, ...extra];
}

/**
 * 役割ごとの終止音（スケール度数）の好み。前から順に試し、該当が無ければ次へ。
 * どれにも該当しなければ絞らない（＝必須ではなく優先）。
 *
 *   a    問いかけて開いたまま     トニック以外
 *   a'   ひとまず答える          1 / 3 / 5
 *   b    再び開く               トニック以外
 *   a''  完全に閉じる            まずトニック、無ければ 3 / 5
 *
 * どのスロットも同じ条件で選ぶと2小節ごとに必ず似た終わり方をして予測可能になる。
 * 「問いかけ→答え→問いかけ→締め」の差が、4つの断片を1つの楽節に束ねる。
 */
const OPEN_DEGREES = [2, 3, 4, 5, 6, 7];
const CADENCE_BY_ROLE = {
  a: [OPEN_DEGREES],
  "a'": [[1, 3, 5]],
  b: [OPEN_DEGREES],
  "a''": [[1], [3, 5]],
};

const PHRASE_ROLES = ['a', "a'", 'b', "a''"];

/**
 * セクション内のスロットの役割。
 * slots は 2 / 4 / 8。4以上なら a - a' - b - a'' を1周として繰り返す。
 *
 * anchor はその楽節の a のスロット番号（a 自身は null）。
 * derive が真なら a から導出する（a' と a''）。b は anchor の輪郭との対比に使うだけ。
 */
export function phraseRoles(slots) {
  const roles = [];
  if (slots < 4) {
    // 16小節（スロット2）は a - a' だけ。
    for (let k = 0; k < slots; k++) {
      roles.push(k === 0
        ? { name: 'a', anchor: null, derive: false, cycle: 0 }
        : { name: "a'", anchor: 0, derive: true, cycle: 0 });
    }
    return roles;
  }
  for (let k = 0; k < slots; k++) {
    const cycle = Math.floor(k / 4);
    const idx = k % 4;
    roles.push({
      name: PHRASE_ROLES[idx],
      anchor: idx === 0 ? null : cycle * 4,
      derive: idx === 1 || idx === 3,
      cycle,
    });
  }
  return roles;
}

/** notes のリズム型（拍と長さの並び）。ゼクエンツが作れないときの代替探しに使う。 */
export function rhythmKey(fragment) {
  return (fragment?.notes ?? []).map((n) => `${n.beat}:${n.dur}`).join(',');
}

// 打点の位置だけを見た、ゆるいリズム型。長さが違っても打点が同じなら
// 「同じリズムの続き」には聴こえる。
function onsetKey(fragment) {
  return (fragment?.notes ?? []).map((n) => n.beat).join(',');
}

function scaleDegreeOf(deg) {
  return ((((deg - 1) % 7) + 7) % 7) + 1;
}

/**
 * 断片のスケール度数を平行移動する。リズム（beat / dur / vel）はそのまま。
 * 1〜15 に収まらない音が出る offset は「音形が潰れる」ので不採用（null を返す）。
 *
 * fit / sus は移調後には使えないので捨てる（必要なら attachFitSus で作り直す）。
 */
export function transposeFragment(fragment, offset) {
  const src = Array.isArray(fragment?.notes) ? fragment.notes : [];
  if (src.length === 0) return null;
  const notes = [];
  for (const n of src) {
    const deg = n.deg + offset;
    if (deg < DEG_MIN || deg > DEG_MAX) return null;
    notes.push({ ...n, deg });
  }
  const degs = notes.map((n) => n.deg);
  const peakDeg = Math.max(...degs);
  const lo = Math.min(...degs);
  const peakNote = notes.find((n) => n.deg === peakDeg);
  // ペンタトニックのタグは移調で成り立たなくなることがある（度数3→4 など）。
  // 実際の音で確かめて、成り立たなくなったタグだけ落とす（付け足しはしない）。
  const tags = (fragment.tags ?? []).filter((t) => {
    if (t === PENTATONIC_TAG.major) return degs.every((d) => ![4, 7].includes(scaleDegreeOf(d)));
    if (t === PENTATONIC_TAG.minor) return degs.every((d) => ![2, 6].includes(scaleDegreeOf(d)));
    return true;
  });
  return {
    ...fragment,
    id: `${fragment.id}+${offset}`,
    notes,
    startDeg: notes[0].deg,
    endDeg: notes[notes.length - 1].deg,
    range: [lo, peakDeg],
    span: peakDeg - lo,
    peakDeg,
    peakBeat: peakNote ? peakNote.beat : 0,
    peakCount: degs.filter((d) => d === peakDeg).length,
    tags,
    fit: { major: [[], []], minor: [[], []] },
    sus: { major: [[], []], minor: [[], []] },
  };
}

// 移調後の断片に fit / sus を作り直して付ける。曲中で要るのは今のモードだけ。
function attachFitSus(fragment, mode) {
  const [b0, b1] = splitBars(fragment.notes);
  const f0 = []; const f1 = []; const s0 = []; const s1 = [];
  CHORD_VOCAB[mode].forEach((sym, i) => {
    if (fitsBar(b0, mode, sym)) {
      f0.push(i);
      if (hasSuspension(b0, mode, sym)) s0.push(i);
    }
    if (fitsBar(b1, mode, sym)) {
      f1.push(i);
      if (hasSuspension(b1, mode, sym)) s1.push(i);
    }
  });
  const fit = { major: [[], []], minor: [[], []] };
  const sus = { major: [[], []], minor: [[], []] };
  fit[mode] = [f0, f1];
  sus[mode] = [s0, s1];
  return { ...fragment, fit, sus };
}

// 移調後は fit の添字が当てにならないので、実際に小節へ乗るかを計算し直す。
function fitsSlotChords(fragment, ctx) {
  const [b0, b1] = splitBars(fragment.notes);
  return fitsBar(b0, ctx.mode, ctx.chordA) && fitsBar(b1, ctx.mode, ctx.chordB);
}

// その断片が、この役割にいちばん求められている終止音で終わっているか。
function closesOnTonic(fragment, ctx) {
  const wanted = Array.isArray(ctx.endDegrees) ? ctx.endDegrees[0] : null;
  return wanted ? wanted.includes(scaleDegreeOf(fragment.endDeg)) : false;
}

// 終止の好み（CADENCE_BY_ROLE の段）の何段目に当たるか。当たらなければ最下位。
function cadenceRank(endDeg, tiers) {
  if (!Array.isArray(tiers)) return 0;
  for (let i = 0; i < tiers.length; i++) {
    if (tiers[i].includes(scaleDegreeOf(endDeg))) return i;
  }
  return tiers.length;
}

/**
 * a から a'（a''）を導出する。
 * 平行移動量を順に試し、そのスロットの2つのコードに実際に乗るものを採る。
 * 音高の窓（maxPeak / minPeak）は選択と同じ条件で守る。ここを緩めると
 * 非クライマックスのスロットが頂点に並んで「最高音は一度だけ」が壊れる。
 *
 * 採用は「優先順（＝方向）を基本に、その中で終止の好みに合う量を前へ出す」。
 * 乗る中で最初の1つ、ではない。最初の1つを採ると方向も終止も場当たりになる。
 *
 * @returns {{offset:number, fragment:object}|null}
 */
export function deriveFragment(anchor, ctx, opts = {}) {
  if (!anchor || !Array.isArray(anchor.notes) || anchor.notes.length === 0) return null;
  const offsets = opts.offsets ?? PHRASE_OFFSETS;
  const accepted = [];
  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i];
    if (opts.exclude !== null && opts.exclude !== undefined && offset === opts.exclude) continue;
    const moved = transposeFragment(anchor, offset);
    if (!moved) continue;
    if (moved.peakDeg > (ctx.maxPeak ?? 15)) continue;
    if (moved.peakDeg < (ctx.minPeak ?? 1)) continue;
    if (!fitsSlotChords(moved, ctx)) continue;
    accepted.push({
      offset,
      fragment: moved,
      rank: cadenceRank(moved.endDeg, opts.endDegrees),
      order: i,
    });
  }
  if (accepted.length === 0) return null;
  accepted.sort((x, y) => x.rank - y.rank || x.order - y.order);
  const chosen = accepted[0];
  return { offset: chosen.offset, fragment: attachFitSus(chosen.fragment, ctx.mode) };
}

/**
 * ゼクエンツが作れないときの代替。a と同じリズム型の別の断片なら、
 * 音形は違っても「同じ歌の続き」に聴こえる。
 *
 * 拍と長さの完全一致を先に、無ければ打点だけの一致を探す。
 * フィルタは厳しい順に緩めていく（リズムが揃うことのほうが、緊張度の一致より効く）。
 *
 * 求める終止（ctx.endDegrees の第1段）に届かないうちは、緩いレベルや
 * 打点だけの一致まで探し続ける。いちばん厳しい組み合わせで見つかった1つは
 * 控えに取っておき、どこまで探しても終止が揃わなければそれを返す。
 * リズム一致の候補は平均5件しかなく、最初の1組で打ち切ると
 * 「閉じる」べき楽節が閉じられないまま終わる率が高い（実測でここが効いた）。
 */
export function phraseTwin(anchor, melodies, ctx) {
  const key = rhythmKey(anchor);
  if (!key) return null;
  const onsets = onsetKey(anchor);
  const pool = Array.isArray(melodies) ? melodies : [];
  const wanted = Array.isArray(ctx.endDegrees) ? ctx.endDegrees[0] : null;
  let strictest = null;
  for (const level of [3, 2, 1]) {
    const candidates = pool.filter((m) => m.id !== anchor.id && passesFilters(m, ctx, level));
    if (candidates.length === 0) continue;
    for (const matcher of [(m) => rhythmKey(m) === key, (m) => onsetKey(m) === onsets]) {
      const matches = candidates.filter(matcher);
      if (matches.length === 0) continue;
      const chosen = narrowCandidates(matches, ctx)[0];
      if (!wanted) return chosen;
      if (wanted.includes(scaleDegreeOf(chosen.endDeg))) return chosen;
      if (strictest === null) strictest = chosen;
    }
  }
  return strictest;
}

// モチーフを再登場させるスロット。値は A（セクション0）のスロット番号。
//
// コピー元とコピー先はスロット番号を一致させる。スロット k は進行の (2k mod 4) 小節目
// から始まるので、番号がずれるとコードの位置までずれて適合しなくなる。
// 同じ番号なら、level 1 の転回形化（構成音は同じ）でも level 2 の終止差し替え
// （偶数スロットは進行の0,1小節目なので当たらない）でもコードが一致する。
function recallSource(sectionIdx, slotIdx, slots) {
  if (sectionIdx === 1 && slotIdx === 0) return 0;
  if (sectionIdx === 3) {
    if (slotIdx === 0) return 0;
    // slots は 2 / 4 / 8。slots-2 は 0 / 2 / 6 で必ず偶数。
    // slots===2 のときは 0 と衝突するので、A'' の再登場は頭の1回だけにする。
    if (slots >= 3 && slotIdx === slots - 2) return slots - 2;
  }
  return null;
}

// 再登場する断片は接続・起伏のフィルタを免除する（もう決まった旋律なので選び直さない）。
// ただしコード適合だけは検査する。移動先の和音とぶつかったままでは「再会」にならない。
function resolveRecall(src, melodies, ctx) {
  if (!src) return null;
  if (fitsChords(src, ctx)) return src;
  // 輪郭と歌い出しが同じ断片なら、聴感上は「同じモチーフ」として通る。
  // ただし代替は「選び直し」なので音高の天井だけは守らせる。
  // ここを免除すると代替がクライマックスの最高音に並び、頂点の一回性が壊れる。
  const pool = Array.isArray(melodies) ? melodies : [];
  for (const m of pool) {
    if (m.contour !== src.contour || m.startDeg !== src.startDeg) continue;
    if (m.peakDeg > ctx.maxPeak) continue;
    if (fitsChords(m, ctx)) return m;
  }
  return null;
}

function chooseTonic(rng, musicKey) {
  if (musicKey !== 'random') {
    const pc = Number(musicKey);
    // 高すぎるキーはメロディーが上ずるので、上半分は1オクターブ下げる。
    if (Number.isFinite(pc)) return 60 + (pc > 6 ? pc - 12 : pc);
  }
  return 60 + randInt(rng, -4, 3);
}

/**
 * 進行の重み。人気度そのものではなく2乗を使う。
 * 一様に引くと有名進行もマニアックな変形も同じ確率で出て、全体が「よくある感じ」に
 * ならない。2乗なら定番(5)と色物(1)で25倍の差がつき、差が体感できる。
 * popularity を持たないデータは 3（真ん中）として扱う。
 */
export function progressionWeight(prog) {
  const raw = Number(prog?.popularity);
  const pop = Number.isFinite(raw) ? clamp(Math.round(raw), 1, 5) : 3;
  return pop * pop;
}

// 重み付き抽選。rng の消費は pick と同じ1回だけなので決定論性は変わらない。
function pickWeighted(rng, items, weightOf) {
  let total = 0;
  for (const it of items) total += weightOf(it);
  if (!(total > 0)) return pick(rng, items);
  let r = rng() * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r < 0) return it;
  }
  return items[items.length - 1];
}

function chooseProgressions(rng, progressions, mode) {
  const pool = (Array.isArray(progressions) ? progressions : []).filter(
    (p) => p?.mode === mode
      && Array.isArray(p.bars) && p.bars.length === 4
      && p.bars.every((b) => chordIndex(mode, b?.chord) >= 0),
  );
  if (pool.length === 0) {
    const d = DEFAULT_PROGRESSION[mode];
    return [d, d];
  }
  const first = pickWeighted(rng, pool, progressionWeight);
  let second = pickWeighted(rng, pool, progressionWeight);
  // A系とBが同じ進行では「よそへ行った」感が出ない。ただしプールが1件なら諦める。
  for (let i = 0; i < 8 && pool.length > 1 && second.id === first.id; i++) {
    second = pickWeighted(rng, pool, progressionWeight);
  }
  return [first, second];
}

// 埋め音が音高の窓を越えないよう、オクターブ（度数7つ）単位で下げる。
// 断片そのものは maxPeak で選ばれているが、埋め音は「いちばん近い和声音」なので
// 窓の外へ出ることがある。転調したセクションではその1音が頂点に並びうる。
function capDegree(deg, maxPeak) {
  const cap = Number.isFinite(maxPeak) ? maxPeak : DEG_MAX;
  let d = deg;
  while (d > cap && d - 7 >= DEG_MIN) d -= 7;
  return d;
}

// 断片をスロットの拍位置へ写す。片方の小節が空なら和声音で埋める。
//
// 主音は**小節ごと**に受け取る。転調のつなぎ目（B の最終小節）だけは、
// スロットの後半の小節から新しい調になるため、2小節で主音が変わる。
function slotMelodyNotes(fragment, ctx, slotStartBeat, barTonics) {
  const { mode, chordA, chordB } = ctx;
  const tonics = Array.isArray(barTonics) ? barTonics : [barTonics, barTonics];
  const notes = [];
  const filled = [false, false];
  for (const n of fragment.notes ?? []) {
    const beat = Number(n.beat) || 0;
    const bar = beat < 4 ? 0 : 1;
    filled[bar] = true;
    notes.push({
      midi: degToMidi(n.deg, mode, tonics[bar]),
      beat: slotStartBeat + beat,
      dur: n.dur,
      vel: n.vel * MELODY_VEL_SCALE,
    });
  }
  const chords = [chordA, chordB];
  const around = [fragment.startDeg ?? 5, fragment.endDeg ?? 5];
  for (let b = 0; b < 2; b++) {
    if (filled[b]) continue;
    const deg = capDegree(nearestChordToneDeg(chords[b], mode, around[b]), ctx.maxPeak);
    notes.push({
      midi: degToMidi(deg, mode, tonics[b]),
      beat: slotStartBeat + b * 4,
      dur: 4,
      vel: FILL_VEL * MELODY_VEL_SCALE,
    });
  }
  notes.sort((a, b) => a.beat - b.beat);
  return notes;
}

// 掛留を検査するときに「表に出ている」とみなす旋律音。
// 小節の強拍にあるか、1.5拍以上伸びる音。fitsBar が非和声音に解決を要求するのと
// 同じ条件で、要するに聴き手が旋律として聴き取る音のこと。
const EXPOSED_DUR = 1.5;

/**
 * 持続音（パッド）から、その小節の旋律と半音でぶつかる音を落とす。
 *
 * 強拍の半音衝突は実測で強拍の20.1%あるが、その80%は非和声音で、
 * さらにその99%は次の音へ順次解決している。つまり掛留であり、
 * このプログラムが狙って作っている「陰り」そのものなので触ってはいけない。
 *
 * 潰すべきなのは残りの、旋律が和声音なのに濁っている4.0%のほう。
 * 主犯は4拍伸びるパッドで、たとえば IM7 の第7音は主音の半音下にあり、
 * 旋律が主音を歌うあいだ鳴り続けると、解決しないまま唸り続ける。
 * アルペジオなら一瞬で消えるが、持続音は消えない。だからパッドだけを削る。
 *
 * 2音を切るところまでは削らない（和音が和音でなくなる）。
 */
export function withoutRub(midis, melody, bar) {
  const from = bar * 4;
  const exposed = [];
  for (const n of melody) {
    if (n.beat < from || n.beat >= from + 4) continue;
    if (n.beat % 2 === 0 || n.dur >= EXPOSED_DUR) exposed.push(n.midi);
  }
  if (exposed.length === 0) return midis;
  const rubs = (m) => exposed.some((x) => {
    const d = (((m - x) % 12) + 12) % 12;
    return d === 1 || d === 11;
  });
  const kept = midis.filter((m) => !rubs(m));
  return kept.length >= 2 ? kept : midis;
}

/**
 * その小節で伴奏とパッドが越えてはいけない高さ。
 * 旋律の最低音から LAYER_GAP ぶん下。旋律が休んでいる小節は制限しない。
 */
export function melodyCeiling(melody, bar) {
  const from = bar * 4;
  let low = Infinity;
  for (const n of melody) {
    if (n.beat < from || n.beat >= from + 4) continue;
    if (n.midi < low) low = n.midi;
  }
  return low === Infinity ? NO_MELODY_CEILING : low - LAYER_GAP;
}

/**
 * 和音を、天井の下へ収まる位置に置く。
 *
 * !!! 音名は絶対に変えない !!! 動かしてよいのはオクターブ単位の移動と、
 * 上の音を鳴らさないこと（省略）の2つだけ。半音単位で押し込むと、
 * その和音は別の和音になってしまう（nearestOctave は範囲が12半音を切ると
 * 音名を変える丸め方をするので、天井の計算に直接は使えない）。
 *
 * 手順は上から順に、効き目の大きい順:
 *   1. 声部進行のために、前の小節に近いオクターブを選ぶ
 *   2. 天井を越えていたら、下限に触れるまでオクターブ単位で下げる
 *   3. それでも越えるなら、越える音を上から鳴らさない（最低2音は残す）
 *
 * 3 で薄くなるのは許容する。旋律が埋もれるほうが害が大きく、
 * 和音の性格は残った音とベースとパッドが受け持つ。
 *
 * 下限は2つある。prefLo は「普段いてほしい音域の下端」で、floor は
 * 「旋律を避けるためなら、ここまでは降りてよい」という限界。分けておかないと、
 * 旋律が低く歌う小節で伴奏が降りられず、旋律の上に取り残される。
 *
 * @param {number[]} midis chordVoicing の戻り値（昇順）
 * @param {number|null} prev 直前の小節の最低音。無ければ null
 * @param {number} prefLo 普段の下限（声部進行はこの範囲で選ぶ）
 * @param {number} hi 最低音の上限
 * @param {number} ceiling 最高音がこれを越えないようにする
 * @param {number} floor 天井を避けるために降りてよい限界
 */
export function placeUnder(midis, prev, prefLo, hi, ceiling, floor = prefLo) {
  const span = midis[midis.length - 1] - midis[0];
  // 候補はオクターブ移動だけ。nearestOctave は範囲が12半音を切ると
  // 端へ丸めて音名を変えてしまうので、ここでは使わない。
  let best = null;
  for (let k = -4; k <= 4; k++) {
    const base = midis[0] + 12 * k;
    if (base < floor) continue;
    // 重みの順がそのまま優先順位。天井を守ることが最優先で、
    // 普段の音域も声部進行も、そのあとで効かせる。
    const over = Math.max(0, base + span - ceiling);
    const outside = base < prefLo ? prefLo - base : base > hi ? base - hi : 0;
    const move = prev === null ? 0 : Math.abs(base - prev);
    const score = over * 1000 + outside * 10 + move;
    if (!best || score < best.score) best = { base, score };
  }
  if (!best) return midis.slice();
  let out = midis.map((m) => m + (best.base - midis[0]));
  // それでも越えるなら、越える音を上から鳴らさない（最低2音は残す）。
  while (out.length > 2 && out[out.length - 1] > ceiling) out = out.slice(0, -1);
  return out;
}

/**
 * 小節ごとの和音を、実際に鳴っている高さで書き出す。楽譜のコードネームの材料。
 * 記号（I / vi / iv）ではなく実音から作るので、転回形も転調もそのまま名前に出る。
 */
function describeChords(barInfo) {
  const out = [];
  for (const info of barInfo) {
    if (!info) continue;
    const pcOf = (midi) => (((Math.round(midi) % 12) + 12) % 12);
    out.push({
      bar: info.bar,
      symbol: info.symbol,
      rootPc: pcOf(info.rootMidi),
      bassPc: pcOf(info.bassNote),
      pcs: [...new Set(info.voicing.map(pcOf))].sort((a, b) => a - b),
    });
  }
  return out;
}

/**
 * シードと事前データから1曲を組み立てる。
 * 同じ seed・同じ作曲パラメータなら、何度呼んでも完全に同じ曲になる。
 *
 * @param {string} seed
 * @param {{ melodies: Fragment[], progressions: Progression[] }} data
 * @param {object} settings 作曲系の設定（欠けたキーは settings.js の既定値で埋まる）
 */
export function composeSong(seed, data, settings) {
  const cfg = normalizeSettings(settings);
  const rng = makeRng(seedFromString(String(seed)));

  const bars = Number(cfg.songBars);
  const barsPerSection = bars / 4;
  const repeats = barsPerSection / 4;
  const slotCount = barsPerSection / 2;
  const cs = climaxSlot(slotCount);
  const roles = phraseRoles(slotCount);
  const strength = clamp(cfg.curveStrength / 100, 0, 1);

  // ここから下の乱数の消費順は変えない：
  // mode → tempo → tonic → 転調するか → 上げ幅 → P1 → P2 → 各スロット。
  const mode = rng() * 100 < cfg.majorRatio ? 'major' : 'minor';
  const tempo = randInt(rng, cfg.tempoMin, cfg.tempoMax);
  const tonicMidi = chooseTonic(rng, cfg.musicKey);

  // 転調の抽選。転調しない曲でも上げ幅を必ず引く（曲によって乱数の消費数が変わると、
  // 転調の有無だけで進行や断片の選択までずれてしまう）。
  const modulates = rng() * 100 < MODULATION_CHANCE;
  const modStep = chooseModulationStep(rng, tonicMidi, mode);
  const semitones = modulates ? modStep : 0;
  const modTonic = tonicMidi + semitones;
  const modBar = MODULATION_SECTION * barsPerSection;
  // つなぎ目の属和音は B の最終小節に置く。ただしその小節がクライマックスの
  // スロットに入るとき（16小節の曲）は置かない。スロットは2小節ひとかたまりなので、
  // 後半だけ調が変わると、頂点の音と後半の別の音が**同じ高さ**になりうる
  // （長調 +2 なら deg12=19半音 と deg11+2=19半音）。それは
  // 「曲中の最高音がちょうど1回」を壊す。つなぎ目より頂点の一回性が上。
  // 置かない曲は、A'' の頭（A のモチーフ＝拍0から始まる断片）が代わりに境目を示す。
  // つなぎ目に使える属和音。語彙に無ければつなぎ目は置かず、A'' の頭で調を切り替える。
  const pivotChord = PIVOT_CHORDS.find((sym) => chordIndex(mode, sym) >= 0) ?? null;
  const pivots = semitones !== 0 && climaxSlot(slotCount) !== slotCount - 1 && pivotChord !== null;
  const pivotBar = pivots ? modBar - 1 : null;
  // 転調した調で許す頂点度数の上限（クライマックスに並ばない最大値）。
  const modPeakCap = modulatedPeakCap(semitones, mode);
  // 小節ごとの主音。新しい調はつなぎ目の属和音（無ければ A'' の頭）から始まる。
  const keyChangeBar = pivots ? pivotBar : modBar;
  const tonicAtBar = (bar) => (semitones !== 0 && bar >= keyChangeBar ? modTonic : tonicMidi);

  const melodies = Array.isArray(data?.melodies) ? data.melodies : [];
  const sources = chooseProgressions(rng, data?.progressions, mode);

  const sections = [];
  const barInfo = [];      // 小節ごとの主音と和音。音階スタイルを掛けるときに引く
  const melody = [];
  const accomp = [];
  const bass = [];
  const pad = [];
  const motif = [];        // A で選ばれた断片（再登場のコピー元）
  const breathSlots = [];  // 息継ぎを置ける「A / A' のフレーズ末スロット」
  let prevEndDeg = null;   // 直前の断片の終わりの音。曲の最初だけ null
  let prevBass = null;     // 直前の小節のベース音（声部進行用。曲をまたいで持ち越さない）
  let prevAccomp = null;   // 直前の小節の伴奏和音の最低音

  for (let s = 0; s < SECTION_PLAN.length; s++) {
    const plan = SECTION_PLAN[s];
    const prog = varyProgression(sources[plan.source], plan.level);
    const startBar = s * barsPerSection;

    // 4小節の進行を repeats 回まわしてセクションの長さにする。
    const barChords = [];
    for (let r = 0; r < repeats; r++) for (const b of prog.bars) barChords.push(b.chord);

    // つなぎ目。B の最終小節を、新しい調のドミナントに差し替える。
    // 記号は新しい調から見た V7（または V）で、その小節だけ新しい主音で描くので、
    // 断片の適合判定（fit は主音からの相対度数）はそのまま通る。
    // 差し替えは断片を選ぶ**前**に済ませること。あとから和音だけ替えると
    // メロディーが和音に乗らなくなる。
    if (pivots && s === MODULATION_SECTION - 1) {
      barChords[barChords.length - 1] = pivotChord;
    }

    // このセクションを描く主音。A'' だけが新しい調（B の最終小節は下の tonicAtBar）。
    const sectionTonic = s === MODULATION_SECTION ? modTonic : tonicMidi;

    // このセクションのフレーズの区切り方。ここで rng を1〜2回消費する。
    const phrasing = phrasePlan(rng, slotCount);
    const isPhraseEnd = phraseEndFlags(phrasing, slotCount);

    const slotRecords = [];
    const slotFragments = [];   // このセクションで実際に使った断片（導出のコピー元）
    const phraseOffset = [];    // 楽節ごとに a' が使った平行移動量（a'' で避ける）
    for (let k = 0; k < slotCount; k++) {
      const chordA = barChords[2 * k];
      const chordB = barChords[2 * k + 1];
      const curve = curveFor(s, k, slotCount, strength);
      const isClimax = s === 2 && k === cs;
      const role = roles[k];
      const anchor = role.anchor === null ? null : slotFragments[role.anchor];
      // セクションの頭と頂点だけは跳躍を許す（新しい息継ぎ、あるいは意図した飛翔）。
      const allowLeap = k === 0 || isClimax;
      // 陰りのコードが鳴るスロットと、偽終止で閉じそこねる最後の小節。
      // 進行の最終小節はスロットの後半（chordB）にしか来ない（2k は必ず偶数）。
      const deceptiveEnd = prog.cadence === 'deceptive'
        && (2 * k + 1) % prog.bars.length === prog.bars.length - 1;
      const dark = isDarkChord(chordA) || isDarkChord(chordB) || deceptiveEnd;

      // 転調した調で鳴るスロットは、天井を「クライマックスに並ばない高さ」まで下げる。
      //  - A''            … まるごと新しい調
      //  - B の最終スロット … 後半の小節（つなぎ目の属和音）だけ新しい調
      //  - A の再登場元スロット … 断片をそのまま A'' へ持っていくので、
      //    A'' 側の天井を通らない。ここで下げておかないと +2 で頂点に並ぶ。
      const inNewKey = s === MODULATION_SECTION
        || (pivots && s === MODULATION_SECTION - 1 && k === slotCount - 1);
      const recalledLater = cfg.motifRecall && s === 0
        && recallSource(MODULATION_SECTION, k, slotCount) !== null;
      const maxPeak = semitones !== 0 && (inNewKey || recalledLater)
        ? Math.min(curve.maxPeak, modPeakCap)
        : curve.maxPeak;

      const ctx = {
        mode,
        chordA,
        chordB,
        chordAIdx: chordIndex(mode, chordA),
        chordBIdx: chordIndex(mode, chordB),
        prevEndDeg,
        tension: curve.tension,
        maxPeak,
        minPeak: curve.minPeak,
        maxLeap: allowLeap ? cfg.maxLeap + 4 : cfg.maxLeap,
        // 頂点の直前と、陰りのコードの上。掛留（非和声音が順次下降で解決する形）が
        // iv / bVI / bVII の上で鳴ると陰りが最大限に効く。
        // クライマックスだけは音域と単一頂点の条件が優先なので、ここでは立てない。
        preferSus: (s === 2 && k === cs - 1) || (dark && !isClimax),
        susOverPenta: dark && !isClimax,
        soloPeak: isClimax && strength > 0,
        // 頂点へは「跳び上がって届き、順次で降りる」。peakDeg >= 12 と peakCount === 1 は
        // 必須のまま、その中でこの形を持つ断片を優先する（無ければ従来どおり）。
        preferSoar: isClimax,
        // 頂点は「そこで初めて届いた音」が最優先。ペンタトニックに寄せると
        // かえって頂点が埋もれるので、ここだけは絞らない。
        preferPenta: !isClimax,
        // 楽節計画。フレーズ末なら閉じ、途中なら閉じずに次の小節へ流し込む。
        phraseEnd: isPhraseEnd[k],
        // 楽節の a（この断片が a' / a'' へ移調される）かどうか。
        isAnchor: role.anchor === null,
        // b は a と違う輪郭にして対比を作る。
        avoidContour: role.name === 'b' && anchor ? anchor.contour : null,
        // 楽節のどこにいるかで終わり方を変える（問いかけ／答え／締め）。
        endDegrees: CADENCE_BY_ROLE[role.name] ?? null,
        // 曲の1音目。ここだけは拍0から始めて、拍の位置を最初に示す。
        // つなぎ目の属和音を置けない転調（16小節の曲）では A'' の頭も拍0から。
        // 弱起のまま調だけ半音上がると、どこから新しい調になったのか耳が掴めない。
        preferDownbeat: (s === 0 && k === 0)
          || (semitones !== 0 && !pivots && s === MODULATION_SECTION && k === 0),
        // B の頂点までの楽節の頭（a）だけ、天井から3度ぶん余白を残す。
        // 登る距離がいちばん長いのが B で、ここが詰むとクライマックスへ辿り着かない。
        // 実測では、この余白の有無で B のゼクエンツの平均移動量が +0.3〜+0.6 変わる
        // （＝出だしが天井に着いていると、上に動かせる量がそのぶん消える）。
        headroom: role.anchor === null && s === 2 && k < cs ? maxPeak - 3 : null,
      };

      let fragment = null;
      let reusedFrom = null;
      let derivedFrom = null;
      let offset = null;
      let source = 'select';

      // 1. セクションをまたぐモチーフの再登場（最優先）
      const srcIdx = cfg.motifRecall ? recallSource(s, k, slotCount) : null;
      if (srcIdx !== null) {
        const resolved = resolveRecall(motif[srcIdx], melodies, ctx);
        if (resolved) {
          fragment = resolved;
          reusedFrom = `${SECTION_NAMES[0]}:${srcIdx}`;
          source = 'recall';
        }
      }

      // 2. 楽節内のゼクエンツ（a' / a''）。
      //    クライマックスだけは楽節構造より音高の条件を優先して通常選択に回す。
      if (!fragment && role.derive && anchor && !isClimax) {
        // セクションごとに向きの違う優先順を使う（A は少しだけ上、A' と B は上、A'' は下）。
        const offsets = phraseOffsets(s, role.name);
        const closing = role.name === "a''";
        // 平行移動量を終止で並べ替えるのは、締めくくる a'' だけにする。
        // a' の「1/3/5 で答える」は3度数ぶんと広く、これを方向より優先させると
        // 採る量がほぼ終止だけで決まってしまい、A→A' の上昇が実測で消えた。
        const endDegrees = closing ? ctx.endDegrees : null;
        // a'' が a' と同じ移動量では、同じコードの上に同じものが並ぶ。
        const exclude = closing ? phraseOffset[role.anchor] : null;
        const opts = { offsets, endDegrees };
        let derived = deriveFragment(anchor, ctx, { ...opts, exclude });
        // 3. 移調では乗らないとき。同じリズム型の別の断片で「続き」に聴かせる。
        let twin = derived ? null : phraseTwin(anchor, melodies, ctx);
        // 3'. a'' は閉じるための楽節。移調がトニックに着地できないなら、
        //     着地できるリズム一致の断片のほうを採る。ここだけは「同じ音形」より
        //     「閉じること」が上。閉じ損なった楽節は、次のセクションへ雪崩れ込む。
        if (closing && derived && !closesOnTonic(derived.fragment, ctx)) {
          const alt = phraseTwin(anchor, melodies, ctx);
          if (alt && closesOnTonic(alt, ctx)) {
            derived = null;
            twin = alt;
          }
        }
        // 4. それも無ければ、最後にもう一度だけ移調を試す。
        //    避けていた移動量（a' と同じ量）も、向きの表に無い量（±4以上やオクターブ）も
        //    ここでは許す。a' の繰り返しや向きの乱れは痛いが、ここで諦めると
        //    楽節が無関係な断片に置き換わって「同じ歌が続いている」感覚ごと消える。
        //    表の量を先頭に残すので、乗るなら向きのある量が優先されるのは変わらない。
        if (!derived && !twin) {
          derived = deriveFragment(anchor, ctx, { offsets: phraseOffsets(s, role.name, true), endDegrees });
        }
        if (derived) {
          fragment = derived.fragment;
          derivedFrom = role.anchor;
          offset = derived.offset;
          source = 'transpose';
          if (role.name === "a'") phraseOffset[role.anchor] = derived.offset;
        } else if (twin) {
          fragment = twin;
          derivedFrom = role.anchor;
          source = 'rhythm';
        }
      }

      // 5. 通常選択
      if (!fragment) {
        fragment = selectFragment(rng, melodies, ctx);
        source = fragment.id === 'fallback' ? 'fallback' : 'select';
      }
      slotFragments[k] = fragment;
      if (s === 0) motif[k] = fragment;

      const slotStartBeat = (startBar + 2 * k) * 4;
      const slotTonics = [tonicAtBar(startBar + 2 * k), tonicAtBar(startBar + 2 * k + 1)];
      for (const n of slotMelodyNotes(fragment, ctx, slotStartBeat, slotTonics)) melody.push(n);

      slotRecords.push({
        fragmentId: fragment.id,
        reusedFrom,
        role: role.name,
        derivedFrom,
        offset,
        source,
        phraseEnd: isPhraseEnd[k],
        breath: false,
      });
      prevEndDeg = fragment.endDeg;

      // 息継ぎを置ける場所を控えておく。実際に置くのは全セクションを組んだあと。
      //  - A / A' のフレーズ末スロット（＝もともと息が切れる場所）
      //  - 曲の最初と最後のスロットは避ける（出だしと終止は削らない）
      //  - クライマックスのスロットとその前後は避ける（頂点の周りは削らない）
      //  - 再登場のスロットは避ける（モチーフを欠けた形で帰らせない）
      const globalSlot = s * slotCount + k;
      const climaxGlobal = 2 * slotCount + cs;
      if (BREATH_SECTIONS.includes(s) && isPhraseEnd[k]
        && globalSlot > 0 && globalSlot < 4 * slotCount - 1
        && Math.abs(globalSlot - climaxGlobal) > 1
        && source !== 'recall') {
        breathSlots.push({ sectionIdx: s, slotIdx: k, bar: startBar + 2 * k + 1 });
      }
    }

    for (let b = 0; b < barChords.length; b++) {
      const chord = barChords[b];
      const beat = (startBar + b) * 4;
      const isFinalBar = startBar + b === bars - 1;
      // 主音は小節ごと。A'' と、つなぎ目の属和音の小節だけが新しい調で鳴る。
      const barTonic = tonicAtBar(startBar + b);
      // ベースは直前の小節にいちばん近いオクターブへ。
      // これで I - V/3 - vi - I/5 が7度跳ね上がらずに素直に下降する。
      const bassRaw = bassMidi(chord, mode, barTonic, BASS_LOWEST);
      const bassNote = nearestOctave(bassRaw, prevBass, BASS_RANGE);
      prevBass = bassNote;
      bass.push({ midi: bassNote, beat, dur: 4, vel: BASS_VEL });

      // 転回形では最低音が根音とは限らないので、根音は記号から取り直す。
      const rootMidi = barTonic + chordSemitones(chord, mode)[0];
      // その小節で旋律がいちばん低いところ。伴奏とパッドはこれより下に置く。
      const ceiling = melodyCeiling(melody, startBar + b);

      // 伴奏の和音も、前の小節の和音に近いオクターブへ寄せる（形は変えず全体を移す）。
      // 下限はベースの1つ上まで。層（ベース < 伴奏 <= パッド）が入れ替わると土台が濁る。
      const raw = chordVoicing(chord, mode, barTonic, ACCOMP_LOWEST);
      const accompLo = Math.max(ACCOMP_RANGE[0], bassNote + 1);
      // 旋律が低く歌う小節では、普段の音域を割ってでもその下へ降りる。
      // 降りる限界はベースと同じ高さまで。同じ音を重ねるのは左手の普通の書き方で、
      // 土台が入れ替わるのは「ベースより下へ潜る」ときだけ。ここを1つ上に
      // 締めると、旋律が低い小節で伴奏が降りられず、実測で8%が旋律の上に残った。
      const accompFloor = Math.min(accompLo, bassNote);
      const voicing = placeUnder(raw, prevAccomp, accompLo, ACCOMP_RANGE[1], ceiling, accompFloor);
      prevAccomp = voicing[0];
      // パッドは伴奏と同じ和音を、伴奏の上に薄く重ねる持続音。
      const padVoicing = withoutRub(
        placeUnder(chordVoicing(chord, mode, barTonic, PAD_LOWEST),
          null, voicing[0], ACCOMP_RANGE[1], ceiling, voicing[0]),
        melody, startBar + b);
      // 楽譜のコードネームの材料。実際に鳴る積み方（voicing）から名前を作る。
      barInfo[startBar + b] = {
        bar: startBar + b,
        symbol: chord,
        tonicMidi: barTonic,
        rootMidi,
        // コードネームは「実際に鳴っている音の集まり」から作る。
        // 天井に収めるために伴奏の上の音を省いた小節でも、パッドが持っていれば
        // 和音としては鳴っているので、両方を合わせて名前を決める。
        voicing: [...new Set([...voicing, ...padVoicing])].sort((x, y) => x - y),
        bassNote,
      };
      pad.push({
        midis: padVoicing,
        beat,
        dur: isFinalBar ? FINAL_PAD_DUR : 4,
        vel: PAD_VEL,
      });
      if (isFinalBar) {
        // 刻みをやめて和音を置く。midi は単音しか読まない再生系のための代表音で、
        // 実際に鳴らしたい全構成音は midis に入れる。
        accomp.push({
          midi: voicing[0], midis: voicing.slice(), beat, dur: 4, vel: FINAL_ACCOMP_VEL,
        });
        continue;
      }
      for (let i = 0; i < ACCOMP_OFFSETS.length; i++) {
        const at = ACCOMP_OFFSETS[i];
        accomp.push({
          midi: voicing[arpeggioIndex(i, voicing.length)],
          beat: beat + at,
          // 最後の8分だけは小節線で切る。ACCOMP_DUR はペダルのように隣と重ねる
          // ための長さだが、小節の終わりでそれをやると前の和音が次の小節へ
          // 0.25拍はみ出す。和音が変わったところへ古い和音が残るので、
          // 強拍の半音衝突の27%がここから出ていた。
          dur: Math.min(ACCOMP_DUR, BEATS_PER_BAR - at),
          vel: ACCOMP_VEL,
        });
      }
    }

    sections.push({
      name: SECTION_NAMES[s],
      progressionId: prog.id,
      startBar,
      tonicMidi: sectionTonic,
      phrasePlan: phrasing,
      slots: slotRecords,
    });
  }

  // 息継ぎ。1曲に最大1回、A か A' のフレーズ末スロットの2小節目から
  // メロディーだけを抜く。伴奏・ベース・パッドは鳴り続けるので音楽は止まらない。
  // 歌い手が息を吸う一瞬で、バラードではここが「歌っている」感覚そのものを作る。
  let breathBar = null;
  if (breathSlots.length > 0) {
    const chosen = pick(rng, breathSlots);
    const from = chosen.bar * 4;
    const kept = melody.filter((n) => n.beat < from || n.beat >= from + 4);
    // メロディーが丸ごと消える異常な場合は諦める（無音の曲は作らない）。
    if (kept.length > 0 && kept.length < melody.length) {
      melody.length = 0;
      for (const n of kept) melody.push(n);
      breathBar = chosen.bar;
      sections[chosen.sectionIdx].slots[chosen.slotIdx].breath = true;
    }
  }

  const chords = describeChords(barInfo);

  // 頂点の拍。演奏側はここだけテヌートを掛けるので、同点なら最初の1つを指す。
  let climaxBeat = 0;
  let highest = -Infinity;
  for (const n of melody) {
    if (n.midi > highest) {
      highest = n.midi;
      climaxBeat = n.beat;
    }
  }

  // 頂点を越えたら、素材の側からも確実に下げる。上げて、頂点で解放し、下りてくる。
  for (const n of melody) {
    const d = n.beat - climaxBeat;
    if (d <= 0 || d >= RELEASE_BEATS) continue;
    n.vel *= RELEASE_FLOOR + (1 - RELEASE_FLOOR) * (d / RELEASE_BEATS);
  }

  // 曲の最後の1音だけは、断片の形より終止を優先する。
  //
  //  1. 最終小節の終わりまで伸ばす。断片の最後の音は8分や4分のことが多く、
  //     そのまま鳴らすと1拍で切れて、曲が終わらずに次の曲へなだれ込む。
  //  2. 主音へ着地させる。転調した曲では**新しい調の**主音（＝最終セクションの主音）。
  //     断片プールの側で主音に終われる断片が用意できるのは
  //     全スロットの7割弱が上限で、選択だけでは「終わった」と聴こえる曲にならない。
  //     長く伸びた主音の上に主和音（varyProgression level 2 の最終小節）が鳴る、
  //     この一致が終止感そのものなので、ここは1音だけ書き換える。
  //     上の頂点より高くはしない（曲中の最高音が一度だけ、という保証を壊さないため）。
  if (melody.length > 0) {
    let last = 0;
    for (let i = 1; i < melody.length; i++) if (melody[i].beat >= melody[last].beat) last = i;
    const tail = melody[last];
    tail.dur = Math.max(FINAL_NOTE_MIN_DUR, bars * 4 - tail.beat);
    const below = modTonic + 12 * Math.floor((tail.midi - modTonic) / 12);
    const above = below + 12;
    const near = tail.midi - below <= above - tail.midi ? below : above;
    tail.midi = near < highest ? near : below;
  }

  return {
    seed,
    mode,
    // 楽器。音そのものは楽器を知らないが、書き出し（MIDI の音色）はこれを見る。
    instrument: cfg.instrument,
    tonicMidi,
    tempo,
    bars,
    totalBeats: bars * 4,
    climaxBeat,
    breathBar,
    // 転調しない曲は null。転調する曲は A'' の頭（atBar）で主音が semitones ぶん上がる。
    // pivotBar はその1小節前＝新しい調のドミナントに差し替えた「つなぎ目」の小節。
    // この小節も既に新しい調で鳴っている（記譜の調号を変えるならこの小節から）。
    // 16小節の曲は頂点のスロットと重なるので置かない（そのとき pivotBar は null）。
    modulation: modulates
      ? {
        atBar: modBar,
        semitones,
        fromTonicMidi: tonicMidi,
        toTonicMidi: modTonic,
        pivotBar,
        pivotChord,
      }
      : null,
    sections,
    // 小節ごとの和音を実音で書き出したもの。楽譜のコードネームがこれを読む。
    chords,
    melody,
    accomp,
    bass,
    pad,
  };
}
