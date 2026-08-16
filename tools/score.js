// 断片の「美しさスコア」。
// 減点＝歌いにくさ・粗さ（安全性）、加点＝情動的な魅力。
// 減点だけだと「無難だが泣けない」断片ばかりが上位に来るため、加点側が本体。

import { analyzeFragment } from './analyze.js';

const round1 = (v) => Math.round(v * 10) / 10;

const BONUS = {
  sigh: 14,
  'inner-motif': 12,
  'long-ending': 8,
  'single-peak': 8,
  'resolve-down': 6,
};

export function scoreFragment(notes, meta) {
  const list = Array.isArray(notes) ? notes : [];
  const m = meta || analyzeFragment(list);
  const intervals = Array.isArray(m.intervals) ? m.intervals : [];
  const tags = Array.isArray(m.tags) ? m.tags : [];

  let score = 50;

  // --- 減点（安全性） ---
  for (let i = 0; i < intervals.length; i++) {
    const cur = intervals[i];
    const a = Math.abs(cur);

    if (a >= 3) score -= (a - 2) * 3;
    if (a === 0) score -= 2;

    const prev = intervals[i - 1];
    if (prev !== undefined && Math.abs(prev) >= 3 && a >= 3) {
      score -= 10; // 跳躍の連続
      if (Math.sign(prev) === Math.sign(cur)) score -= 8; // 同方向ならさらに歌いにくい
    }
  }

  const span = Number.isFinite(m.span) ? m.span : 0;
  if (span > 12) score -= (span - 12) * 6;

  const density = Number.isFinite(m.density) ? m.density : 0;
  if (density > 0.9) score -= (density - 0.9) * 40;

  // --- 加点（情動） ---
  for (const tag of tags) {
    if (BONUS[tag]) score += BONUS[tag];
  }
  if (m.contour === 'arch') score += 5;

  return round1(score);
}
