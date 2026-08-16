/**
 * 単一ファイル版ビルダー。
 *
 *   実行方法:  node tools/bundle.js
 *
 * index.html ＋ src/*.js ＋ src/data/*.json を1枚の HTML にまとめ、
 * プロジェクト直下へ melody-generator.html を書き出す。
 *
 * 目的は「ダブルクリックで開いて鳴る」こと。
 * index.html は `<script type="module">` と fetch() でデータを読むため、
 * file:// で開くとオリジンが null 扱いになり CORS で全部落ちる。
 * そこで
 *   - ES モジュールを最小のレジストリ方式へ変換して import を消す
 *   - JSON を <script type="application/json"> として埋め込み fetch を消す
 * の2点だけを機械的に行う。src/ 側は一切変更しない（サーバ版は今のまま動く）。
 *
 * 生成物 melody-generator.html はビルド成果物。手で編集せず、
 * 変更は src/ 側に入れてこのスクリプトを再実行すること。
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** エントリ。ここから import を辿って依存グラフを作る */
const ENTRY = 'main.js';

/** 生成物のファイル名 */
const OUT_NAME = 'melody-generator.html';

/** index.html の中で差し替える対象 */
const MODULE_TAG = '<script type="module" src="src/main.js"></script>';

// ---------------------------------------------------------------------------
// 小道具
// ---------------------------------------------------------------------------

function fail(message) {
  throw new Error(`bundle: ${message}`);
}

function readSrc(name) {
  return readFileSync(path.join(ROOT, 'src', name), 'utf8');
}

/** './rng.js' → 'rng.js'。src 直下以外を指していたら止める */
function resolveSpecifier(from, spec) {
  if (!spec.startsWith('./')) fail(`${from}: 相対指定でない import があります: ${spec}`);
  const name = spec.slice(2);
  if (name.includes('/')) fail(`${from}: src 直下以外の import には未対応です: ${spec}`);
  if (!name.endsWith('.js')) fail(`${from}: .js 以外の import には未対応です: ${spec}`);
  return name;
}

/** `a as b` を分割代名詞用の `a: b` に直す */
function parseSpecifierList(raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(s);
      if (m) return { local: m[1], exported: m[2] };
      if (!/^[A-Za-z_$][\w$]*$/.test(s)) fail(`未対応の指定子です: ${s}`);
      return { local: s, exported: s };
    });
}

// ---------------------------------------------------------------------------
// main.js だけの差し替え（fetch と import.meta.url を消す）
// ---------------------------------------------------------------------------

/** new URL('./data/x.json', import.meta.url) → 埋め込み要素の id */
const RE_DATA_URL = /new URL\(\s*(['"])\.\/data\/([\w.-]+)\.json\1\s*,\s*import\.meta\.url\s*\)/g;

/** async function fetchJson(...) { ... } を丸ごと差し替える */
const RE_FETCH_JSON = /^async function fetchJson\([^)]*\)\s*\{[\s\S]*?^\}$/m;

const FETCH_JSON_REPLACEMENT = [
  '// 単一ファイル版: fetch は file:// では使えないので、',
  '// ページに埋め込んだ application/json のブロックから id 指定で読む。',
  '// 呼び出し側の Promise.all / catch をそのまま活かすため async のまま残す。',
  'async function fetchJson(elementId) {',
  '  const el = document.getElementById(elementId);',
  '  if (!el) throw new Error(`埋め込みデータが見つかりません: ${elementId}`);',
  '  return JSON.parse(el.textContent);',
  '}',
].join('\n');

/**
 * main.js のデータ取得部分を埋め込みデータ参照へ差し替える。
 * @returns {{ code: string, dataNames: string[] }} dataNames は埋め込むべき JSON 名
 */
function patchDataAccess(source) {
  const dataNames = [];
  let code = source.replace(RE_DATA_URL, (_m, _q, name) => {
    dataNames.push(name);
    return `'${name}-data'`;
  });
  if (dataNames.length === 0) fail(`${ENTRY}: データ URL の組み立てを見つけられませんでした`);

  if (!RE_FETCH_JSON.test(code)) fail(`${ENTRY}: fetchJson の定義を見つけられませんでした`);
  code = code.replace(RE_FETCH_JSON, () => FETCH_JSON_REPLACEMENT);

  if (/import\.meta/.test(code)) fail(`${ENTRY}: import.meta が残っています`);
  if (/\bfetch\s*\(/.test(code)) fail(`${ENTRY}: fetch( が残っています`);
  return { code, dataNames };
}

// ---------------------------------------------------------------------------
// ES モジュール → レジストリ形式への変換
// ---------------------------------------------------------------------------

// 行頭固定で拾う。文字列や行中のコメントを巻き込まないための最低限の防御。
const RE_IMPORT_NAMED = /^import\s*\{([\s\S]*?)\}\s*from\s*(['"])([^'"]+)\2\s*;?[ \t]*$/gm;
const RE_IMPORT_NS = /^import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*(['"])([^'"]+)\2\s*;?[ \t]*$/gm;
const RE_IMPORT_DEFAULT = /^import\s+([A-Za-z_$][\w$]*)\s*from\s*(['"])([^'"]+)\2\s*;?[ \t]*$/gm;
const RE_IMPORT_BARE = /^import\s*(['"])([^'"]+)\1\s*;?[ \t]*$/gm;

const RE_EXPORT_FUNCTION = /^export\s+(async\s+)?function(\s*\*)?\s+([A-Za-z_$][\w$]*)/gm;
const RE_EXPORT_BINDING = /^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const RE_EXPORT_CLASS = /^export\s+class\s+([A-Za-z_$][\w$]*)/gm;
const RE_EXPORT_LIST = /^export\s*\{([^}]*)\}\s*;?[ \t]*$/gm;

/**
 * 1モジュールを変換する。
 *
 * import は require 呼び出しへ、export は宣言から外して末尾で exports に詰める。
 * 関数宣言は巻き上げられるので、末尾にまとめても循環参照以外では問題にならない。
 *
 * @returns {{ code: string, deps: string[] }}
 */
function transformModule(name, source) {
  const deps = new Set();
  const exported = []; // { local, exported }
  let code = source;

  const dep = (spec) => {
    const resolved = resolveSpecifier(name, spec);
    deps.add(resolved);
    return resolved;
  };

  // --- import ---
  code = code.replace(RE_IMPORT_NS, (_m, ns, _q, spec) => `const ${ns} = require('${dep(spec)}');`);

  code = code.replace(RE_IMPORT_NAMED, (_m, list, _q, spec) => {
    const parts = parseSpecifierList(list).map((s) =>
      (s.local === s.exported ? s.local : `${s.local}: ${s.exported}`),
    );
    const target = dep(spec);
    if (parts.length === 0) return `require('${target}');`;
    return `const { ${parts.join(', ')} } = require('${target}');`;
  });

  code = code.replace(RE_IMPORT_DEFAULT, (_m, local, _q, spec) =>
    `const ${local} = require('${dep(spec)}').default;`,
  );

  code = code.replace(RE_IMPORT_BARE, (_m, _q, spec) => `require('${dep(spec)}');`);

  // --- export ---
  if (/^export\s+default\b/m.test(code)) fail(`${name}: export default には未対応です`);
  if (/^export\s+(const|let|var)\s*[[{]/m.test(code)) {
    fail(`${name}: 分割代入つきの export には未対応です`);
  }
  if (/^export\s*\*/m.test(code)) fail(`${name}: export * には未対応です`);

  code = code.replace(RE_EXPORT_FUNCTION, (_m, asyncKw, star, fnName) => {
    exported.push({ local: fnName, exported: fnName });
    return `${asyncKw ?? ''}function${star ?? ''} ${fnName}`;
  });

  code = code.replace(RE_EXPORT_BINDING, (_m, kind, bindName) => {
    exported.push({ local: bindName, exported: bindName });
    return `${kind} ${bindName}`;
  });

  code = code.replace(RE_EXPORT_CLASS, (_m, className) => {
    exported.push({ local: className, exported: className });
    return `class ${className}`;
  });

  code = code.replace(RE_EXPORT_LIST, (_m, list) => {
    for (const s of parseSpecifierList(list)) exported.push(s);
    return '';
  });

  // 取りこぼしがあれば黙って壊れたものを出さず、ここで止める。
  if (/^\s*import\s/m.test(code)) fail(`${name}: 変換できない import が残っています`);
  if (/^\s*export\s/m.test(code)) fail(`${name}: 変換できない export が残っています`);

  if (exported.length > 0) {
    const lines = exported.map((s) => `exports.${s.exported} = ${s.local};`);
    code = `${code.replace(/\s*$/, '')}\n\n// --- exports ---\n${lines.join('\n')}\n`;
  }

  return { code, deps: [...deps] };
}

// ---------------------------------------------------------------------------
// 依存グラフ（エントリから辿って、依存が先に来る順に並べる）
// ---------------------------------------------------------------------------

function collectModules() {
  /** @type {Map<string, { code: string, deps: string[] }>} */
  const mods = new Map();
  const queue = [ENTRY];
  const dataNames = [];

  while (queue.length > 0) {
    const name = queue.shift();
    if (mods.has(name)) continue;
    let source = readSrc(name);
    if (name === ENTRY) {
      const patched = patchDataAccess(source);
      source = patched.code;
      dataNames.push(...patched.dataNames);
    }
    const mod = transformModule(name, source);
    mods.set(name, mod);
    for (const d of mod.deps) if (!mods.has(d)) queue.push(d);
  }

  // 深さ優先の後行順で、依存 → 依存元の順に並べる（循環は一度訪れた印で断つ）
  const order = [];
  const state = new Map(); // 'visiting' | 'done'
  const visit = (name) => {
    const s = state.get(name);
    if (s === 'done') return;
    if (s === 'visiting') return; // 循環。レジストリは遅延解決なので並び順だけ諦める
    state.set(name, 'visiting');
    for (const d of mods.get(name).deps) visit(d);
    state.set(name, 'done');
    order.push(name);
  };
  visit(ENTRY);

  return { mods, order, dataNames };
}

// ---------------------------------------------------------------------------
// 出力の組み立て
// ---------------------------------------------------------------------------

/**
 * HTML の raw text 要素の中に安全に置ける形へ JSON を直す。
 * `</script>` でその場に要素が閉じてしまうのを防ぐ。`<\/` も `<` も
 * JSON 文字列としては元の文字に戻るので、JSON.parse の結果は変わらない
 * （JSON では `<` は文字列の中にしか現れない）。
 */
function escapeJsonForHtml(text) {
  const closes = (text.match(/<\//g) || []).length;
  const comments = (text.match(/<!--/g) || []).length;
  const out = text.replace(/<\//g, '<\\/').replace(/<!--/g, '\\u003c!--');
  return { text: out, closes, comments };
}

function buildBundleScript(mods, order) {
  const parts = [];
  parts.push('(function () {');
  parts.push("'use strict';");
  parts.push('// --- 最小モジュールレジストリ（ES モジュールの import/export の代わり） ---');
  parts.push('var __mods = {};');
  parts.push('var __cache = {};');
  parts.push('function __req(name) {');
  parts.push('  if (Object.prototype.hasOwnProperty.call(__cache, name)) return __cache[name];');
  parts.push('  var mod = { exports: {} };');
  parts.push('  __cache[name] = mod.exports;');
  parts.push('  if (!__mods[name]) throw new Error("module not found: " + name);');
  parts.push('  __mods[name](mod.exports, __req);');
  parts.push('  return mod.exports;');
  parts.push('}');
  parts.push('');

  for (const name of order) {
    parts.push(`// ===== src/${name} =====`);
    parts.push(`__mods[${JSON.stringify(name)}] = function (exports, require) {`);
    parts.push(mods.get(name).code.replace(/\s*$/, ''));
    parts.push('};');
    parts.push('');
  }

  parts.push('// --- 起動 ---');
  parts.push(`__req(${JSON.stringify(ENTRY)});`);
  parts.push('})();');
  return parts.join('\n');
}

function main() {
  const { mods, order, dataNames } = collectModules();

  // --- データの読み込みと埋め込み ---
  const dataBlocks = [];
  let escapedCloses = 0;
  let escapedComments = 0;
  for (const name of dataNames) {
    const raw = readFileSync(path.join(ROOT, 'src', 'data', `${name}.json`), 'utf8').trim();
    JSON.parse(raw); // 壊れた JSON を埋め込まない
    const esc = escapeJsonForHtml(raw);
    escapedCloses += esc.closes;
    escapedComments += esc.comments;
    dataBlocks.push(
      `<script id="${name}-data" type="application/json">${esc.text}</script>`,
    );
  }

  const script = buildBundleScript(mods, order);
  // インライン script の中身は raw text なので、HTML パーサの終了判定や
  // 「エスケープ済みスクリプト」状態に入る綴りが混ざっていたらページごと壊れる。
  // JS 側は自動エスケープできない（意味が変わる）ので、見つけたら止める。
  for (const bad of ['</script', '<script', '<!--']) {
    if (script.includes(bad)) {
      fail(`生成コードに ${bad} が含まれています（コメントや文字列から取り除いてください）`);
    }
  }

  // --- index.html への差し込み ---
  let html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const tagCount = html.split(MODULE_TAG).length - 1;
  if (tagCount !== 1) fail(`index.html の module script タグが ${tagCount} 個です（1個のはず）`);

  const banner = [
    '<!--',
    '  melody-generator.html — 単一ファイル自己完結版（自動生成物・直接編集しないこと）',
    '',
    '  ダブルクリックで開けます。file:// でもそのまま動くよう、',
    '  src/*.js と src/data/*.json をこの1枚に埋め込んであります。',
    '  ネットワークアクセスも外部ファイルも一切必要ありません。',
    '',
    '  作り直す:  node tools/bundle.js',
    '  中身を直す: src/ 側を直して、上のコマンドを実行し直すこと',
    '-->',
  ].join('\n');

  const doctypeMatch = /^<!doctype html>\r?\n/i.exec(html);
  if (!doctypeMatch) fail('index.html の先頭に <!doctype html> がありません');
  html = html.slice(0, doctypeMatch[0].length) + banner + '\n' + html.slice(doctypeMatch[0].length);

  const bodyMatch = /<body>\r?\n/.exec(html);
  if (!bodyMatch) fail('index.html に <body> が見つかりません');
  const insertAt = bodyMatch.index + bodyMatch[0].length;
  const dataSection = [
    '<!-- 埋め込みデータ（fetch の代わり。src/data/*.json と同じ中身） -->',
    ...dataBlocks,
    '',
  ].join('\n');
  html = html.slice(0, insertAt) + dataSection + html.slice(insertAt);

  // type 属性なしの普通の script にする。module にすると import が無くても
  // file:// でのモジュール解決の作法に引きずられるため、素の script が一番安全。
  html = html.replace(
    MODULE_TAG,
    `<script>\n${script}\n</script>`,
  );

  const outPath = path.join(ROOT, OUT_NAME);
  writeFileSync(outPath, html, 'utf8');

  const bytes = statSync(outPath).size;
  console.log(`書き出し: ${OUT_NAME}`);
  console.log(`  モジュール: ${order.length} 件（${order.join(' → ')}）`);
  console.log(`  埋め込みデータ: ${dataNames.map((n) => `${n}.json`).join(', ')}`);
  console.log(`  エスケープした </ : ${escapedCloses} 箇所 / <!-- : ${escapedComments} 箇所`);
  console.log(`  サイズ: ${bytes.toLocaleString('en-US')} バイト (${(bytes / 1024).toFixed(1)} KiB)`);
}

main();
