/**
 * 手册录制用的本地演示服务。
 *
 * 静态托管一份把接口地址设成 /api 的前端构建，所有 /api 请求由 mockApi.mjs 回答。
 * 录制全程不碰线上：没有真实账号、没有真实数据、没有 AI 调用。
 * AI 的流式回复由这里按节奏逐段写出，录下来和真实使用时的观感一致。
 *
 *   CAPTURE_DIST=<构建目录> node scripts/manual-capture/server.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleApi } from './mockApi.mjs';

const DIST = path.resolve(process.env.CAPTURE_DIST ?? 'capture-dist');
const PORT = Number(process.env.CAPTURE_PORT ?? 5288);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.txt': 'text/plain',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__mock/')) {
      await handleApi(req, res, url);
      return;
    }
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error('[server]', req.method, url.pathname, err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`[manual-capture] http://127.0.0.1:${PORT}  dist=${DIST}`));
