// 断片の「美しさスコア」。
// 減点＝歌いにくさ・粗さ（安全性）、加点＝情動的な魅力。
// 減点だけだと「無難だが泣けない」断片ばかりが上位に来るため、加点側が本体。

import {
  analyzeFragment, distinctDurations, durationRatio, hasSyncopation, hasRest,
  stepRatioOf, thirdRatioOf, leapRatioOf, leapThenStepRatio,
} from './analyze.js';

const round1 = (v) => Math.round(v * 10) / 10;

const BONUS = {
  'inner-sequence': 18, // 後半が前半の平行移動 = 動機として成立している
  soar: 16, // 跳び上がって頂点に届き、順次で降りる = 「感動する瞬間」の形
  sigh: 14,
  'inner-repeat': 14, // 完全反復。最も強く記憶に残る
  'inner-motif': 12, // リズムだけの一致（上2つと重複して加算してよい）
  'stable-end': 10, // {1,3,5} への着地。歌が終わった感じはここで決まる
  'long-ending': 8,
  'single-peak': 8,
  'resolve-down': 6,
  'stable-start': 5,
};

// 名旋律125曲(1768音)のコーパス実測値に合わせた加減点。
// 度数差1 = 2度(順次進行), 2 = 3度, 3以上 = 4度以上。
//   順次進行 69.1% / 3度 18.3% / 4度以上 4.1% / 跳躍の直後が順次 62.4%
// 跳躍だらけも順次だらけも記憶に残らない。この帯に入るかどうかが「歌」の統計。
const STEP_RATIO = { min: 0.6, max: 0.8, bonus: 12 };
const THIRD_RATIO = { min: 0.1, max: 0.3, bonus: 8 };
// 4度以上がコーパスの2倍(10%)を超えたら、超えたぶんに比例して減点する。
const LEAP_RATIO = { max: 0.1, penalty: 60 };
// 「跳んだら順次で埋め戻す」。名旋律の大原則で、これが歌える線とそうでない線を分ける。
const LEAP_THEN_STEP = { min: 0.6, bonus: 10 };

// ペンタトニックは大衆性の核心なので最大の加点。
// {1,3,5} だけの断片は major/minor 両方のタグを持つが、加点は一度だけ。
const PENTA_BONUS = 16;

// 輪郭そのものへの加減点。wave はふらふらして覚えにくく、
// question は宙に浮いて終わるので歌として弱い。
const CONTOUR_ADJ = {
  arch: 5,
  wave: -6,
  question: -4,
};

// リズムの多様性。「音の長さが一定過ぎて全部童謡に聴こえる」を潰す本体。
// 音価が1種類の断片は、音程がどれだけ美しくても曲の一節にはならないので、
// 単独で最大の減点にする。
const RHYTHM_VARIETY = { 1: -22, 2: -8, 3: 6 };
const RHYTHM_VARIETY_MAX = 12; // 音価4種類以上
const DURATION_RATIO_BONUS = 8; // 最長 ÷ 最短 >= 3
const SYNCOPATION_BONUS = 8;
const REST_BONUS = 5;

// リズムの評価。meta に値があればそれを使い、無ければ音符から直接測る
// (タグの有無に依存させない。ここは選抜の中核なので取りこぼしを作らない)。
function rhythmScore(list, m) {
  const distinct = Number.isFinite(m.distinctDurations)
    ? m.distinctDurations
    : distinctDurations(list);
  const ratio = Number.isFinite(m.durationRatio) ? m.durationRatio : durationRatio(list);

  let score = 0;
  if (distinct >= 4) score += RHYTHM_VARIETY_MAX;
  else if (RHYTHM_VARIETY[distinct] !== undefined) score += RHYTHM_VARIETY[distinct];

  if (list.length > 0 && ratio >= 3) score += DURATION_RATIO_BONUS;
  if (hasSyncopation(list)) score += SYNCOPATION_BONUS;
  if (hasRest(list)) score += REST_BONUS;
  return score;
}

export function scoreFragment(notes, meta) {
  const list = Array.isArray(notes) ? notes : [];
  const m = meta || analyzeFragment(list);
  const intervals = Array.isArray(m.intervals) ? m.intervals : [];
  const tags = Array.isArray(m.tags) ? m.tags : [];

  let score = 50;

  // --- 減点（安全性） ---
  // 3度(度数差2)は名曲で最頻の跳躍なので減点しない。減点は4度以上から。
  for (let i = 0; i < intervals.length; i++) {
    const cur = intervals[i];
    const a = Math.abs(cur);

    if (a >= 4) score -= (a - 3) * 3;
    if (a === 0) score -= 2;

    const prev = intervals[i - 1];
    if (prev !== undefined && Math.abs(prev) >= 4 && a >= 4) {
      score -= 10; // 跳躍の連続
      if (Math.sign(prev) === Math.sign(cur)) score -= 8; // 同方向ならさらに歌いにくい
    }
  }

  // 音程の分布をコーパスの実測値と突き合わせる。
  if (intervals.length > 0) {
    const step = stepRatioOf(intervals);
    if (step >= STEP_RATIO.min && step <= STEP_RATIO.max) score += STEP_RATIO.bonus;

    const third = thirdRatioOf(intervals);
    if (third >= THIRD_RATIO.min && third <= THIRD_RATIO.max) score += THIRD_RATIO.bonus;

    const leap = leapRatioOf(intervals);
    if (leap > LEAP_RATIO.max) score -= (leap - LEAP_RATIO.max) * LEAP_RATIO.penalty;

    const filled = leapThenStepRatio(intervals);
    if (filled !== null && filled >= LEAP_THEN_STEP.min) score += LEAP_THEN_STEP.bonus;
  }

  const span = Number.isFinite(m.span) ? m.span : 0;
  if (span > 12) score -= (span - 12) * 6;

  // 密度 = 音数/8。8音=1.0、12音=1.5、16音=2.0。
  // 以前はここで「詰めると減点」していたが、それが選抜を薄い断片で埋め、
  // ピアノ曲でなくアンビエントの密度になっていた。スカスカを減点する側へ反転させる。
  const density = Number.isFinite(m.density) ? m.density : 0;
  if (density < 0.7) score -= (0.7 - density) * 30;
  if (density >= 0.9 && density <= 1.8) score += 10;
  if (density > 2.2) score -= (density - 2.2) * 25;

  // --- リズムの多様性（音価が均一なら童謡） ---
  score += rhythmScore(list, m);

  // --- 加点（情動・大衆性） ---
  for (const tag of tags) {
    if (BONUS[tag]) score += BONUS[tag];
  }
  if (tags.includes('penta-major') || tags.includes('penta-minor')) score += PENTA_BONUS;
  score += CONTOUR_ADJ[m.contour] ?? 0;

  return round1(score);
}
