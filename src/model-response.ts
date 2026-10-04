import { maximumAssetBytes } from '../asset-policy.mjs';
import { validateModel } from '../model-integrity.mjs';

async function readModel(response: Response) {
  if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumAssetBytes) throw new Error('Model exceeds download limit');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    validateModel(bytes);
    const headers = new Headers(response.headers);
    headers.delete('Content-Encoding');
    headers.set('Content-Length', String(size));
    return new Response(bytes, { status: 200, headers });
  } finally { await reader.cancel().catch(() => {}); }
}

export async function modelResponse(request: Request): Promise<Response> {
  if (!new URL(request.url).pathname.endsWith('.glb')) return fetch(request);
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    request.signal.throwIfAborted();
    try {
      return await readModel(await fetch(request, {
        credentials: 'omit', redirect: 'error',
        cache: attempt === 0 ? 'default' : 'reload',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
      }));
    } catch (error) {
      request.signal.throwIfAborted();
      failure = error;
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 250));
  }
  const name = new URL(request.url).pathname.split('/').at(-1);
  throw new Error(`Could not load ${name}. ${failure instanceof Error ? failure.message : 'Download interrupted'}. Try loading again.`);
}
