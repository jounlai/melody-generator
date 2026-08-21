#!/usr/bin/env node
// 「別れ」の曲を、単体で開ける HTML にする。
// モジュールの畳み込みは bundle.js の仕組みをそのまま使う（名前の衝突を避けるため）。
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from '../src/elegySong.js';
import { collectFrom, buildBundleScript, escapeJsonForHtml } from './bundle.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const { song, seed, issues } = compose(1);

// 再生と楽譜に要るモジュールだけを畳む。
const { mods, order } = collectFrom('elegyPlayer.js');
const script = buildBundleScript(mods, order);
const json = escapeJsonForHtml(JSON.stringify(song));

const html = `<!doctype html>
<html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>別れ — C minor</title>
<style>
 body{background:#12141a;color:#e8e6e3;font:16px/1.7 system-ui,-apple-system,sans-serif;
      display:flex;flex-direction:column;align-items:center;gap:1.2rem;padding:2rem 1rem;margin:0}
 h1{font-size:1.15rem;font-weight:600;letter-spacing:.1em;margin:0}
 p{margin:0;color:#9aa0a6;font-size:.82rem;text-align:center;max-width:34rem}
 button{background:#e8e6e3;color:#12141a;border:0;border-radius:999px;
        padding:.7rem 2.4rem;font-size:1rem;cursor:pointer}
 button:disabled{opacity:.45;cursor:default}
 #score{background:#fff;border-radius:8px;max-width:100%;overflow-x:auto}
</style>
<h1>別れ</h1>
<p>C minor ／ 4/4 ／ 68 BPM ／ 32小節 ／ ピアノ独奏<br>
提示 — 喪失 — クライマックス — 回想</p>
<button id="play">再生</button>
<div id="score"></div>
<script id="song" type="application/json">${json.text}</script>
<script>
${script}
</script>
</html>
`;
writeFileSync(resolve(HERE, '../out/elegy.html'), html, 'utf8');
console.log(`out/elegy.html  種 ${seed} / ${issues.length ? `違反 ${issues.length}` : '検査すべて通過'}`);
