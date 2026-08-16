import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHORD_VOCAB } from '../src/theory.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../src/data/progressions.json');
const progressions = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

const CADENCES = ['deceptive', 'authentic', 'plagal', 'open'];

// 転回形・テンションを取り除いた基本形。
function baseForm(symbol) {
  return symbol.replace(/(M7|7|sus4|add9)?(\/(3|5|7))?$/, '');
}

function chordsOf(p) {
  return p.bars.map((b) => b.chord).join(' - ');
}

function findExact(mode, bars) {
  return progressions.find((p) => p.mode === mode && chordsOf(p) === bars.join(' - ')) ?? null;
}

// 名曲で実際に使われている定番。ここが原形のまま残っていないと
// 「大衆的で人気のある進行を使う」という前提が崩れる。
const MAJOR_STANDARDS = [
  [['vi', 'IV', 'V', 'I'], '小室進行'],
  [['I', 'V', 'vi', 'IV'], 'アクシス進行'],
  [['vi', 'IV', 'I', 'V'], 'アクシス進行の回転形'],
  [['IV', 'V', 'iii', 'vi'], '王道進行'],
  [['I', 'vi', 'IV', 'V'], '50年代進行'],
  [['I', 'vi', 'ii', 'V'], '循環コード'],
  [['I', 'V/3', 'vi', 'iii'], 'カノン進行 前半'],
  [['IV', 'I/3', 'IV', 'V'], 'カノン進行 後半'],
  [['IV', 'V', 'I', 'vi'], '偽終止'],
  [['vi', 'V', 'IV', 'V'], '下降ベースのバラード常套句'],
  [['ii7', 'V7', 'IM7', 'IM7'], 'ツーファイブワン'],
  [['I', 'IV', 'V', 'I'], '全終止の基本形'],
];

const MINOR_STANDARDS = [
  [['i', 'VI', 'III', 'VII'], 'マイナーのアクシス進行'],
  [['i', 'VII', 'VI', 'VII'], '下降と回帰'],
  [['i', 'iv', 'v', 'i'], '短調の全終止'],
  [['i', 'VI', 'iv', 'V7'], '短調の王道'],
  [['VI', 'VII', 'i', 'i'], '盛り上がりの定番'],
  [['i', 'iv', 'VII', 'III'], '短調の循環'],
  [['i', 'VII', 'VI', 'V'], '下行バス'],
  [['i', 'VI', 'VII', 'i'], 'VI-VII-i'],
];

const POPULAR_4 = [
  ['major', ['IVM7', 'V', 'iii', 'vi']],
  ['major', ['I', 'iii', 'IV', 'V']],
  ['major', ['IV', 'iv', 'I', 'I']],
  ['major', ['IM7', 'iii7', 'vi7', 'IV']],
  ['major', ['I', 'IVM7', 'iv', 'I']],
  ['minor', ['i', 'v', 'VI', 'III']],
  ['minor', ['i', 'III', 'VII', 'iv']],
];

test('進行はちょうど99件', () => {
  assert.ok(Array.isArray(progressions));
  assert.equal(progressions.length, 99);
});

test('メジャー55件・マイナー44件', () => {
  const major = progressions.filter((p) => p.mode === 'major');
  const minor = progressions.filter((p) => p.mode === 'minor');
  assert.equal(major.length, 55);
  assert.equal(minor.length, 44);
  assert.equal(major.length + minor.length, progressions.length);
});

test('id は p01〜p99 で重複なし', () => {
  const ids = progressions.map((p) => p.id);
  assert.equal(new Set(ids).size, 99);
  const expected = Array.from({ length: 99 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
  assert.deepEqual([...ids].sort(), expected.sort());
  for (const id of ids) assert.match(id, /^p\d{2}$/);
});

test('bars は必ず4小節', () => {
  for (const p of progressions) {
    assert.ok(Array.isArray(p.bars), `${p.id}: bars は配列`);
    assert.equal(p.bars.length, 4, `${p.id}: bars が4要素ではない`);
    for (const bar of p.bars) {
      assert.equal(typeof bar.chord, 'string', `${p.id}: chord が文字列ではない`);
    }
  }
});

test('全コード記号が CHORD_VOCAB[mode] に含まれる', () => {
  for (const p of progressions) {
    const vocab = CHORD_VOCAB[p.mode];
    assert.ok(vocab, `${p.id}: 未知の mode ${p.mode}`);
    for (const bar of p.bars) {
      assert.ok(
        vocab.includes(bar.chord),
        `${p.id}: 語彙外のコード ${bar.chord} (mode=${p.mode})`,
      );
    }
  }
});

test('tension は4要素で各1〜5', () => {
  for (const p of progressions) {
    assert.ok(Array.isArray(p.tension), `${p.id}: tension は配列`);
    assert.equal(p.tension.length, 4, `${p.id}: tension が4要素ではない`);
    for (const t of p.tension) {
      assert.ok(Number.isInteger(t), `${p.id}: tension が整数ではない (${t})`);
      assert.ok(t >= 1 && t <= 5, `${p.id}: tension が範囲外 (${t})`);
    }
  }
});

test('cadence は4種類のいずれか', () => {
  for (const p of progressions) {
    assert.ok(CADENCES.includes(p.cadence), `${p.id}: 未知の cadence ${p.cadence}`);
  }
});

test('サブドミナントマイナーを含む進行が5件以上ある', () => {
  const sdm = progressions.filter(
    (p) => p.mode === 'major' && p.bars.some((b) => baseForm(b.chord) === 'iv'),
  );
  assert.ok(sdm.length >= 5, `サブドミナントマイナーが ${sdm.length} 件しかない`);
});

test('偽終止が3件以上ある', () => {
  const deceptive = progressions.filter((p) => p.cadence === 'deceptive');
  assert.ok(deceptive.length >= 3, `偽終止が ${deceptive.length} 件しかない`);
});

// ---------------------------------------------------------------------------
// 人気度
// ---------------------------------------------------------------------------

test('全件が popularity を持ち、1〜5の整数である', () => {
  for (const p of progressions) {
    assert.ok(Number.isInteger(p.popularity), `${p.id}: popularity が整数ではない (${p.popularity})`);
    assert.ok(p.popularity >= 1 && p.popularity <= 5, `${p.id}: popularity が範囲外 (${p.popularity})`);
  }
});

test('popularity >= 4 が50件以上ある', () => {
  const popular = progressions.filter((p) => p.popularity >= 4);
  assert.ok(popular.length >= 50, `popularity>=4 が ${popular.length} 件しかない`);
});

test('popularity の分布が上に偏りすぎず、色物も残っている', () => {
  // 全部が定番だと単調になる。陰りを担当する進行も必ず何件かは要る。
  const low = progressions.filter((p) => p.popularity <= 3);
  assert.ok(low.length >= 5, `popularity<=3 が ${low.length} 件しかない`);
});

test('全件が name（通称）を持つ', () => {
  for (const p of progressions) {
    assert.equal(typeof p.name, 'string', `${p.id}: name が文字列ではない`);
    assert.ok(p.name.length > 0, `${p.id}: name が空`);
  }
});

test('変形には由来が分かる name が付いている', () => {
  const variants = progressions.filter((p) => p.name.includes('の変形'));
  assert.ok(variants.length > 0, '変形が1件も無い');
  for (const v of variants) {
    // 「<原形の通称>の変形(...)」の形。原形が同じ通称でカタログに居るはず。
    const origin = v.name.slice(0, v.name.indexOf('の変形'));
    assert.ok(origin.length > 0, `${v.id}: 由来の通称が空 (${v.name})`);
    assert.ok(
      progressions.some((p) => p.name === origin),
      `${v.id}: 由来の原形 "${origin}" が見つからない`,
    );
  }
});

test('小室進行 vi - IV - V - I が popularity 5 で存在する', () => {
  const p = findExact('major', ['vi', 'IV', 'V', 'I']);
  assert.ok(p, '小室進行が無い');
  assert.equal(p.popularity, 5);
  assert.equal(p.mode, 'major');
  assert.equal(p.name, '小室進行');
});

// 定番は1つずつ確認する。まとめて件数だけ数えると、
// 1つ落ちても別の1つが増えれば気づけない。
for (const [bars, name] of MAJOR_STANDARDS) {
  test(`major 定番: ${bars.join(' - ')}（${name}）が原形のまま popularity 5 で存在する`, () => {
    const p = findExact('major', bars);
    assert.ok(p, `${name} (${bars.join(' - ')}) が無い`);
    assert.equal(p.popularity, 5, `${name}: popularity が ${p.popularity}`);
    assert.equal(p.name, name);
  });
}

for (const [bars, name] of MINOR_STANDARDS) {
  test(`minor 定番: ${bars.join(' - ')}（${name}）が原形のまま popularity 5 で存在する`, () => {
    const p = findExact('minor', bars);
    assert.ok(p, `${name} (${bars.join(' - ')}) が無い`);
    assert.equal(p.popularity, 5, `${name}: popularity が ${p.popularity}`);
    assert.equal(p.name, name);
  });
}

test('popularity 4 の常連が原形のまま入っている', () => {
  for (const [mode, bars] of POPULAR_4) {
    const p = findExact(mode, bars);
    assert.ok(p, `${mode} ${bars.join(' - ')} が無い`);
    assert.equal(p.popularity, 4, `${bars.join(' - ')}: popularity が ${p.popularity}`);
  }
});

test('色物（借用和音系）は popularity 3 以下に置かれている', () => {
  for (const bars of [['I', 'V', 'vi', 'bVI'], ['I', 'bVII', 'IV', 'I']]) {
    const p = findExact('major', bars);
    assert.ok(p, `${bars.join(' - ')} が無い`);
    assert.ok(p.popularity <= 3, `${bars.join(' - ')}: popularity が ${p.popularity}`);
  }
});

test('同一の進行が重複していない', () => {
  const keys = progressions.map((p) => `${p.mode}|${p.bars.map((b) => b.chord).join(' ')}`);
  const seen = new Set();
  for (const key of keys) {
    assert.ok(!seen.has(key), `重複した進行: ${key}`);
    seen.add(key);
  }
  assert.equal(seen.size, 99);
});
