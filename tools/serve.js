/**
 * 開発用の静的サーバ。
 *
 *   実行方法:  node tools/serve.js [ポート]   （npm start から呼ばれる）
 *
 * わざわざ自前で書いているのは、キャッシュを完全に切るためだけである。
 *
 * `python3 -m http.server` は Cache-Control を返さない。返さないと、ブラウザは
 * 「Last-Modified からの経過時間の1割」を勝手に鮮度とみなして再確認を省く
 * （RFC 9111 の heuristic freshness）。つまり**さっき直したファイルほど**
 * 再確認されずにキャッシュから返る。src/*.js を書き換えて再読み込みしても
 * 古いままの音が鳴る、という現象の正体はこれで、
 * 音源やスケールを直しても「何も変わっていない」ようにしか見えなくなる。
 *
 * 開発中に古いファイルが返る不利益のほうが、キャッシュの利益より遥かに大きい。
 * ここでは no-store を必ず付けて、毎回必ず読み直させる。
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mid': 'audio/midi',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  });
  res.end(body);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  // ルート外への脱出を止める。開発用でも、辿れる範囲はこのリポジトリの中だけにする。
  const file = path.resolve(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    send(res, 403, '403 Forbidden');
    return;
  }

  let target = file;
  try {
    if (statSync(target).isDirectory()) target = path.join(target, 'index.html');
    statSync(target);
  } catch {
    send(res, 404, `404 Not Found: /${rel}`);
    return;
  }

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  });
  createReadStream(target).pipe(res);
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}/  （キャッシュ無効。保存してリロードすれば必ず反映されます）`);
});
