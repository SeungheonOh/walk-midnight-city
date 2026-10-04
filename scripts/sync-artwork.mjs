import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { artworkCatalog } from './artwork-catalog.mjs';
import { allowedNativeAsset, maximumAssetBytes, validNativeAsset } from '../asset-policy.mjs';
import { validateModel } from '../model-integrity.mjs';

const root = resolve(import.meta.dirname, '..');
const cacheRoot = resolve(root, '.cache/artwork');
const publicRoot = resolve(root, 'public');
const indexPath = resolve(cacheRoot, 'index.json');
const manifestPath = resolve(publicRoot, 'artwork-manifest.json');
const previous = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => 'null'));
if (process.argv.includes('--cached') && previous) {
  console.log(`Using downloaded artwork snapshot ${previous.revision}.`);
  process.exit(0);
}
const index = JSON.parse(await readFile(indexPath, 'utf8').catch(() => '{}'));
const paths = await artworkCatalog();
const publicJson = async path => {
  const response = await fetch(`https://www.midnight.city/observer/api/${path}`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Artwork discovery failed (${response.status})`);
  return response.json();
};
const bootstrap = await publicJson('spectator/bootstrap');
const world = await publicJson(`static-world/${encodeURIComponent(bootstrap.staticVersion)}`);
if (world.staticVersion !== bootstrap.staticVersion) throw new Error('City changed during artwork discovery; retry deployment');
for (const seed of Object.values(world.agentSeeds ?? {})) {
  if (seed.characterSheetId) paths.add(`/api/characters/${seed.characterSheetId}.png`);
  for (const [part, appearance] of Object.entries(seed.appearance ?? {})) if (appearance.id > 0) paths.add(`/characters/${part}_${appearance.id}.png`);
}
for (const site of bootstrap.dynamicWorld.constructionSites ?? []) if (site.installationId && site.status === 'active') paths.add(`/api/building-models/${site.installationId}.glb`);

function validate(path, bytes) {
  if (!validNativeAsset(path, bytes)) throw new Error(`Invalid artwork: ${path}`);
  if (path.endsWith('.glb')) {
    validateModel(bytes);
    const metadata = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    for (const resource of [...metadata.buffers ?? [], ...metadata.images ?? []]) {
      if (resource.uri && !resource.uri.startsWith('data:')) throw new Error(`Model requires an unbundled resource: ${path}`);
    }
  }
  if (path.endsWith('.png') && bytes.subarray(-8, -4).toString() !== 'IEND') throw new Error(`Incomplete PNG: ${path}`);
}

async function download(path) {
  if (!allowedNativeAsset(path)) throw new Error(`Unsupported artwork path: ${path}`);
  const target = resolve(cacheRoot, `files${path}`);
  const saved = await readFile(target).catch(() => null);
  const known = index[path];
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const reusable = saved && known?.sha256 === hash(saved);
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const headers = { 'Accept-Encoding': 'identity' };
      if (attempt === 0 && reusable && known.etag) headers['If-None-Match'] = known.etag;
      const response = await fetch(`https://www.midnight.city${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
      if (response.status === 304 && reusable) { validate(path, saved); return { path, bytes: saved.length, sha256: known.sha256 }; }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maximumAssetBytes) throw new Error('Artwork exceeds static file size limit');
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = Buffer.concat(chunks);
      validate(path, bytes);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(`${target}.tmp`, bytes);
      await rename(`${target}.tmp`, target);
      const sha256 = hash(bytes);
      index[path] = { sha256, etag: response.headers.get('etag') };
      return { path, bytes: bytes.length, sha256 };
    } catch (error) { failure = error; }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 500));
  }
  throw new Error(`Could not download ${path}: ${failure instanceof Error ? failure.message : failure}`);
}

const queue = [...paths].sort();
const files = [];
console.log(`Downloading ${queue.length} artwork files for all city spaces…`);
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const path = queue.shift();
    files.push(await download(path));
    if (files.length % 25 === 0) console.log(`Validated ${files.length}/${paths.size} files`);
  }
}));
files.sort((left, right) => left.path.localeCompare(right.path));
const revision = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
const basePath = `/native-assets/${revision}`;
for (const file of files) {
  const destination = resolve(publicRoot, `.${basePath}${file.path}`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(cacheRoot, `files${file.path}`), destination);
}
const manifest = { revision, basePath, refreshedAt: new Date().toISOString(), staticVersion: bootstrap.staticVersion, files };
await writeFile(indexPath, JSON.stringify(index));
await writeFile(manifestPath, JSON.stringify(manifest));
if (previous?.basePath !== basePath && /^\/native-assets\/[a-f0-9]{16}$/.test(previous?.basePath ?? '')) await rm(resolve(publicRoot, `.${previous.basePath}`), { recursive: true, force: true });
console.log(`Static artwork: ${files.length} files, ${(files.reduce((total, file) => total + file.bytes, 0) / 1024 ** 2).toFixed(1)} MiB, snapshot ${revision}.`);
