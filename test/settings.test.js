import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARAM_DEFS, GROUP_LABELS, coerce, normalizeSettings, defaultSettings,
  encodeSongCode, decodeSongCode, composeParamKeys, visibleParams, resolveSettings,
} from '../src/settings.js';

test('全パラメータが必須項目を持つ', () => {
  for (const d of PARAM_DEFS) {
    assert.ok(d.key, 'key がない');
    assert.ok(d.label, `${d.key}: label がない`);
    assert.ok(['sound', 'humanize', 'compose'].includes(d.group), `${d.key}: group が不正`);
    assert.ok(['range', 'toggle', 'choice'].includes(d.type), `${d.key}: type が不正`);
    assert.ok(['live', 'next'].includes(d.apply), `${d.key}: apply が不正`);
    assert.ok(d.def !== undefined, `${d.key}: def がない`);
    assert.ok(GROUP_LABELS[d.group], `${d.group}: 表示名がない`);
    if (d.type === 'range') {
      assert.ok(typeof d.min === 'number' && typeof d.max === 'number', `${d.key}: min/max がない`);
      assert.ok(d.def >= d.min && d.def <= d.max, `${d.key}: 既定値が範囲外`);
    }
    if (d.type === 'choice') {
      assert.ok(Array.isArray(d.options) && d.options.length >= 2, `${d.key}: options が不足`);
      assert.ok(d.options.some(([v]) => v === d.def), `${d.key}: 既定値が選択肢にない`);
    }
  }
});

test('key が重複していない', () => {
  const keys = PARAM_DEFS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('code が重複していない', () => {
  const codes = PARAM_DEFS.filter((d) => d.code).map((d) => d.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(!codes.includes('s'), '"s" はシード用に予約');
});

test('coerce は範囲外の数値を丸める', () => {
  const def = { type: 'range', min: 0, max: 100, def: 50 };
  assert.equal(coerce(def, 150), 100);
  assert.equal(coerce(def, -5), 0);
  assert.equal(coerce(def, 'abc'), 50);
  assert.equal(coerce(def, '30'), 30);
});

test('coerce は選択肢外の値を既定値に戻す', () => {
  const def = { type: 'choice', options: [['a', 'A'], ['b', 'B']], def: 'a' };
  assert.equal(coerce(def, 'b'), 'b');
  assert.equal(coerce(def, 'z'), 'a');
});

test('coerce は toggle を真偽値にする', () => {
  const def = { type: 'toggle', def: true };
  assert.equal(coerce(def, '1'), true);
  assert.equal(coerce(def, 0), false);
  assert.equal(coerce(def, false), false);
});

test('normalizeSettings は欠けたキーを既定値で埋める', () => {
  const s = normalizeSettings({ masterVolume: 20 });
  assert.equal(s.masterVolume, 20);
  for (const d of PARAM_DEFS) assert.ok(s[d.key] !== undefined, `${d.key} が埋まっていない`);
});

test('normalizeSettings はテンポの上下限が逆なら入れ替える', () => {
  const s = normalizeSettings({ tempoMin: 80, tempoMax: 60 });
  assert.equal(s.tempoMin, 60);
  assert.equal(s.tempoMax, 80);
});

test('defaultSettings は定義どおりの既定値を返す', () => {
  const s = defaultSettings();
  for (const d of PARAM_DEFS) assert.equal(s[d.key], d.def, `${d.key} の既定値が違う`);
});

test('曲コードは往復する', () => {
  const s = normalizeSettings({ mood: 'wistful', tempoFeel: 'flowing' });
  const code = encodeSongCode('a3f91c', s);
  const back = decodeSongCode(code);
  assert.equal(back.seed, 'a3f91c');
  for (const key of composeParamKeys()) {
    assert.equal(back.settings[key], s[key], `${key} が往復しない`);
  }
});

test('曲コードは先頭の # を許容する', () => {
  const code = encodeSongCode('zzz', defaultSettings());
  assert.equal(decodeSongCode('#' + code).seed, 'zzz');
});

test('壊れた曲コードでも既定値で復帰する', () => {
  const r = decodeSongCode('ゴミ&&=&tn=abc');
  assert.equal(r.seed, null);
  assert.equal(r.settings.tempoMin, defaultSettings().tempoMin);
});

// 曲コードに載せる基準は「グループ」ではなく「同じコードから同じものが聴こえるか」。
// 楽器は聴こえ方を変えるので載せる。音量やリバーブは聴く側の都合なので載せない。
test('曲コードに音量やリバーブは含まれない', () => {
  const code = encodeSongCode('x', defaultSettings());
  for (const d of PARAM_DEFS.filter((p) => p.type === 'range' && p.group === 'sound')) {
    assert.ok(!d.code, `${d.key}: 聴く側の都合の値に code がある`);
  }
  assert.ok(!code.includes('masterVolume'));
});

test('曲コードに楽器が載る', () => {
  const base = encodeSongCode('x', defaultSettings());
  const koto = encodeSongCode('x', { ...defaultSettings(), instrument: 'koto' });
  assert.notEqual(koto, base, '楽器を変えても曲コードが変わらない');
  assert.equal(decodeSongCode(koto).settings.instrument, 'koto');
});

test('シードだけの短い曲コードは、初版の既定値を指す', () => {
  // URL のハッシュに載るので短さがそのまま使い勝手になる……のだが、
  // 桁を省いてよいのは初版の既定値のときだけ。桁の無いコードは初版として
  // 解かれるので、最新の生成器の曲で桁を省くと、自分のコードが別の曲を指す。
  const v1 = { ...defaultSettings(), generatorVersion: '1' };
  assert.equal(encodeSongCode('k3f9zq', v1), 'k3f9zq');

  // 共有済みの短いコードは、いまも初版の既定値として解ける。
  const back = decodeSongCode('k3f9zq');
  assert.equal(back.seed, 'k3f9zq');
  assert.equal(back.settings.generatorVersion, '1');
  assert.equal(back.settings.mood, defaultSettings().mood);

  // 最新の生成器の曲は必ず桁を書く。
  const now = encodeSongCode('k3f9zq', defaultSettings());
  assert.match(now, /^k3f9zq\.[0-9a-z]+$/, now);
  assert.equal(decodeSongCode(now).settings.generatorVersion,
    defaultSettings().generatorVersion);
});

test('桁の足りない曲コードは、生成器の版だけ初版に倒れる', () => {
  // 版が増える前に共有されたコードには gv の桁が無い。既定値（＝最新）に
  // 倒すと、共有済みの URL が全部べつの曲を鳴らすことになる。
  for (const code of ['k3f9zq', 'k3f9zq.114', 's=abc&md=bright']) {
    assert.equal(decodeSongCode(code).settings.generatorVersion, '1', code);
  }
});

test('曲コードは選択肢を1文字ずつに詰める', () => {
  const code = encodeSongCode('k3f9zq', {
    ...defaultSettings(), mood: 'wistful', tempoFeel: 'flowing', instrument: 'santur',
  });
  assert.match(code, /^k3f9zq\.[0-9a-z]+$/, code);
  assert.ok(code.length <= 12, `曲コードが長い: ${code}`);
  const back = decodeSongCode(code).settings;
  assert.equal(back.mood, 'wistful');
  assert.equal(back.tempoFeel, 'flowing');
  assert.equal(back.instrument, 'santur');
});

test('古い形式の曲コードも読める', () => {
  // 共有済みの URL を壊さない。
  const back = decodeSongCode('#s=abc123&md=bright&tp=slow&it=harp');
  assert.equal(back.seed, 'abc123');
  assert.equal(back.settings.mood, 'bright');
  assert.equal(back.settings.tempoFeel, 'slow');
  assert.equal(back.settings.instrument, 'harp');
});

test('composeParamKeys は作曲系のキーだけを返す', () => {
  const keys = composeParamKeys();
  assert.ok(keys.includes('mood'));
  assert.ok(keys.includes('tempoFeel'));
  assert.ok(!keys.includes('masterVolume'));
});

test('画面に出すのは4項目だけ', () => {
  const vis = visibleParams();
  assert.equal(vis.length, 4, `画面に出す項目が4つでない: ${vis.map((d) => d.key).join(',')}`);
  assert.deepEqual(vis.map((d) => d.key).sort(),
    ['instrument', 'masterVolume', 'mood', 'tempoFeel']);
});

test('全パラメータが ui 真偽値を持つ', () => {
  for (const d of PARAM_DEFS) {
    assert.equal(typeof d.ui, 'boolean', `${d.key}: ui が真偽値でない`);
  }
});

test('曲コードに載るのは画面に出す作曲パラメータと、生成器の版だけ', () => {
  // 版は例外。ユーザーが選ぶ好みではなく「そのコードが指す曲を再現するための
  // 目印」なので、画面には出さないが曲コードには載せる。
  for (const d of PARAM_DEFS) {
    if (!d.code || d.key === 'generatorVersion') continue;
    assert.equal(d.ui, true, `${d.key}: 画面に出さないのに曲コードに載っている`);
  }
  const gv = PARAM_DEFS.find((d) => d.key === 'generatorVersion');
  assert.ok(gv?.code, '生成器の版が曲コードに載っていない');
  assert.equal(gv.ui, false, '生成器の版は画面に出さない');
  // !!! 版は必ず末尾 !!! 途中に入れると、共有済みのコードの添字がずれる。
  const coded = PARAM_DEFS.filter((d) => d.code && d.type === 'choice');
  assert.equal(coded[coded.length - 1].key, 'generatorVersion',
    '生成器の版が曲コードの末尾にない');
});

test('resolveSettings は雰囲気を長調比率へ展開する', () => {
  const bright = resolveSettings({ mood: 'bright' });
  const wistful = resolveSettings({ mood: 'wistful' });
  assert.ok(bright.majorRatio > 80, `明るめの長調比率が低い: ${bright.majorRatio}`);
  assert.ok(wistful.majorRatio < 25, `切なめの長調比率が高い: ${wistful.majorRatio}`);
});

test('resolveSettings はテンポ感をBPM範囲へ展開する', () => {
  const slow = resolveSettings({ tempoFeel: 'slow' });
  const normal = resolveSettings({ tempoFeel: 'normal' });
  const flowing = resolveSettings({ tempoFeel: 'flowing' });
  assert.ok(slow.tempoMax < normal.tempoMin, 'ゆっくりとふつうの範囲が重なっている');
  assert.ok(normal.tempoMax < flowing.tempoMin, 'ふつうと少し速めの範囲が重なっている');
  // 「普通のピアノ曲」として成立する速さであること
  assert.ok(normal.tempoMin >= 76, `ふつうが遅すぎる: ${normal.tempoMin}`);
});

test('resolveSettings は画面に出さない値を既定のまま渡す', () => {
  const r = resolveSettings({});
  assert.equal(r.songBars, '32');
  assert.equal(r.motifRecall, true);
  assert.equal(r.musicKey, 'random');
  assert.equal(r.curveStrength, 100);
});
