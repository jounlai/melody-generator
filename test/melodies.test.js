import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHORD_VOCAB, splitBars, fitsBar, chordIndex } from '../src/theory.js';
import { distinctDurations } from '../tools/analyze.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../src/data/melodies.json');
const PROG_PATH = resolve(HERE, '../src/data/progressions.json');
const melodies = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const progressions = JSON.parse(readFileSync(PROG_PATH, 'utf8'));

const COUNT = 999;
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

// 順次進行(2度以内)の割合。名曲のメロディーの音程分布に一致する帯は 55〜80%。
const stepRatioOf = (m) => {
  const degs = m.notes.map((n) => n.deg);
  const intervals = degs.slice(1).map((d, i) => d - degs[i]);
  if (intervals.length === 0) return 0;
  return intervals.filter((d) => Math.abs(d) >= 1 && Math.abs(d) <= 2).length / intervals.length;
};

test('断片はちょうど999件', () => {
  assert.ok(Array.isArray(melodies));
  assert.equal(melodies.length, COUNT);
});

test('id は m0001〜m0999 で重複なし', () => {
  const ids = melodies.map((m) => m.id);
  assert.equal(new Set(ids).size, COUNT, 'id が重複している');
  const expected = Array.from({ length: COUNT }, (_, i) => `m${String(i + 1).padStart(4, '0')}`);
  assert.deepEqual(ids, expected);
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

test('全断片の最後の音が1.5拍以上(フレーズの終わりで息を継ぐ)', () => {
  for (const m of melodies) {
    const last = m.notes[m.notes.length - 1];
    assert.ok(last.dur >= 1.5, `${m.id}: 最終音が短い (${last.dur})`);
  }
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

test('順次進行の割合が55〜80%の断片が400件以上ある', () => {
  const band = melodies.filter((m) => stepRatioOf(m) >= 0.55 && stepRatioOf(m) <= 0.8);
  assert.ok(band.length >= 400, `音程分布が名曲の帯に入る断片が ${band.length} 件しかない`);
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
