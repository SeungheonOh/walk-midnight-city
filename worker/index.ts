import { allowedNativeAsset, maximumAssetBytes, nativeAssetLifetime, nativeAssetType, validNativeAsset } from '../asset-policy.mjs';

function failure(status: number, message: string) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function validatedStream(upstream: Response, path: string) {
  if (!upstream.body) throw new Error('Missing artwork');
  const reader = upstream.body.getReader();
  let size = 0;
  const prefix: Uint8Array[] = [];
  try {
    if (Number(upstream.headers.get('content-length')) > maximumAssetBytes) throw new Error('Artwork too large');
    while (size < 16) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumAssetBytes) throw new Error('Artwork too large');
      prefix.push(chunk.value);
    }
    const signature = new Uint8Array(Math.min(size, 16));
    let offset = 0;
    for (const chunk of prefix) {
      const count = Math.min(chunk.byteLength, signature.length - offset);
      signature.set(chunk.subarray(0, count), offset); offset += count;
    }
    if (!validNativeAsset(path, signature)) throw new Error('Invalid artwork');
  } catch (error) { await reader.cancel(); throw error; }
  return new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of prefix) controller.enqueue(chunk); },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) { controller.close(); return; }
        size += chunk.value.byteLength;
        if (size > maximumAssetBytes) { await reader.cancel(); throw new Error('Artwork too large'); }
        controller.enqueue(chunk.value);
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

export default {
  async fetch(request, env, context) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return failure(405, 'Read-only site');
    const url = new URL(request.url);
    const path = url.pathname.startsWith('/native-assets/') ? url.pathname.slice('/native-assets'.length)
      : /^\/city-assets\/[a-z0-9-]+\.glb$/.test(url.pathname) ? url.pathname.replace('/city-assets/', '/models/city-neon/') : null;
    if (!path) return env.ASSETS.fetch(request);
    if (url.search || !allowedNativeAsset(path)) return failure(404, 'Not found');
    const key = new Request(`${url.origin}/native-assets${path}`);
    const cache = caches.default;
    let response = await cache.match(key);
    if (!response) {
      try {
        const upstream = await fetch(`https://www.midnight.city${path}`, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
        if (!upstream.ok) { await upstream.body?.cancel(); return failure(502, 'City artwork unavailable'); }
        response = new Response(await validatedStream(upstream, path), { headers: {
          'Content-Type': nativeAssetType(path), 'Cache-Control': `public, max-age=${nativeAssetLifetime(path)}`,
          'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        } });
        context.waitUntil(cache.put(key, response.clone()).catch(() => { console.warn(JSON.stringify({ event: 'artwork_cache_write_failed' })); }));
      } catch (error) {
        console.warn(JSON.stringify({ event: 'artwork_fetch_failed', path, reason: error instanceof Error ? error.message : 'Unknown artwork error' }));
        return failure(502, 'City artwork unavailable');
      }
    }
    return request.method === 'HEAD' ? new Response(null, response) : response;
  },
} satisfies ExportedHandler<Env>;
