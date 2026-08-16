import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARAM_DEFS, GROUP_LABELS, coerce, normalizeSettings, defaultSettings,
  encodeSongCode, decodeSongCode, composeParamKeys,
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
  const s = normalizeSettings({ tempoMin: 58, tempoMax: 70, majorRatio: 30, motifRecall: false });
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

test('曲コードにサウンド系は含まれない', () => {
  const code = encodeSongCode('x', defaultSettings());
  for (const d of PARAM_DEFS.filter((p) => p.group === 'sound')) {
    assert.ok(!d.code, `${d.key}: サウンド系に code がある`);
  }
  assert.ok(!code.includes('masterVolume'));
});

test('composeParamKeys は作曲系のキーだけを返す', () => {
  const keys = composeParamKeys();
  assert.ok(keys.includes('tempoMin'));
  assert.ok(keys.includes('motifRecall'));
  assert.ok(!keys.includes('masterVolume'));
});
