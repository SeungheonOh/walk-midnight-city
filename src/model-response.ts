import { modelByteLength, validateModel } from '../model-integrity.mjs';

async function readModel(response: Response) {
  if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`);
  const reader = response.body.getReader();
  const header = new Uint8Array(12);
  let headerSize = 0;
  let bytes: Uint8Array | undefined;
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      let content = chunk.value;
      if (!bytes) {
        const copied = Math.min(header.length - headerSize, content.byteLength);
        header.set(content.subarray(0, copied), headerSize);
        headerSize += copied;
        if (headerSize < header.length) continue;
        bytes = new Uint8Array(modelByteLength(header));
        bytes.set(header); size = header.length;
        content = content.subarray(copied);
      }
      if (size + content.byteLength > bytes.byteLength) throw new Error('Model exceeds its declared size');
      bytes.set(content, size); size += content.byteLength;
    }
    if (!bytes) throw new Error('Incomplete model header');
    validateModel(bytes.subarray(0, size));
    const headers = new Headers(response.headers);
    headers.delete('Content-Encoding');
    headers.set('Content-Length', String(size));
    const verified = bytes;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(verified); controller.close(); } }), { status: 200, headers });
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
