import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { nativeAssets } from './native-assets.mjs';

const root = resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const cache = new Map();
let cacheBytes = 0;

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
  try {
    if (await nativeAssets(request, response)) return;
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path.startsWith('/city-assets/')) {
      if (!/^\/city-assets\/[a-z0-9-]+\.glb$/.test(path)) { response.writeHead(404).end(); return; }
      let buffer = cache.get(path);
      if (!buffer) {
        const upstream = await fetch(`https://www.midnight.city/models/city-neon/${path.split('/').at(-1)}`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
        if (!upstream.ok || !upstream.headers.get('content-type')?.includes('model/gltf-binary')) { response.writeHead(502).end('City model unavailable'); return; }
        const reader = upstream.body.getReader(), chunks = []; let size = 0;
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 24 * 1024 * 1024) { await reader.cancel(); throw new Error('Model too large'); }
          chunks.push(value);
        }
        buffer = Buffer.concat(chunks);
        if (buffer.subarray(0, 4).toString() !== 'glTF') throw new Error('Invalid model');
        while (cacheBytes + buffer.length > 96 * 1024 * 1024 && cache.size) {
          const key = cache.keys().next().value; cacheBytes -= cache.get(key).length; cache.delete(key);
        }
        cache.set(path, buffer); cacheBytes += buffer.length;
      }
      response.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=3600' });
      response.end(request.method === 'HEAD' ? undefined : buffer); return;
    }
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
    const immutable = /^\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.(js|css)$/.test(decoded);
    response.writeHead(200, { 'Content-Type': mime[extname(filename)] ?? 'application/octet-stream', 'Content-Length': deliveredSize, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : await readFile(delivered));
  } catch { response.writeHead(502).end('The requested resource is unavailable.'); }
});

server.listen(Number(process.env.PORT ?? 4173), process.env.HOST ?? '127.0.0.1', () => console.log(`Walk Midnight: http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 4173}`));
