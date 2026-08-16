import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS, REGIONS } from '../tools/corpus.js';
import {
  FORMULA_MIN_LEN, FORMULA_MAX_LEN, FORMULA_MIN_WEIGHT, CADENCE_LEN,
  RHYTHM_MIN_LEN, RHYTHM_MAX_LEN,
  SOAR_MIN_LEN, SOAR_MAX_LEN, SOAR_MIN_WEIGHT, SOAR_MIN_LEAP,
  SOAR_MIN_DESCENT, SOAR_STEP_MAX, PHRASE_END_LONG_FACTOR,
  isSoarWindow, buildPatterns, serializePatterns,
} from '../tools/extractPatterns.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACTOR = resolve(HERE, '../tools/extractPatterns.js');
const PATTERNS_PATH = resolve(HERE, '../tools/data/patterns.json');
const patterns = JSON.parse(readFileSync(PATTERNS_PATH, 'utf8'));

// 没後70年に余裕を持たせた線。これより後に没した作曲家は入れられない。
const PD_DEATH_YEAR_LIMIT = 1955;
const MIN_PIECES = 110;
const MIN_NOTES_PER_PIECE = 8;
const MIN_FORMULAS = 200;
const MIN_CADENCES = 10;
const MIN_RHYTHM_CELLS = 20;
const MIN_SOARS = 40;
// 名旋律は順次進行が主体。この帯を外れたら採譜そのものが疑わしい。
const STEPWISE_BAND = { min: 0.4, max: 0.8 };
// 地域ごとに見るときは語法の幅があるので少し広く取る。
const REGION_STEPWISE_BAND = { min: 0.35, max: 0.85 };
// 跳んだら順次で埋め戻す、が歌の原則。
const LEAP_THEN_STEP_MIN = 0.6;
// 名バラードはフレーズ末で必ず音を伸ばす。
const PHRASE_END_LONG_MIN = 0.5;
// 系統ごとの最低収録数。ここを割ると「その系統を分析した」とは言えない。
const REGION_MIN_COUNT = { italian: 8, latin: 5, korean: 3 };
// ユーザーが挙げた Can't Help Falling in Love の原曲。必ず入っていること。
const REQUIRED_IDS = ['martini-plaisir-damour'];

// ---------------------------------------------------------------------------
// 1. 著作権の監査。ここが落ちたら他が全部通っていても出荷できない。
// ---------------------------------------------------------------------------

test('全エントリが composer と died のフィールドを持つ', () => {
  for (const entry of CORPUS) {
    assert.ok(
      Object.hasOwn(entry, 'composer'),
      `${entry.id}: composer フィールドが無い`,
    );
    assert.ok(
      Object.hasOwn(entry, 'died'),
      `${entry.id}: died フィールドが無い`,
    );
  }
});

test('パブリックドメイン監査: died は 1955 以下か、伝承曲の null のみ', () => {
  for (const entry of CORPUS) {
    if (entry.died === null) {
      // 伝承曲は作曲者不明であることまで含めて確認する。
      assert.equal(
        entry.composer, null,
        `${entry.id}: died が null なら composer も null(作曲者不明)でなければならない`,
      );
      continue;
    }
    assert.equal(
      typeof entry.died, 'number',
      `${entry.id}: died は数値か null`,
    );
    assert.ok(Number.isInteger(entry.died), `${entry.id}: died は整数`);
    assert.ok(
      entry.died <= PD_DEATH_YEAR_LIMIT,
      `${entry.id} (${entry.composer}): 没年 ${entry.died} は ${PD_DEATH_YEAR_LIMIT} より後。収録不可`,
    );
    assert.equal(
      typeof entry.composer, 'string',
      `${entry.id}: 没年があるなら composer は文字列`,
    );
    assert.ok(entry.composer.length > 0, `${entry.id}: composer が空文字`);
  }
});

test('patterns.json にも由来の監査情報が残っている', () => {
  assert.ok(patterns.source);
  assert.ok(
    patterns.source.newestDeathYear <= PD_DEATH_YEAR_LIMIT,
    `patterns.json の newestDeathYear=${patterns.source.newestDeathYear} が基準を超えている`,
  );
  assert.equal(patterns.source.pieces, CORPUS.length);
});

// ---------------------------------------------------------------------------
// 2〜4. コーパスの形式
// ---------------------------------------------------------------------------

test('110曲以上あり、id が重複していない', () => {
  assert.ok(
    CORPUS.length >= MIN_PIECES,
    `収録数 ${CORPUS.length} は ${MIN_PIECES} 未満`,
  );
  const ids = CORPUS.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, `id が重複: ${ids.join(', ')}`);
  for (const id of ids) {
    assert.match(id, /^[a-z0-9][a-z0-9-]*$/, `id "${id}" の形式が不正`);
  }
});

test('notes は8音以上、deg は整数、dur は正の数', () => {
  for (const entry of CORPUS) {
    assert.ok(Array.isArray(entry.notes), `${entry.id}: notes が配列でない`);
    assert.ok(
      entry.notes.length >= MIN_NOTES_PER_PIECE,
      `${entry.id}: ${entry.notes.length} 音しかない(${MIN_NOTES_PER_PIECE}音以上必要)`,
    );
    for (const [i, note] of entry.notes.entries()) {
      assert.ok(
        Number.isInteger(note.deg),
        `${entry.id}[${i}]: deg=${note.deg} が整数でない`,
      );
      assert.equal(
        typeof note.dur, 'number',
        `${entry.id}[${i}]: dur が数値でない`,
      );
      assert.ok(
        Number.isFinite(note.dur) && note.dur > 0,
        `${entry.id}[${i}]: dur=${note.dur} が正の数でない`,
      );
    }
  }
});

test('祖先として必須の曲が収録されている', () => {
  const ids = new Set(CORPUS.map((entry) => entry.id));
  for (const id of REQUIRED_IDS) {
    assert.ok(ids.has(id), `${id} が収録されていない`);
  }
  // Plaisir d'amour は1784年作・作曲者没1816。念のため中身も確かめる。
  const plaisir = CORPUS.find((entry) => entry.id === 'martini-plaisir-damour');
  assert.equal(plaisir.died, 1816);
  assert.ok(plaisir.notes.length >= MIN_NOTES_PER_PIECE);
});

test('全エントリが有効な region を持つ', () => {
  for (const entry of CORPUS) {
    assert.ok(
      REGIONS.includes(entry.region),
      `${entry.id}: region="${entry.region}" は ${REGIONS.join('/')} のいずれかでなければならない`,
    );
  }
});

test('系統ごとの最低収録数(italian 8 / latin 5 / korean 3)を満たす', () => {
  const count = {};
  for (const entry of CORPUS) count[entry.region] = (count[entry.region] ?? 0) + 1;
  for (const [region, min] of Object.entries(REGION_MIN_COUNT)) {
    assert.ok(
      (count[region] ?? 0) >= min,
      `region="${region}" が ${count[region] ?? 0} 曲。${min} 曲以上必要`,
    );
  }
});

test('mode は major か minor、title と meter がある', () => {
  for (const entry of CORPUS) {
    assert.ok(
      entry.mode === 'major' || entry.mode === 'minor',
      `${entry.id}: mode="${entry.mode}" は major/minor のいずれかでなければならない`,
    );
    assert.equal(typeof entry.title, 'string', `${entry.id}: title が無い`);
    assert.ok(entry.title.length > 0, `${entry.id}: title が空`);
    assert.equal(typeof entry.meter, 'string', `${entry.id}: meter が無い`);
  }
});

// ---------------------------------------------------------------------------
// 5〜7. 抽出された語彙
// ---------------------------------------------------------------------------

test('patterns.json が生成済みで formulas が200種類以上ある', () => {
  assert.ok(Array.isArray(patterns.formulas));
  assert.ok(
    patterns.formulas.length >= MIN_FORMULAS,
    `formulas ${patterns.formulas.length} 種類は ${MIN_FORMULAS} 未満。コーパスを増やすこと`,
  );
});

test('全 formulas は steps[0]===0、長さ3〜6、weight は2以上', () => {
  for (const formula of patterns.formulas) {
    assert.ok(Array.isArray(formula.steps));
    assert.equal(
      formula.steps[0], 0,
      `steps=${formula.steps} が0始まりでない(相対オフセットに正規化されていない)`,
    );
    assert.ok(
      formula.steps.length >= FORMULA_MIN_LEN && formula.steps.length <= FORMULA_MAX_LEN,
      `steps=${formula.steps} の長さ ${formula.steps.length} が ${FORMULA_MIN_LEN}〜${FORMULA_MAX_LEN} の外`,
    );
    assert.equal(formula.len, formula.steps.length, `len が steps の長さと一致しない`);
    assert.ok(
      Number.isInteger(formula.weight) && formula.weight >= FORMULA_MIN_WEIGHT,
      `steps=${formula.steps} の weight=${formula.weight} が ${FORMULA_MIN_WEIGHT} 未満`,
    );
    for (const step of formula.steps) {
      assert.ok(Number.isInteger(step), `steps=${formula.steps} に非整数が混じっている`);
    }
  }
});

test('formulas は weight の降順に並んでいる', () => {
  for (let i = 1; i < patterns.formulas.length; i += 1) {
    assert.ok(
      patterns.formulas[i - 1].weight >= patterns.formulas[i].weight,
      `${i} 番目で weight の降順が崩れている`,
    );
  }
});

test('cadences が10種類以上あり、4音の0始まりオフセットである', () => {
  assert.ok(Array.isArray(patterns.cadences));
  assert.ok(
    patterns.cadences.length >= MIN_CADENCES,
    `cadences ${patterns.cadences.length} 種類は ${MIN_CADENCES} 未満`,
  );
  for (const cadence of patterns.cadences) {
    assert.equal(cadence.steps.length, CADENCE_LEN, `終止形は${CADENCE_LEN}音`);
    assert.equal(cadence.steps[0], 0, `steps=${cadence.steps} が0始まりでない`);
    assert.ok(Number.isInteger(cadence.weight) && cadence.weight >= 1);
  }
  // 終止形の総重みは曲数と一致する(各曲がちょうど1つ供出する)。
  const total = patterns.cadences.reduce((a, c) => a + c.weight, 0);
  assert.equal(total, CORPUS.length);
});

test('rhythmCells が20種類以上あり、長さ2〜4で dur が正の数', () => {
  assert.ok(Array.isArray(patterns.rhythmCells));
  assert.ok(
    patterns.rhythmCells.length >= MIN_RHYTHM_CELLS,
    `rhythmCells ${patterns.rhythmCells.length} 種類は ${MIN_RHYTHM_CELLS} 未満`,
  );
  for (const cell of patterns.rhythmCells) {
    assert.ok(
      cell.durs.length >= RHYTHM_MIN_LEN && cell.durs.length <= RHYTHM_MAX_LEN,
      `durs=${cell.durs} の長さが ${RHYTHM_MIN_LEN}〜${RHYTHM_MAX_LEN} の外`,
    );
    for (const dur of cell.durs) {
      assert.ok(dur > 0, `durs=${cell.durs} に0以下が混じっている`);
    }
    assert.ok(Number.isInteger(cell.weight) && cell.weight >= 1);
  }
});

test('soars が40種類以上あり、長さ4〜6の0始まりオフセットである', () => {
  assert.ok(Array.isArray(patterns.soars));
  assert.ok(
    patterns.soars.length >= MIN_SOARS,
    `soars ${patterns.soars.length} 種類は ${MIN_SOARS} 未満。跳び上がる旋律が足りない`,
  );
  for (const soar of patterns.soars) {
    assert.equal(
      soar.steps[0], 0,
      `steps=${soar.steps} が0始まりでない`,
    );
    assert.ok(
      soar.steps.length >= SOAR_MIN_LEN && soar.steps.length <= SOAR_MAX_LEN,
      `steps=${soar.steps} の長さ ${soar.steps.length} が ${SOAR_MIN_LEN}〜${SOAR_MAX_LEN} の外`,
    );
    assert.ok(
      Number.isInteger(soar.weight) && soar.weight >= SOAR_MIN_WEIGHT,
      `steps=${soar.steps} の weight=${soar.weight} が ${SOAR_MIN_WEIGHT} 未満`,
    );
    for (const step of soar.steps) {
      assert.ok(Number.isInteger(step), `steps=${soar.steps} に非整数が混じっている`);
    }
  }
});

test('soars は weight の降順に並んでいる', () => {
  for (let i = 1; i < patterns.soars.length; i += 1) {
    assert.ok(
      patterns.soars[i - 1].weight >= patterns.soars[i].weight,
      `${i} 番目で weight の降順が崩れている`,
    );
  }
});

test('全 soars が定義(大跳躍→最高音→順次下降2音以上)を実際に満たす', () => {
  for (const soar of patterns.soars) {
    const peak = Math.max(...soar.steps);
    // 条件を満たす跳躍が実際に1つ以上あることを、抽出器とは別に数え直す。
    let ok = false;
    for (let j = 0; j + 1 < soar.steps.length; j += 1) {
      const leap = soar.steps[j + 1] - soar.steps[j];
      if (leap < SOAR_MIN_LEAP) continue;
      if (soar.steps[j + 1] !== peak) continue;
      let descent = 0;
      for (let k = j + 1; k + 1 < soar.steps.length; k += 1) {
        const move = soar.steps[k + 1] - soar.steps[k];
        if (move <= -1 && move >= -SOAR_STEP_MAX) descent += 1;
        else break;
      }
      if (descent >= SOAR_MIN_DESCENT) { ok = true; break; }
    }
    assert.ok(ok, `steps=${soar.steps} が舞い上がりの定義を満たしていない`);
    assert.ok(isSoarWindow(soar.steps), `steps=${soar.steps} を抽出器が再判定できない`);
  }
});

test('舞い上がりの判定は境界で正しく効く', () => {
  // 4度上行 → 順次で2音下降。これが定義そのもの。
  assert.ok(isSoarWindow([0, 3, 2, 1]));
  // 5度・6度の跳躍も当然入る。
  assert.ok(isSoarWindow([0, 4, 3, 2]));
  assert.ok(isSoarWindow([0, 5, 4, 3]));
  // 跳躍が2(=3度)では足りない。3度は「跳び上がり」ではなく埋め草。
  assert.ok(!isSoarWindow([0, 2, 1, 0]));
  // 下降が1音しか続かない。
  assert.ok(!isSoarWindow([0, 4, 3, 4]));
  // 到達点が最高音でない(あとでさらに上がる)。
  assert.ok(!isSoarWindow([0, 3, 5, 4, 3]));
  // 跳躍後が跳躍(3度を超える下降)なら順次ではない。
  assert.ok(!isSoarWindow([0, 4, 1, 0]));
  // 下降側は3度(度数差2)までを「順次」に含める。
  assert.ok(isSoarWindow([0, 5, 3, 2]));
  // 下降が4度なら順次ではない。
  assert.ok(!isSoarWindow([0, 5, 1, 0]));
});

// ---------------------------------------------------------------------------
// 8〜9. 採譜品質の検算。ここが外れたらコーパス側を直す。
// ---------------------------------------------------------------------------

test('stepwiseRatio が 0.4〜0.8 に収まる(名旋律は順次進行が主体)', () => {
  const value = patterns.stats.stepwiseRatio;
  assert.equal(typeof value, 'number');
  assert.ok(
    value >= STEPWISE_BAND.min && value <= STEPWISE_BAND.max,
    `stepwiseRatio=${value} が ${STEPWISE_BAND.min}〜${STEPWISE_BAND.max} の外。採譜を見直すこと`,
  );
});

test('leapThenStepRatio が 0.6 以上(跳躍は順次で埋め戻される)', () => {
  const value = patterns.stats.leapThenStepRatio;
  assert.equal(typeof value, 'number');
  assert.ok(
    value >= LEAP_THEN_STEP_MIN,
    `leapThenStepRatio=${value} が ${LEAP_THEN_STEP_MIN} 未満。採譜を見直すこと`,
  );
});

test('phraseEndLongRatio が 0.5 以上(名バラードはフレーズ末で伸ばす)', () => {
  const value = patterns.stats.phraseEndLongRatio;
  assert.equal(typeof value, 'number');
  assert.ok(
    value >= PHRASE_END_LONG_MIN,
    `phraseEndLongRatio=${value} が ${PHRASE_END_LONG_MIN} 未満`,
  );
  // 抽出器を信用せず、コーパスから直接数え直して突き合わせる。
  const hit = CORPUS.filter((entry) => {
    const durs = entry.notes.map((note) => note.dur);
    const mean = durs.reduce((a, b) => a + b, 0) / durs.length;
    return durs[durs.length - 1] >= mean * PHRASE_END_LONG_FACTOR;
  }).length;
  assert.equal(value, Math.round((hit / CORPUS.length) * 1e4) / 1e4);
});

test('byRegion が全地域を覆い、どの地域も stepwiseRatio が 0.35〜0.85 に収まる', () => {
  const { byRegion } = patterns.stats;
  assert.ok(byRegion && typeof byRegion === 'object');

  const expected = {};
  for (const entry of CORPUS) expected[entry.region] = (expected[entry.region] ?? 0) + 1;
  assert.deepEqual(Object.keys(byRegion).sort(), Object.keys(expected).sort());

  let total = 0;
  for (const [region, value] of Object.entries(byRegion)) {
    assert.equal(value.count, expected[region], `${region}: count が合わない`);
    total += value.count;
    assert.ok(
      value.stepwiseRatio >= REGION_STEPWISE_BAND.min
        && value.stepwiseRatio <= REGION_STEPWISE_BAND.max,
      `region="${region}" の stepwiseRatio=${value.stepwiseRatio} が `
      + `${REGION_STEPWISE_BAND.min}〜${REGION_STEPWISE_BAND.max} の外。`
      + 'この地域の採譜を見直すこと',
    );
    assert.ok(value.meanRange > 0, `${region}: meanRange が正でない`);
    // 0 の地域が出たら、その地域の採譜か soars の定義がおかしいサイン。
    // (実際これで韓国民謡の完全4度跳躍を潰していた採譜ミスが見つかった)
    assert.ok(
      Number.isInteger(value.soarCount) && value.soarCount >= 1,
      `region="${region}" の soarCount が ${value.soarCount}。`
      + 'どの伝統にも舞い上がりはあるはずで、0 は採譜か定義を疑うべき',
    );
  }
  assert.equal(total, CORPUS.length);
  // 地域別の舞い上がりの合計は全体の soarCount と一致する。
  const soarTotal = Object.values(byRegion).reduce((a, v) => a + v.soarCount, 0);
  assert.equal(soarTotal, patterns.stats.soarCount);
});

test('stats の各項目がそろっている', () => {
  const { stats } = patterns;
  assert.equal(stats.pieces, CORPUS.length);
  assert.equal(stats.notes, CORPUS.reduce((a, e) => a + e.notes.length, 0));
  assert.equal(stats.intervals, stats.notes - CORPUS.length);

  // 音程ヒストグラムの総和は音程の総数と一致する。
  const histTotal = Object.values(stats.intervalHistogram).reduce((a, b) => a + b, 0);
  assert.equal(histTotal, stats.intervals);
  // 2度(=度数差1)の数から stepwiseRatio が再計算できる。
  const steps = stats.intervalHistogram['1'];
  assert.ok(steps > 0);
  assert.equal(stats.stepwiseRatio, Math.round((steps / stats.intervals) * 1e4) / 1e4);

  assert.ok(stats.cadenceOnTonicRatio >= 0 && stats.cadenceOnTonicRatio <= 1);

  // 舞い上がりの総数は、種類ごとの weight の合計と一致する。
  assert.equal(
    stats.soarCount,
    patterns.soars.reduce((a, s) => a + s.weight, 0),
  );
  assert.ok(stats.soarCount > 0);
  assert.ok(stats.phraseEndLongRatio >= 0 && stats.phraseEndLongRatio <= 1);
  // 冒頭2音が同音の割合。語りかけ型の語彙が実際に入っているか。
  assert.ok(stats.openingRepeatRatio > 0 && stats.openingRepeatRatio <= 1);
  const repeats = CORPUS.filter((e) => e.notes[0].deg === e.notes[1].deg).length;
  assert.equal(
    stats.openingRepeatRatio,
    Math.round((repeats / CORPUS.length) * 1e4) / 1e4,
  );

  assert.equal(stats.modeCount.major + stats.modeCount.minor, CORPUS.length);
  assert.ok(stats.modeCount.major > 0 && stats.modeCount.minor > 0);

  const beats = stats.phraseLengthBeats;
  assert.ok(beats.min > 0);
  assert.ok(beats.max >= beats.min);
  assert.ok(beats.mean >= beats.min && beats.mean <= beats.max);
  assert.ok(beats.median >= beats.min && beats.median <= beats.max);
  const beatsTotal = Object.values(beats.histogram).reduce((a, b) => a + b, 0);
  assert.equal(beatsTotal, CORPUS.length);
});

// ---------------------------------------------------------------------------
// 10. 決定論
// ---------------------------------------------------------------------------

test('抽出は決定論的(同一プロセスで2回作っても同じ文字列)', () => {
  assert.equal(serializePatterns(buildPatterns()), serializePatterns(buildPatterns()));
});

test('抽出は決定論的(別プロセスで2回実行してバイト一致し、既存の patterns.json とも一致)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patterns-determinism-'));
  try {
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    execFileSync(process.execPath, [EXTRACTOR, '--out', a], { stdio: 'ignore' });
    execFileSync(process.execPath, [EXTRACTOR, '--out', b], { stdio: 'ignore' });
    const bytesA = readFileSync(a);
    const bytesB = readFileSync(b);
    assert.ok(bytesA.equals(bytesB), '2回の実行結果がバイト一致しない');
    assert.ok(
      bytesA.equals(readFileSync(PATTERNS_PATH)),
      'tools/data/patterns.json が古い。node tools/extractPatterns.js を実行すること',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
