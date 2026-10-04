import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.json': 'application/json' };

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    const decoded = decodeURIComponent(path), filename = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
    if (!filename.startsWith(root + sep)) { response.writeHead(404).end(); return; }
    const info = await stat(filename).catch(() => null);
    if (!info?.isFile()) { response.writeHead(404).end('Not found'); return; }
    const compressible = /\.(js|css)$/.test(filename);
    let delivered = filename, deliveredSize = info.size, encoding;
    if (compressible) {
      response.setHeader('Vary', 'Accept-Encoding');
      const accepted = new Map(String(request.headers['accept-encoding'] ?? '').toLowerCase().split(',').map(value => {
        const [name, ...parameters] = value.trim().split(';');
        const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
        return [name, quality ? Number(quality.trim().slice(2)) : 1];
      }));
      const candidates = [['br', '.br'], ['gzip', '.gz']].map(([name, suffix]) => ({ name, suffix, quality: accepted.get(name) ?? accepted.get('*') ?? 0 })).filter(candidate => candidate.quality > 0).sort((left, right) => right.quality - left.quality);
      for (const candidate of candidates) {
        const compressed = await stat(filename + candidate.suffix).catch(() => null);
        if (!compressed?.isFile()) continue;
        delivered = filename + candidate.suffix; deliveredSize = compressed.size; encoding = candidate.name;
        break;
      }
    }
    if (encoding) response.setHeader('Content-Encoding', encoding);
    const immutable = /^\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.(js|css)$/.test(decoded) || /^\/native-assets\/[a-f0-9]{16}\//.test(decoded);
    response.writeHead(200, { 'Content-Type': mime[extname(filename)] ?? 'application/octet-stream', 'Content-Length': deliveredSize, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : await readFile(delivered));
  } catch { response.writeHead(502).end('The requested resource is unavailable.'); }
});

server.listen(Number(process.env.PORT ?? 4173), process.env.HOST ?? '127.0.0.1', () => console.log(`Walk Midnight: http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 4173}`));
