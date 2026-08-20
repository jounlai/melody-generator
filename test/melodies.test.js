import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHORD_VOCAB, splitBars, fitsBar, chordIndex } from '../src/theory.js';
import { distinctDurations, analyzeFragment, hasSoar } from '../tools/analyze.js';
import { containsFormula } from '../tools/generate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../src/data/melodies.json');
const PROG_PATH = resolve(HERE, '../src/data/progressions.json');
const melodies = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const progressions = JSON.parse(readFileSync(PROG_PATH, 'utf8'));

const COUNT = 999;

// カタログには版1と版2が同居している。版1は v を持たず先に並び、版2は v: 2 を持つ。
// 版1の並びは二度と動かさない（共有済みの曲コードがその添字を指しているため）。
const V1 = melodies.filter((m) => m.v === undefined);
const V2 = melodies.filter((m) => m.v === 2);
const BY_VERSION = [['版1', V1, 'm'], ['版2', V2, 'w']];
const MODES = ['major', 'minor'];
const CONTOURS = ['arch', 'wave', 'descend', 'ascend', 'answer', 'question'];
const REQUIRED_KEYS = [
  'id', 'notes', 'startDeg', 'endDeg', 'contour', 'range', 'span',
  'peakDeg', 'peakBeat', 'peakCount', 'tension', 'density', 'tags',
  'fit', 'sus', 'score',
];

// 1, 8, 15 …(トニック)で終わる断片は着地感がある。
const isTonicDeg = (deg) => ((((deg - 1) % 7) + 7) % 7) === 0;

const countBy = (keyOf) => {
  const out = new Map();
  for (const m of melodies) out.set(keyOf(m), (out.get(keyOf(m)) ?? 0) + 1);
  return out;
};

const withTag = (tag) => melodies.filter((m) => m.tags.includes(tag));

const median = (values) => {
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};

// 音程の分布は名旋律57曲のコーパス実測値に合わせて数える。
// 度数差1 = 2度(順次進行, コーパス 0.696) / 2 = 3度(0.185) / 3以上 = 4度以上(0.055)。
const metaOf = (m) => analyzeFragment(m.notes);

test('断片は版ごとにちょうど999件', () => {
  assert.ok(Array.isArray(melodies));
  for (const [name, list] of BY_VERSION) {
    assert.equal(list.length, COUNT, `${name}が${list.length}件`);
  }
  assert.equal(melodies.length, COUNT * BY_VERSION.length, '版の数と総数が合わない');
});

test('版1が先頭に並び、その順序が動いていない', () => {
  // ここが崩れると、共有済みの曲コードが別の断片を指す。
  for (let i = 0; i < COUNT; i += 1) {
    assert.equal(melodies[i].v, undefined, `${i}番目に版2が混ざっている`);
  }
});

test('id は版ごとに連番で、全体で重複しない', () => {
  assert.equal(new Set(melodies.map((m) => m.id)).size, melodies.length, 'id が重複している');
  for (const [name, list, prefix] of BY_VERSION) {
    const expected = Array.from({ length: COUNT },
      (_, i) => `${prefix}${String(i + 1).padStart(4, '0')}`);
    assert.deepEqual(list.map((m) => m.id), expected, `${name}の id が連番でない`);
  }
});

test('全件が必須フィールドをすべて持つ', () => {
  for (const m of melodies) {
    for (const key of REQUIRED_KEYS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(m, key),
        `${m.id}: ${key} がない`,
      );
      assert.notEqual(m[key], undefined, `${m.id}: ${key} が undefined`);
    }
    assert.ok(Array.isArray(m.notes) && m.notes.length > 0, `${m.id}: notes が空`);
    assert.ok(Array.isArray(m.range) && m.range.length === 2, `${m.id}: range が2要素でない`);
    assert.ok(Array.isArray(m.tags), `${m.id}: tags が配列でない`);
    assert.equal(typeof m.contour, 'string', `${m.id}: contour が文字列でない`);
    for (const mode of MODES) {
      assert.ok(Array.isArray(m.fit?.[mode]) && m.fit[mode].length === 2, `${m.id}: fit.${mode} が2要素でない`);
      assert.ok(Array.isArray(m.sus?.[mode]) && m.sus[mode].length === 2, `${m.id}: sus.${mode} が2要素でない`);
    }
  }
});

test('notes は beat 昇順・8拍以内・deg 1〜15・vel 0〜1', () => {
  for (const m of melodies) {
    let prev = -Infinity;
    for (const n of m.notes) {
      assert.ok(Number.isFinite(n.beat), `${m.id}: beat が数値でない`);
      assert.ok(n.beat >= prev, `${m.id}: beat が昇順でない (${prev} -> ${n.beat})`);
      prev = n.beat;
      assert.ok(n.beat >= 0, `${m.id}: beat が負 (${n.beat})`);
      assert.ok(Number.isFinite(n.dur) && n.dur > 0, `${m.id}: dur が正の数でない (${n.dur})`);
      assert.ok(n.beat + n.dur <= 8, `${m.id}: 8拍を超える音符 (${n.beat}+${n.dur})`);
      assert.ok(Number.isInteger(n.deg), `${m.id}: deg が整数でない (${n.deg})`);
      assert.ok(n.deg >= 1 && n.deg <= 15, `${m.id}: deg が範囲外 (${n.deg})`);
      assert.ok(n.vel >= 0 && n.vel <= 1, `${m.id}: vel が範囲外 (${n.vel})`);
    }
  }
});

test('fit.major / fit.minor が両小節とも空でない', () => {
  for (const m of melodies) {
    for (const mode of MODES) {
      for (const bar of [0, 1]) {
        assert.ok(
          m.fit[mode][bar].length > 0,
          `${m.id}: fit.${mode}[${bar}] が空(どのコードにも乗らない)`,
        );
      }
    }
  }
});

test('fit / sus の添字が CHORD_VOCAB の範囲内', () => {
  for (const m of melodies) {
    for (const mode of MODES) {
      const size = CHORD_VOCAB[mode].length;
      for (const map of [m.fit, m.sus]) {
        for (const bar of [0, 1]) {
          for (const idx of map[mode][bar]) {
            assert.ok(Number.isInteger(idx), `${m.id}: 添字が整数でない (${idx})`);
            assert.ok(idx >= 0 && idx < size, `${m.id}: 添字が範囲外 ${idx} (mode=${mode}, size=${size})`);
          }
        }
      }
    }
  }
});

test('先頭20件の fit が fitsBar と完全一致する(取りこぼし・誤りの両方を検査)', () => {
  for (const m of melodies.slice(0, 20)) {
    const bars = splitBars(m.notes);
    for (const mode of MODES) {
      const vocab = CHORD_VOCAB[mode];
      for (const bar of [0, 1]) {
        const listed = new Set(m.fit[mode][bar]);
        for (let i = 0; i < vocab.length; i++) {
          const actual = fitsBar(bars[bar], mode, vocab[i]);
          assert.equal(
            listed.has(i),
            actual,
            `${m.id}: fit.${mode}[${bar}] と fitsBar が不一致 (${vocab[i]}: 記載=${listed.has(i)} 実際=${actual})`,
          );
        }
      }
    }
  }
});

test('6種類の輪郭がすべて存在し、各20件以上ある', () => {
  const counts = countBy((m) => m.contour);
  for (const c of CONTOURS) {
    const n = counts.get(c) ?? 0;
    assert.ok(n >= 20, `輪郭 ${c} が ${n} 件しかない`);
  }
  for (const c of counts.keys()) {
    assert.ok(CONTOURS.includes(c), `未知の輪郭 ${c}`);
  }
});

test('緊張度1〜5がすべて存在し、各50件以上ある', () => {
  const counts = countBy((m) => m.tension);
  for (const t of [1, 2, 3, 4, 5]) {
    const n = counts.get(t) ?? 0;
    assert.ok(n >= 50, `緊張度 ${t} が ${n} 件しかない`);
  }
});

test('peakDeg>=12 の断片が50件以上ある(クライマックス用)', () => {
  const climax = melodies.filter((m) => m.peakDeg >= 12);
  assert.ok(climax.length >= 50, `クライマックス用の断片が ${climax.length} 件しかない`);
});

test('peakDeg>=12 かつ頂点が1回だけの断片が80件以上ある', () => {
  const solo = melodies.filter((m) => m.peakDeg >= 12 && m.peakCount === 1);
  assert.ok(solo.length >= 80, `頂点の一回性を満たす断片が ${solo.length} 件しかない`);
});

// ---------------------------------------------------------------------------
// リズムの多様性（「音の長さが一定過ぎて全部童謡に聴こえる」への対策）
// ---------------------------------------------------------------------------

test('音価が3種類以上の断片が700件以上ある(リズムの単調さの主指標)', () => {
  const varied = melodies.filter((m) => distinctDurations(m.notes) >= 3);
  assert.ok(varied.length >= 700, `音価の多様な断片が ${varied.length} 件しかない`);
});

test('syncopation タグの断片が250件以上ある', () => {
  const sync = withTag('syncopation');
  assert.ok(sync.length >= 250, `syncopation が ${sync.length} 件しかない`);
});

test('has-rest タグの断片が200件以上ある(息継ぎ)', () => {
  const rests = withTag('has-rest');
  assert.ok(rests.length >= 200, `has-rest が ${rests.length} 件しかない`);
});

// ---------------------------------------------------------------------------
// 終わり方の作り分け
// ---------------------------------------------------------------------------
// 全断片が「伸ばして終わる」と、2小節ごとに律儀に区切られて聴こえる。
// 組み立て側はフレーズ末に終止感のある断片、途中に流す断片を選び分けるので、
// カタログに両方が要る。

const lastDurOf = (m) => m.notes[m.notes.length - 1].dur;

test('long-ending タグは「最後の音が2.5拍以上」と完全に一致する', () => {
  for (const m of melodies) {
    assert.equal(
      m.tags.includes('long-ending'),
      lastDurOf(m) >= 2.5,
      `${m.id}: タグと最終音の長さが食い違う (${lastDurOf(m)}拍, tags=${m.tags.join(',')})`,
    );
  }
});

test('long-ending の断片が版ごとに350〜550件ある(多すぎても少なすぎても困る)', () => {
  for (const [name, list] of BY_VERSION) {
    const n = list.filter((m) => m.tags.includes('long-ending')).length;
    assert.ok(n >= 350 && n <= 550, `${name}の long-ending が ${n} 件`);
  }
});

test('long-ending を持たない断片が版ごとに350件以上ある', () => {
  for (const [name, list] of BY_VERSION) {
    const n = list.filter((m) => !m.tags.includes('long-ending')).length;
    assert.ok(n >= 350, `${name}の終止感の無い断片が ${n} 件しかない`);
  }
});

test('最後の音が1拍以下の「流す」断片が250件以上ある', () => {
  const n = melodies.filter((m) => lastDurOf(m) <= 1).length;
  assert.ok(n >= 250, `流す断片が ${n} 件しかない`);
});

test('最後の音の長さが3種類以上に分布している', () => {
  const kinds = new Map();
  for (const m of melodies) kinds.set(lastDurOf(m), (kinds.get(lastDurOf(m)) ?? 0) + 1);
  assert.ok(kinds.size >= 3, `最終音の長さが ${kinds.size} 種類しかない`);
  // 1種類に8割が集まるような偏りを禁止する。
  const top = Math.max(...kinds.values());
  assert.ok(
    top <= melodies.length * 0.5,
    `最終音の長さが偏っている: ${JSON.stringify([...kinds].sort((a, b) => b[1] - a[1]))}`,
  );
});

// ---------------------------------------------------------------------------
// 大衆性・動機・密度
// ---------------------------------------------------------------------------

test('ペンタトニックの断片が penta-major 400件・penta-minor 250件以上ある', () => {
  assert.ok(withTag('penta-major').length >= 400, `penta-major が ${withTag('penta-major').length} 件しかない`);
  assert.ok(withTag('penta-minor').length >= 250, `penta-minor が ${withTag('penta-minor').length} 件しかない`);
});

test('inner-sequence が300件・inner-repeat が120件以上ある(動機の成立)', () => {
  assert.ok(withTag('inner-sequence').length >= 300, `inner-sequence が ${withTag('inner-sequence').length} 件しかない`);
  assert.ok(withTag('inner-repeat').length >= 120, `inner-repeat が ${withTag('inner-repeat').length} 件しかない`);
});

test('順次進行の割合が0.60〜0.80の断片が500件以上ある', () => {
  const band = melodies.filter((m) => {
    const r = metaOf(m).stepRatio;
    return r >= 0.6 && r <= 0.8;
  });
  assert.ok(band.length >= 500, `音程分布がコーパスの帯に入る断片が ${band.length} 件しかない`);
});

test('跳躍のあと順次進行で埋め戻す断片が500件以上ある', () => {
  const filled = melodies.filter((m) => {
    const r = metaOf(m).leapThenStep;
    return r !== null && r >= 0.6;
  });
  assert.ok(filled.length >= 500, `跳躍を埋め戻す断片が ${filled.length} 件しかない`);
});

test('コーパス由来の旋律型を含む断片が60%以上ある', () => {
  const hit = melodies.filter((m) => containsFormula(m.notes.map((n) => n.deg)));
  assert.ok(
    hit.length >= melodies.length * 0.6,
    `コーパスの型を含む断片が ${hit.length}/${melodies.length} しかない`,
  );
});

test('音数の中央値が8以上で、10音以上の断片が350件以上ある', () => {
  const lens = melodies.map((m) => m.notes.length);
  assert.ok(median(lens) >= 8, `音数の中央値が ${median(lens)} しかない`);
  const dense = lens.filter((n) => n >= 10).length;
  assert.ok(dense >= 350, `10音以上の断片が ${dense} 件しかない`);
});

// ---------------------------------------------------------------------------
// 進行の被覆（ここがゼロになると、その2小節が保険の全音符で埋まって曲が破綻する）
// ---------------------------------------------------------------------------

test('全99進行×198スロットに適合する断片が1件以上ある', () => {
  const slots = [];
  for (const p of progressions) {
    for (let k = 0; k * 2 + 1 < p.bars.length; k++) {
      slots.push({
        id: p.id,
        mode: p.mode,
        a: p.bars[2 * k].chord,
        b: p.bars[2 * k + 1].chord,
      });
    }
  }
  assert.equal(slots.length, 198, `スロット数が198でない: ${slots.length}`);

  const counts = slots.map((s) => {
    const ia = chordIndex(s.mode, s.a);
    const ib = chordIndex(s.mode, s.b);
    assert.ok(ia >= 0 && ib >= 0, `${s.id}: 語彙に無いコード ${s.a}->${s.b}`);
    return {
      label: `${s.id} ${s.mode} ${s.a}->${s.b}`,
      n: melodies.filter((m) => m.fit[s.mode][0].includes(ia) && m.fit[s.mode][1].includes(ib)).length,
    };
  });

  const empty = counts.filter((c) => c.n === 0);
  assert.equal(empty.length, 0, `適合断片ゼロのスロット: ${empty.map((c) => c.label).join(' / ')}`);
  // 組み立て側は音高の窓や緊張度でさらに絞るので、1件では実質枯れる。
  const worst = counts.reduce((a, b) => (a.n <= b.n ? a : b));
  assert.ok(worst.n >= 20, `最も痩せたスロットが ${worst.n} 件しかない: ${worst.label}`);
});

test('トニックで終わる断片が200件以上ある(着地感のある終止用)', () => {
  const resting = melodies.filter((m) => isTonicDeg(m.endDeg));
  assert.ok(resting.length >= 200, `トニック終止が ${resting.length} 件しかない`);
});

test('sigh タグの断片が100件以上ある(「泣ける」の中核要素)', () => {
  const sighs = withTag('sigh');
  assert.ok(sighs.length >= 100, `sigh が ${sighs.length} 件しかない`);
});

test('soar タグの断片が200件以上ある(「感動する瞬間」の形)', () => {
  const soars = withTag('soar');
  assert.ok(soars.length >= 200, `soar が ${soars.length} 件しかない`);
  // タグの中身が定義どおりか（頂点へ4度以上の上行、直後は2度以内の下降、頂点は1回）
  for (const m of soars) {
    const degs = m.notes.map((n) => n.deg);
    assert.ok(hasSoar(degs), `${m.id}: soar タグだが形が違う (${degs.join(',')})`);
  }
});

test('クライマックス用に、高く舞い上がる断片が120件以上ある', () => {
  const climax = melodies.filter(
    (m) => m.peakDeg >= 12 && m.peakCount === 1 && m.tags.includes('soar'),
  );
  assert.ok(climax.length >= 120, `頂点12以上の舞い上がりが ${climax.length} 件しかない`);
});

test('inner-motif タグの断片が50件以上ある', () => {
  const motifs = withTag('inner-motif');
  assert.ok(motifs.length >= 50, `inner-motif が ${motifs.length} 件しかない`);
});

test('tension は1〜5の整数、score は有限の数値', () => {
  for (const m of melodies) {
    assert.ok(Number.isInteger(m.tension), `${m.id}: tension が整数でない (${m.tension})`);
    assert.ok(m.tension >= 1 && m.tension <= 5, `${m.id}: tension が範囲外 (${m.tension})`);
    assert.ok(Number.isFinite(m.score), `${m.id}: score が有限の数値でない (${m.score})`);
  }
});

test('完全に同一の notes を持つ重複断片が5件以下', () => {
  const seen = new Set();
  const duplicates = [];
  for (const m of melodies) {
    const key = m.notes.map((n) => `${n.deg}:${n.beat}:${n.dur}:${n.vel}`).join(',');
    if (seen.has(key)) duplicates.push(m.id);
    seen.add(key);
  }
  assert.ok(
    duplicates.length <= 5,
    `重複した断片が ${duplicates.length} 件ある: ${duplicates.join(' ')}`,
  );
});
