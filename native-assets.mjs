import { allowedNativeAsset, maximumAssetBytes, nativeAssetLifetime, nativeAssetType, validNativeAsset } from './asset-policy.mjs';
export { allowedNativeAsset } from './asset-policy.mjs';

const cache = new Map();
const pending = new Map();
let cacheBytes = 0;
const maximumBytes = 128 * 1024 * 1024;

async function loadAsset(path) {
  const response = await fetch(`https://www.midnight.city${path}`, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`City asset unavailable (${response.status})`);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumAssetBytes) { await reader.cancel(); throw new Error('City asset too large'); }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);
  if (!validNativeAsset(path, buffer)) throw new Error('Invalid city asset');
  while (cacheBytes + buffer.length > maximumBytes && cache.size) {
    const key = cache.keys().next().value; cacheBytes -= cache.get(key).buffer.length; cache.delete(key);
  }
  const asset = { buffer, expires: Date.now() + nativeAssetLifetime(path) * 1000 };
  cache.set(path, asset); cacheBytes += buffer.length;
  return asset;
}

export async function nativeAssets(request, response) {
  const requested = request.url ?? '';
  if (!requested.startsWith('/native-assets/')) return false;
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return true; }
  const path = requested.slice('/native-assets'.length);
  if (!allowedNativeAsset(path)) { response.writeHead(404).end(); return true; }
  try {
    let asset = cache.get(path);
    if (asset && asset.expires < Date.now()) { cacheBytes -= asset.buffer.length; cache.delete(path); asset = undefined; }
    if (!asset) {
      let job = pending.get(path);
      if (!job) { job = loadAsset(path).finally(() => pending.delete(path)); pending.set(path, job); }
      asset = await job;
    }
    response.writeHead(200, { 'Content-Type': nativeAssetType(path), 'Content-Length': asset.buffer.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': `public, max-age=${nativeAssetLifetime(path)}` });
    response.end(request.method === 'HEAD' ? undefined : asset.buffer);
  } catch { response.writeHead(502).end('City artwork unavailable'); }
  return true;
}
