#!/usr/bin/env node
// src/data/melodies.json を生成する。
//
// 「涙を流すほど美しい」ヒーリングBGMの中核データ、2小節メロディー断片999個のカタログ。
// 固定シードで大量の候補を作り、美しさスコアで評価し、層化抽出で999件を選ぶ。
// Math.random() は使わない(再実行すれば必ず同じ JSON になる)。
//
// 断片1件は「どのコードに乗るか」を事前計算して持つ。組み立て側(compose.js)は
// 進行のコードから逆引きで断片を選ぶので、この事前計算がないと実時間で組めない。
//
// 選抜は3段構え。
//   1. バケット      : 輪郭6 × 緊張度5 × 終止クラス2 = 60。上位だけ採ると
//                      似た優等生ばかりが並び、無限に聴けば必ず飽きる。
//   2. 目標(GOALS)   : 「ペンタトニックが400件以上」のような下限。
//                      スコア順に任せると必ずどれかが痩せるので、明示的に埋める。
//   3. 残りをスコア順: 上限(CAPS)を守りながら999件まで。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../src/rng.js';
import { CHORD_VOCAB, splitBars, fitsBar, hasSuspension, chordIndex } from '../src/theory.js';
import { analyzeFragment } from './analyze.js';
import { scoreFragment } from './score.js';
import { generateCandidate, containsFormula, FORMULAS, CADENCES, RHYTHMS } from './generate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, '../src/data/melodies.json');
const PROG_PATH = resolve(HERE, '../src/data/progressions.json');

const SEED = 20260816;
// 候補数。緊張度1の断片と sigh、そして answer 輪郭は出現率が数%以下なので、
// これだけ引かないと下限を満たすだけの母数が集まらない。
const CANDIDATES = 300000;
const TARGET = 999;
const BUCKET_QUOTA = 9;
const MODES = ['major', 'minor'];

// 輪郭6種 × 緊張度5段階 × 終止クラス2種 = 60バケット。
// うち answer|*|open と question|*|rest の10個は detectContour の定義上必ず空になる
// (answer は最終音がトニックのときだけ、question はそれ以外のときだけ返るため)。
const CONTOURS = ['arch', 'wave', 'descend', 'ascend', 'answer', 'question'];
const TENSIONS = [1, 2, 3, 4, 5];
const END_CLASSES = ['rest', 'open'];

// 1, 8, 15 …(トニック)で終われば着地感がある = 'rest'。
function endClassOf(endDeg) {
  return ((((endDeg - 1) % 7) + 7) % 7) === 0 ? 'rest' : 'open';
}

function bucketKey(meta) {
  return `${meta.contour}|${meta.tension}|${endClassOf(meta.endDeg)}`;
}

function bucketKeys() {
  const keys = [];
  for (const c of CONTOURS) {
    for (const t of TENSIONS) {
      for (const e of END_CLASSES) keys.push(`${c}|${t}|${e}`);
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// 最終999件が満たすべき下限と上限
// ---------------------------------------------------------------------------

const hasTag = (tag) => (c) => c.meta.tags.includes(tag);

// 音程の分布は名旋律125曲のコーパス実測値(順次進行 69.1%)に合わせる。
// 順次進行 = 度数差1(2度)。3度以上は跳躍として別に数える。
const inStepBand = (c) => c.meta.stepRatio >= 0.6 && c.meta.stepRatio <= 0.8;

// 跳躍(3度以上)の直後が順次進行になっている割合。コーパス実測 62.4%。
const fillsLeaps = (c) => c.meta.leapThenStep !== null && c.meta.leapThenStep >= 0.6;

// ---------------------------------------------------------------------------
// 進行のスロット(2小節)被覆
// ---------------------------------------------------------------------------
// 組み立て側は「1小節目のコードに乗る × 2小節目のコードに乗る」で断片を引く。
// あるコードの組で候補がゼロになると、その小節は全音符2つの保険で埋まる = 曲が破綻する。
// スコア順に任せると珍しいコードの組(bVI や III->VII)が必ず痩せるので、
// 進行に実在する組み合わせすべてに下限を置く。
const SLOT_MIN = 30;

function slotPairs() {
  const progs = JSON.parse(readFileSync(PROG_PATH, 'utf8'));
  const seen = new Map();
  for (const p of progs) {
    for (let k = 0; k * 2 + 1 < p.bars.length; k++) {
      const a = p.bars[2 * k].chord;
      const b = p.bars[2 * k + 1].chord;
      const key = `${p.mode}|${a}|${b}`;
      if (seen.has(key)) continue;
      const ia = chordIndex(p.mode, a);
      const ib = chordIndex(p.mode, b);
      // 語彙外のコードは断片の fit に載らないので被覆のしようがない。
      if (ia < 0 || ib < 0) throw new Error(`語彙に無いコード: ${p.id} ${a}->${b}`);
      seen.set(key, { key: `slot:${p.mode}:${a}->${b}`, mode: p.mode, ia, ib });
    }
  }
  return [...seen.values()];
}

const SLOTS = slotPairs();

// ---------------------------------------------------------------------------
// リズム型の偏り
// ---------------------------------------------------------------------------
// 組み立て側は a' / a'' を「a と同じリズムの別の断片」で作る(ゼクエンツが
// 作れないときの代替)。導出に失敗するスロットを調べると、原因は実測で100%が
// 「同じリズムの仲間は居るが、そのスロットのコード対に乗るものが1つも無い」だった。
// 仲間が多いほど乗るものが見つかるので、リズム型は均さずに偏らせたままにする。
//
// 41型すべてに下限を置いて均すと、よく出る型の仲間が減って逆効果になる。
// 実測(seed 200本 × 曲長3種を3つの seed 群で):
//   下限なし 96.9 / 96.3 / 96.4%   下限3 94.7 / 94.7 / 94.5%   下限8 94.8 / 93.3 / 95.3%
// 下限を置かなくても41型中37型は残り、断片ごとのリズムの多様性
// (音価3種類以上・シンコペーション・休符)は生成側の制約で保証されている。

/** 断片のリズム型キー(拍と長さの並び)。compose 側の rhythmKey と同じ形。 */
function rhythmKeyOf(notes) {
  return notes.map((n) => `${n.beat}:${n.dur}`).join(',');
}

const RHYTHM_KEYS = [...new Set(RHYTHMS.map((r) => r.map((n) => `${n.b}:${n.d}`).join(',')))];

// 断片が乗れるスロット(SLOTS の添字)の一覧。候補1件につき一度だけ計算する。
function slotsOf(fit) {
  const out = [];
  for (let i = 0; i < SLOTS.length; i++) {
    const s = SLOTS[i];
    const f = fit[s.mode];
    if (f[0].includes(s.ia) && f[1].includes(s.ib)) out.push(i);
  }
  return out;
}

const GOALS = [
  // 旋律型(FORMULAS)から組み立てた断片。ここが「メロディーに聴こえるか」の本丸。
  { key: 'source:formula', min: 600, test: (c) => c.source === 'formula' },
  // リズムの単調さ対策。音価が2種類以下の断片は「全部同じ長さ=童謡」に聴こえる。
  // 拍からずれる音(シンコペーション)と息継ぎ(休符)が、断片を曲の一節に変える。
  { key: 'durations>=3', min: 700, test: (c) => c.meta.distinctDurations >= 3 },
  { key: 'syncopation', min: 250, test: hasTag('syncopation') },
  { key: 'has-rest', min: 200, test: hasTag('has-rest') },
  // 名旋律の音程分布。跳躍だらけも順次だらけも記憶に残らない。
  { key: 'step-ratio', min: 560, test: inStepBand },
  // 「跳んだら順次で埋め戻す」。歌える線とそうでない線を分ける最大の要因。
  { key: 'leap-then-step', min: 560, test: fillsLeaps },
  // 大衆性の核心。ペンタトニックは耳なじみの最大の要因。
  { key: 'penta-major', min: 400, test: hasTag('penta-major') },
  { key: 'penta-minor', min: 250, test: hasTag('penta-minor') },
  // 動機として成立しているか。後半が前半の平行移動・完全反復であること。
  { key: 'inner-sequence', min: 300, test: hasTag('inner-sequence') },
  { key: 'inner-repeat', min: 120, test: hasTag('inner-repeat') },
  { key: 'inner-motif', min: 50, test: hasTag('inner-motif') },
  // 「泣ける」の中核。跳躍上行のあとの順次下降。
  { key: 'sigh', min: 100, test: hasTag('sigh') },
  // 「感動する瞬間」の中核。4度以上跳んで頂点に届き、そこから順次で降りる形。
  // 組み立て側はクライマックスに「高いところまで舞い上がる断片」を要求するので、
  // 頂点が高い(12以上)ぶんも別に確保する。ここが薄いと曲が舞い上がらない。
  { key: 'soar', min: 200, test: hasTag('soar') },
  {
    key: 'soar&peak>=12',
    min: 120,
    test: (c) => c.meta.peakDeg >= 12 && c.meta.peakCount === 1 && c.meta.tags.includes('soar'),
  },
  // ピアノ曲としての密度。薄いとアンビエントになって退屈になる。
  // ただし詰めるだけだと音価が均一になるので、上げるのは中央値までにする。
  { key: 'notes>=12', min: 120, test: (c) => c.notes.length >= 12 },
  { key: 'notes>=10', min: 350, test: (c) => c.notes.length >= 10 },
  { key: 'notes>=8', min: 560, test: (c) => c.notes.length >= 8 }, // 中央値8以上の担保
  // クライマックス用。頂点の一回性(peakCount===1)まで満たす帯が薄いと、
  // 組み立て側が接続を諦めて曲が痩せる。
  { key: 'peak>=12', min: 50, test: (c) => c.meta.peakDeg >= 12 },
  { key: 'peak>=12&solo', min: 80, test: (c) => c.meta.peakDeg >= 12 && c.meta.peakCount === 1 },
  // 着地感のある終止。
  { key: 'tonic-end', min: 200, test: (c) => endClassOf(c.meta.endDeg) === 'rest' },
  // 多様性(既存要件)。
  ...CONTOURS.map((c) => ({ key: `contour:${c}`, min: 20, test: (x) => x.meta.contour === c })),
  ...TENSIONS.map((t) => ({ key: `tension:${t}`, min: 50, test: (x) => x.meta.tension === t })),
  // --- 被覆系(priority 0)。細かく重ならない枠なので先に埋める ---
  // 進行のスロット被覆。ここがゼロになるスロットが1つでもあると曲が破綻する。
  ...SLOTS.map((s, i) => ({
    key: s.key, min: SLOT_MIN, priority: 0, test: (c) => c.slots.includes(i),
  })),
];

// 埋めすぎ防止。下限を満たしたあと、スコア上位だけで埋めると
// 同じ性質の断片ばかりになるので天井を設ける。
const CAPS = [
  { key: 'notes<=6', max: 150, test: (c) => c.notes.length <= 6 },
  // 音数まで揃うと、断片ごとの「詰まり具合」の対比が消える。
  // 8音の型がカタログの主力なので、ここだけ天井を置いて他の密度を混ぜる。
  { key: 'notes==8', max: 450, test: (c) => c.notes.length === 8 },
  // 高い断片ばかりだと組み立て側の「音高の窓」(クライマックス以外は11度まで)に
  // 引っかかって、ふつうのスロットで引ける断片が枯れる。
  { key: 'peak>=12', max: 200, test: (c) => c.meta.peakDeg >= 12 },
  { key: 'contour:wave', max: 430, test: (c) => c.meta.contour === 'wave' },
  // 舞い上がりは音域が広く(平均 span 6.2 対 3.9)、平行移動できる余地が狭い。
  // カタログの半分を占めると、組み立て側が楽節を導出できずに単独選択へ落ちる。
  // クライマックスに要る数は確保しつつ、全体が舞い上がりだらけになるのは止める。
  { key: 'soar', max: 380, test: hasTag('soar') },
  { key: 'inner-repeat', max: 240, test: hasTag('inner-repeat') },
];

// ---------------------------------------------------------------------------
// コード適合の事前計算
// ---------------------------------------------------------------------------

// 同じ断片がメジャー進行では明るく、マイナー進行では切なく響く。
// そのため両モードについて計算する。
// fit[mode][0] = 1小節目が乗るコードの CHORD_VOCAB[mode] における添字の配列
// fit[mode][1] = 2小節目のもの。sus は同じ形で「掛留が成立する」コードの添字。
function chordMaps(notes) {
  const bars = splitBars(notes);
  const fit = {};
  const sus = {};
  for (const mode of MODES) {
    fit[mode] = [[], []];
    sus[mode] = [[], []];
    const vocab = CHORD_VOCAB[mode];
    for (let bar = 0; bar < 2; bar++) {
      for (let i = 0; i < vocab.length; i++) {
        if (fitsBar(bars[bar], mode, vocab[i])) fit[mode][bar].push(i);
        if (hasSuspension(bars[bar], mode, vocab[i])) sus[mode][bar].push(i);
      }
    }
  }
  return { fit, sus };
}

// 足切りとスロット被覆の両方に使う適合表。
// 全モード・全小節のどれかで乗るコードが1つも無ければ、その断片は使い道がない(null)。
function fitMapOf(notes) {
  const bars = splitBars(notes);
  const fit = {};
  for (const mode of MODES) {
    fit[mode] = [[], []];
    const vocab = CHORD_VOCAB[mode];
    for (let bar = 0; bar < 2; bar++) {
      for (let i = 0; i < vocab.length; i++) {
        if (fitsBar(bars[bar], mode, vocab[i])) fit[mode][bar].push(i);
      }
      if (fit[mode][bar].length === 0) return null;
    }
  }
  return fit;
}

// ---------------------------------------------------------------------------
// 候補生成と足切り
// ---------------------------------------------------------------------------

// スコア降順。同点は生成順(index 昇順)で決める = 完全に決定論的。
function better(a, b) {
  return a.score !== b.score ? a.score > b.score : a.index < b.index;
}

// 上位 limit 件だけを保持する箱。30万件を全部抱えるとメモリを食うだけで、
// 使うのは各プールの上位だけなので、流しながら間引く。
class Top {
  constructor(limit) {
    this.limit = limit;
    this.items = [];
  }

  add(cand) {
    const items = this.items;
    if (items.length >= this.limit && !better(cand, items[items.length - 1])) return;
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (better(cand, items[mid])) hi = mid;
      else lo = mid + 1;
    }
    items.splice(lo, 0, cand);
    if (items.length > this.limit) items.pop();
  }
}

// 音高とリズムが完全に一致する断片は、強弱がわずかに違うだけの重複。
// カタログの枠を食うだけなので最初の1件だけ残す。
function signatureOf(notes) {
  return notes.map((n) => `${n.deg}@${n.beat}/${n.dur}`).join(',');
}

function collect() {
  const rng = makeRng(SEED);
  const rejected = { short: 0, noChord: 0, dup: 0 };
  const seen = new Set();

  // 予備は多めに持つ。上限(CAPS)に阻まれた枠を埋める材料が尽きると、
  // 上限を無視して埋めるしかなくなり、同じ性質の断片で膨らむ。
  const buckets = new Map();
  for (const key of bucketKeys()) buckets.set(key, new Top(200));
  const goalPools = new Map();
  for (const g of GOALS) goalPools.set(g.key, new Top(Math.max(3000, g.min * 6)));
  const global = new Top(20000);

  const pool = { total: 0, tags: {}, contour: {}, tension: {}, notes: {} };

  for (let i = 0; i < CANDIDATES; i++) {
    const { notes, source, formulas } = generateCandidate(rng);

    // 音が2個以下では旋律の体をなさない。
    if (notes.length < 3) {
      rejected.short++;
      continue;
    }
    // 重複はコード適合の計算より先に落とす(重複のほうが桁違いに多い)。
    // 適合はリズムと音高だけで決まるので、判定の順序は結果を変えない。
    const sig = signatureOf(notes);
    if (seen.has(sig)) {
      rejected.dup++;
      continue;
    }
    seen.add(sig);

    // どのコードにも乗らない断片は使い道がない。
    const fit = fitMapOf(notes);
    if (fit === null) {
      rejected.noChord++;
      continue;
    }

    const meta = analyzeFragment(notes);
    // contour は生成時のテンプレート名ではなく、出来上がった度数列を
    // analyzeFragment が判定した実際の輪郭を採用する。
    const cand = {
      index: i,
      notes,
      meta,
      source,
      formulas,
      slots: slotsOf(fit),
      rhythmKey: rhythmKeyOf(notes),
      score: scoreFragment(notes, meta),
    };

    pool.total++;
    for (const t of meta.tags) pool.tags[t] = (pool.tags[t] ?? 0) + 1;
    pool.contour[meta.contour] = (pool.contour[meta.contour] ?? 0) + 1;
    pool.tension[meta.tension] = (pool.tension[meta.tension] ?? 0) + 1;
    pool.notes[notes.length] = (pool.notes[notes.length] ?? 0) + 1;

    buckets.get(bucketKey(meta)).add(cand);
    global.add(cand);
    for (const g of GOALS) {
      if (g.test(cand)) goalPools.get(g.key).add(cand);
    }
  }

  return { buckets, goalPools, global, rejected, pool };
}

// ---------------------------------------------------------------------------
// 層化抽出
// ---------------------------------------------------------------------------

function makePicker() {
  const chosen = new Map(); // index -> cand
  const capCount = new Map(CAPS.map((c) => [c.key, 0]));

  const capsBlocking = (cand) => {
    for (const cap of CAPS) {
      if (capCount.get(cap.key) >= cap.max && cap.test(cand)) return true;
    }
    return false;
  };

  const add = (cand, { ignoreCaps = false } = {}) => {
    if (chosen.size >= TARGET) return false;
    if (chosen.has(cand.index)) return false;
    if (!ignoreCaps && capsBlocking(cand)) return false;
    chosen.set(cand.index, cand);
    for (const cap of CAPS) {
      if (cap.test(cand)) capCount.set(cap.key, capCount.get(cap.key) + 1);
    }
    return true;
  };

  const count = (test) => {
    let n = 0;
    for (const cand of chosen.values()) if (test(cand)) n++;
    return n;
  };

  return { chosen, capCount, add, count };
}

function select({ buckets, goalPools, global }) {
  const picker = makePicker();
  const relaxed = [];

  // 1. バケットごとの定員。多様性の土台。
  for (const key of bucketKeys()) {
    const arr = buckets.get(key).items;
    for (const cand of arr.slice(0, BUCKET_QUOTA)) picker.add(cand);
  }
  const afterBuckets = picker.chosen.size;

  // 2. 下限に届いていない目標を埋める。
  //    1件で複数の目標を満たす候補を優先すると、999枠の消費が最小で済む。
  //
  //    順番が効く。被覆系の目標(リズム型・コードのスロット)は互いに重ならない
  //    細かい枠で、量の目標(順次進行の帯・音数など)はどの断片でも満たしうる。
  //    量から先に埋めるとスコア上位の似た断片で999枠が尽き、被覆系が埋まらない。
  //    被覆系を先に埋めれば、その断片が量の目標も同時に満たしてくれる。
  const deficits = () => GOALS
    .map((g) => ({ g, need: g.min - picker.count(g.test) }))
    .filter((d) => d.need > 0)
    .sort((a, b) => (a.g.priority ?? 1) - (b.g.priority ?? 1)
      || b.need - a.need
      || (a.g.key < b.g.key ? -1 : 1));

  for (let round = 0; round < GOALS.length + 1; round++) {
    const list = deficits();
    if (list.length === 0) break;
    const unmet = list.map((d) => d.g);

    for (const { g, need } of list) {
      const remain = g.min - picker.count(g.test);
      if (remain <= 0) continue;
      const eligible = goalPools.get(g.key).items
        .filter((c) => !picker.chosen.has(c.index))
        .map((c) => ({ c, overlap: unmet.reduce((n, u) => n + (u.test(c) ? 1 : 0), 0) }))
        .sort((a, b) => b.overlap - a.overlap || (better(a.c, b.c) ? -1 : 1));

      let added = 0;
      for (const { c } of eligible) {
        if (added >= remain) break;
        if (picker.add(c)) added++;
      }
      // 上限に阻まれて埋まらないときだけ上限を無視する(下限が優先)。
      if (added < remain) {
        const before = added;
        for (const { c } of eligible) {
          if (added >= remain) break;
          if (picker.add(c, { ignoreCaps: true })) added++;
        }
        if (added > before) relaxed.push(`${g.key}+${added - before}`);
      }
      void need;
    }
  }
  const afterGoals = picker.chosen.size;

  // 3. 残りをスコア順で埋める。まず上限を守り、それでも足りなければ緩める。
  for (const cand of global.items) picker.add(cand);
  if (picker.chosen.size < TARGET) {
    for (const arr of buckets.values()) {
      for (const cand of arr.items) picker.add(cand);
    }
  }
  if (picker.chosen.size < TARGET) {
    for (const cand of global.items) picker.add(cand, { ignoreCaps: true });
    for (const arr of buckets.values()) {
      for (const cand of arr.items) picker.add(cand, { ignoreCaps: true });
    }
  }

  return {
    chosen: [...picker.chosen.values()],
    afterBuckets,
    afterGoals,
    capCount: picker.capCount,
    relaxed,
  };
}

// ---------------------------------------------------------------------------
// 出力
// ---------------------------------------------------------------------------

function toRecord(cand, i) {
  const m = cand.meta;
  const { fit, sus } = chordMaps(cand.notes);
  return {
    id: `m${String(i + 1).padStart(4, '0')}`,
    notes: cand.notes,
    startDeg: m.startDeg,
    endDeg: m.endDeg,
    contour: m.contour,
    range: m.range,
    span: m.span,
    peakDeg: m.peakDeg,
    peakBeat: m.peakBeat,
    peakCount: m.peakCount,
    tension: m.tension,
    density: m.density,
    tags: m.tags,
    fit,
    sus,
    score: cand.score,
  };
}

// 1断片1行。詰めた形のままでも差分が読める。
function serialize(items) {
  return `[\n${items.map((it) => `  ${JSON.stringify(it)}`).join(',\n')}\n]\n`;
}

// ---------------------------------------------------------------------------
// 統計
// ---------------------------------------------------------------------------

function tally(list, keyOf) {
  const out = {};
  for (const item of list) {
    const k = keyOf(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function ordered(counts, keys) {
  const out = {};
  for (const k of keys) out[k] = counts[k] ?? 0;
  return out;
}

function median(values) {
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

function report(melodies, chosenCands, info) {
  const { rejected, pool, afterBuckets, afterGoals, capCount, buckets, relaxed } = info;
  const scores = melodies.map((m) => m.score).sort((a, b) => a - b);

  const tags = {};
  for (const m of melodies) {
    for (const t of m.tags) tags[t] = (tags[t] ?? 0) + 1;
  }
  const tagList = Object.entries(tags).sort((a, b) => b[1] - a[1]);
  const lens = melodies.map((m) => m.notes.length);
  const cut = rejected.short + rejected.noChord + rejected.dup;

  console.log(`wrote ${OUT_PATH}`);
  console.log(`  候補生成       : ${CANDIDATES}`);
  console.log(`  足切り後       : ${pool.total}  (捨てた ${cut} = 音数不足 ${rejected.short} / コード不適合 ${rejected.noChord} / 重複 ${rejected.dup})`);
  console.log(`  抽選の内訳     : バケット ${afterBuckets} -> 目標充足 ${afterGoals} -> 最終 ${melodies.length}`);
  console.log(`  輪郭ごと       : ${JSON.stringify(ordered(tally(melodies, (m) => m.contour), CONTOURS))}`);
  console.log(`  緊張度ごと     : ${JSON.stringify(ordered(tally(melodies, (m) => m.tension), TENSIONS))}`);
  console.log(`  終止クラスごと : ${JSON.stringify(ordered(tally(melodies, (m) => endClassOf(m.endDeg)), END_CLASSES))}`);
  console.log(`  音数           : 中央値 ${median(lens)} / 平均 ${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(2)} / >=12 ${lens.filter((n) => n >= 12).length} / >=10 ${lens.filter((n) => n >= 10).length} / <=6 ${lens.filter((n) => n <= 6).length}`);
  // リズムの単調さの主指標。ここが痩せると「全部童謡」に戻る。
  const durKinds = tally(chosenCands, (c) => c.meta.distinctDurations);
  const ratios = chosenCands.filter((c) => c.meta.durationRatio >= 3).length;
  console.log(`  音価の種類数   : ${JSON.stringify(durKinds)}  (>=3 ${chosenCands.filter((c) => c.meta.distinctDurations >= 3).length} / 最長÷最短>=3 ${ratios})`);
  // リズム型ごとの件数。少ない型の断片は「同じリズムの別の断片」を見つけられず、
  // 組み立て側で楽節(a -> a')が導出できなくなる。
  const perRhythm = RHYTHM_KEYS.map((k) => chosenCands.filter((c) => c.rhythmKey === k).length)
    .sort((a, b) => a - b);
  console.log(`  リズム型ごと   : ${RHYTHM_KEYS.length}型 / 最小 ${perRhythm[0]} / 中央値 ${perRhythm[perRhythm.length >> 1]} / 最大 ${perRhythm[perRhythm.length - 1]}`);
  console.log('  タグごと       :');
  for (const [tag, n] of tagList) console.log(`      ${tag.padEnd(15)} ${n}`);
  console.log(`  スコア         : min ${scores[0]} / median ${scores[Math.floor(scores.length / 2)]} / max ${scores[scores.length - 1]}`);
  console.log(`  peakDeg>=12    : ${melodies.filter((m) => m.peakDeg >= 12).length}  (うち頂点1回 ${melodies.filter((m) => m.peakDeg >= 12 && m.peakCount === 1).length})`);
  console.log(`  上限の消化     : ${[...capCount].map(([k, v]) => `${k}=${v}`).join(' ')}${relaxed.length ? `  (下限優先で緩めた: ${relaxed.join(' ')})` : ''}`);

  // 音程の分布がコーパス(名旋律125曲)の実測値に届いているか。
  const bySource = tally(chosenCands, (c) => c.source);
  const inBand = chosenCands.filter(inStepBand).length;
  const filled = chosenCands.filter(fillsLeaps).length;
  const thirdBand = chosenCands.filter((c) => c.meta.thirdRatio >= 0.1 && c.meta.thirdRatio <= 0.3).length;
  const mean = (fn) => (chosenCands.reduce((a, c) => a + fn(c), 0) / chosenCands.length).toFixed(3);
  console.log(`  生成経路       : ${JSON.stringify(bySource)}`);
  console.log(`  音程の分布     : 順次0.60〜0.80 ${inBand} / 3度0.10〜0.30 ${thirdBand} / 跳躍後に順次>=0.60 ${filled}`);
  console.log(`                   平均 順次 ${mean((c) => c.meta.stepRatio)} (コーパス 0.691) / 3度 ${mean((c) => c.meta.thirdRatio)} (0.183) / 4度以上 ${mean((c) => c.meta.leapRatio)} (0.041)`);

  // 旋律型の採用状況。特定の型に偏ると、語彙を増やした意味が無くなる。
  const formulaUse = {};
  let draws = 0;
  for (const c of chosenCands) {
    for (const f of c.formulas ?? []) {
      formulaUse[f] = (formulaUse[f] ?? 0) + 1;
      draws++;
    }
  }
  const used = Object.entries(formulaUse).sort((a, b) => b[1] - a[1]);
  const withCorpus = chosenCands.filter((c) => containsFormula(c.notes.map((n) => n.deg))).length;
  console.log(`  旋律型         : ${used.length}/${FORMULAS.length + CADENCES.length}種 を採用 / 抽選 ${draws}回 / コーパスの型を含む断片 ${withCorpus} (${(100 * withCorpus / chosenCands.length).toFixed(1)}%)`);
  console.log(`                   上位20: ${used.slice(0, 20).map(([k, v]) => `${k}=${v}(${(100 * v / draws).toFixed(1)}%)`).join(' ')}`);
  const top = used[0];
  console.log(`                   最頻 ${top[0]} = ${(100 * top[1] / draws).toFixed(2)}% / [0,-1,-2] = ${(100 * (formulaUse['0,-1,-2'] ?? 0) / draws).toFixed(2)}%`);

  // 目標の達成状況。ここが赤いまま出荷すると曲の作りが破綻する。
  const short = [];
  for (const g of GOALS) {
    const n = chosenCands.filter(g.test).length;
    if (n < g.min) short.push(`${g.key} ${n}/${g.min}`);
  }
  console.log(`  目標未達       : ${short.length ? short.join(' / ') : 'なし'}`);

  // 進行のスロット被覆。ゼロのスロットが1つでもあると、その2小節は
  // 全音符2つの保険で埋まる = 曲が破綻する。
  const slotCounts = SLOTS
    .map((s, i) => ({ key: s.key, n: chosenCands.filter((c) => c.slots.includes(i)).length }))
    .sort((a, b) => a.n - b.n);
  const zeroSlots = slotCounts.filter((s) => s.n === 0);
  const mid = slotCounts[slotCounts.length >> 1].n;
  console.log(`  スロット被覆   : ${SLOTS.length}組  ゼロ ${zeroSlots.length}${zeroSlots.length ? ` -> ${zeroSlots.map((s) => s.key).join(' ')}` : ''} / 最小 ${slotCounts[0].n} / 中央値 ${mid} / 最大 ${slotCounts[slotCounts.length - 1].n}`);
  console.log(`                   下位5: ${slotCounts.slice(0, 5).map((s) => `${s.key}=${s.n}`).join(' ')}`);

  // 層化抽出の健全性。空・定員割れバケットはそのまま多様性の欠落になる。
  const empty = [];
  const thin = [];
  for (const [key, top] of buckets) {
    if (top.items.length === 0) empty.push(key);
    else if (top.items.length < BUCKET_QUOTA) thin.push(`${key}=${top.items.length}`);
  }
  console.log(`  空バケット     : ${empty.length}/60${empty.length ? ` -> ${empty.join(' ')}` : ''}`);
  console.log(`  定員割れ       : ${thin.length}${thin.length ? ` -> ${thin.join(' ')}` : ''}`);

  // プール側(足切り後の全候補)の分布。母数が足りているかの確認用。
  console.log(`  プール分布     : 輪郭 ${JSON.stringify(ordered(pool.contour, CONTOURS))} / 緊張度 ${JSON.stringify(ordered(pool.tension, TENSIONS))}`);
  console.log(`                   sigh=${pool.tags.sigh ?? 0} penta-major=${pool.tags['penta-major'] ?? 0} penta-minor=${pool.tags['penta-minor'] ?? 0} inner-sequence=${pool.tags['inner-sequence'] ?? 0} inner-repeat=${pool.tags['inner-repeat'] ?? 0}`);
}

// ---------------------------------------------------------------------------

const collected = collect();
const { chosen, afterBuckets, afterGoals, capCount, relaxed } = select(collected);

if (chosen.length !== TARGET) {
  throw new Error(`${chosen.length} 件しか選べません(必要 ${TARGET} 件)`);
}

const unmet = GOALS.filter((g) => chosen.filter(g.test).length < g.min);
const lens = chosen.map((c) => c.notes.length);
if (median(lens) < 8) unmet.push({ key: `音数中央値 ${median(lens)}`, min: 8 });
if (unmet.length > 0) {
  const detail = unmet.map((g) => `${g.key}(必要${g.min})`).join(' / ');
  throw new Error(`目標を満たせません: ${detail}`);
}

// score 降順ではなく生成順に並べてから id を振る。
chosen.sort((a, b) => a.index - b.index);
const melodies = chosen.map(toRecord);

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, serialize(melodies), 'utf8');

report(melodies, chosen, {
  rejected: collected.rejected,
  pool: collected.pool,
  buckets: collected.buckets,
  afterBuckets,
  afterGoals,
  capCount,
  relaxed,
});
