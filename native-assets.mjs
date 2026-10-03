const cache = new Map();
const pending = new Map();
let cacheBytes = 0;
const maximumBytes = 128 * 1024 * 1024;

export function allowedNativeAsset(path) {
  return /^\/models\/city-neon\/[a-z0-9-]+\.(glb|png|hdr)$/.test(path)
    || /^\/characters\/[a-z0-9_]+\.png$/.test(path)
    || /^\/api\/characters\/[a-zA-Z0-9_-]+\.png$/.test(path)
    || /^\/api\/building-models\/[a-zA-Z0-9_-]+\.glb$/.test(path)
    || path === '/assets/workstations-v2-pVmukC4H.png';
}

async function loadAsset(path) {
  const response = await fetch(`https://www.midnight.city${path}`, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`City asset unavailable (${response.status})`);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 24 * 1024 * 1024) { await reader.cancel(); throw new Error('City asset too large'); }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);
  const valid = path.endsWith('.glb') ? buffer.subarray(0, 4).toString() === 'glTF' : path.endsWith('.png') ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : /^#\?(RADIANCE|RGBE)/.test(buffer.subarray(0, 16).toString());
  if (!valid) throw new Error('Invalid city asset');
  while (cacheBytes + buffer.length > maximumBytes && cache.size) {
    const key = cache.keys().next().value; cacheBytes -= cache.get(key).buffer.length; cache.delete(key);
  }
  const asset = { buffer, expires: Date.now() + (path.startsWith('/api/building-models/') ? 60000 : 3600000) };
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
    response.writeHead(200, { 'Content-Type': path.endsWith('.png') ? 'image/png' : path.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream', 'Content-Length': asset.buffer.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': `public, max-age=${path.startsWith('/api/building-models/') ? 60 : 3600}` });
    response.end(request.method === 'HEAD' ? undefined : asset.buffer);
  } catch { response.writeHead(502).end('City artwork unavailable'); }
  return true;
}
