// Fixture server for E2E tests (127.0.0.1 only), plus a logging proxy.
// Chrome is launched with --proxy-server pointing at the proxy; loopback
// traffic bypasses it, so any request that would leave the machine lands
// here, is refused, and is recorded for the privacy assertions.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { PNG } from 'pngjs';

const ROOT = join(import.meta.dirname, 'fixtures');
const PORT = Number(process.env.FIXTURE_PORT ?? 4517);
const PROXY_PORT = Number(process.env.PROXY_PORT ?? 4518);
const log = [];

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export function colorFor(i) {
  return [(i * 67 + 40) % 256, (i * 131 + 90) % 256, (i * 29 + 160) % 256];
}

function solidPng(i, w = 400, h = 300) {
  const png = new PNG({ width: w, height: h });
  const [r, g, b] = colorFor(i);
  for (let p = 0; p < w * h; p++) png.data.set([r, g, b, 255], p * 4);
  return PNG.sync.write(png);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/__proxylog') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(log));
  }
  if (url.pathname === '/__proxylog/clear') {
    log.length = 0;
    return res.end('ok');
  }
  const img = /^\/img\/(\d+)\.png$/.exec(url.pathname);
  if (img) {
    const delay = Number(url.searchParams.get('delay') ?? 0);
    await new Promise((r) => setTimeout(r, delay));
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
    return res.end(solidPng(Number(img[1])));
  }
  const path = normalize(join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!path.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`fixtures on http://127.0.0.1:${PORT}`));

const proxy = createServer((req, res) => {
  log.push({ method: req.method, url: req.url, at: Date.now() });
  res.writeHead(403).end('blocked by LocalFullPageCapture privacy test');
});
proxy.on('connect', (req, socket) => {
  socket.on('error', () => {});
  log.push({ method: 'CONNECT', url: req.url, at: Date.now() });
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
});
proxy.on('clientError', (_e, socket) => socket.destroy());
// Browsers drop proxied sockets abruptly; never let that take the fixture server down.
process.on('uncaughtException', (e) => console.error('server error (ignored):', e.code ?? e.message));
proxy.listen(PROXY_PORT, '127.0.0.1', () => console.log(`proxy on 127.0.0.1:${PROXY_PORT}`));
