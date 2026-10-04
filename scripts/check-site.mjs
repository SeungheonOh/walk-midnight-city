import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { allowedNativeAsset, maximumAssetBytes } from '../asset-policy.mjs';

const base = process.env.SITE_URL;
if (!base) throw new Error('Set SITE_URL to the site to verify.');
const get = (path, options = {}) => fetch(new URL(path, base), { cache: 'no-cache', ...options, signal: AbortSignal.timeout(30000) });
const expected = JSON.parse(await readFile(new URL('../dist/artwork-manifest.json', import.meta.url), 'utf8'));
const expectedHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const expectedScript = expectedHtml.match(/src="([^"]+\.js)"/)?.[1];
assert(expectedScript, 'Built application entry exists');
let manifest;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const home = await get('/');
    assert.equal(home.status, 200, 'Home page loads');
    const html = await home.text();
    assert(html.includes('Walk Midnight'), 'Expected application is deployed');
    assert.equal(html.match(/src="([^"]+\.js)"/)?.[1], expectedScript, 'Expected client version is deployed');
    assert.equal((await get(expectedScript, { method: 'HEAD' })).status, 200, 'Built JavaScript loads');
    const response = await get('/artwork-manifest.json');
    assert.equal(response.status, 200, 'Static artwork manifest is published');
    manifest = await response.json();
    assert.equal(manifest.revision, expected.revision, 'Expected artwork snapshot is deployed');
    break;
  } catch (error) {
    if (attempt === 11) throw error;
    console.log('Waiting for the deployed client and artwork snapshot to reach this edge…');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
assert(/^\/native-assets\/[a-f0-9]{16}$/.test(manifest.basePath));
assert(manifest.files.length > 0 && manifest.files.length <= 10000);
const queue = [...manifest.files];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const file = queue.shift();
    assert(allowedNativeAsset(file.path));
    const response = await get(`${manifest.basePath}${file.path}`);
    assert.equal(response.status, 200, `${file.path} loads`);
    const reader = response.body.getReader(), hash = createHash('sha256');
    let received = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.length;
      assert(received <= maximumAssetBytes, `${file.path} respects the artwork size limit`);
      hash.update(chunk.value);
    }
    assert.equal(received, file.bytes, `${file.path} is complete`);
    assert.equal(hash.digest('hex'), file.sha256, `${file.path} matches the downloaded original`);
  }
}));
assert.equal((await get('/native-assets/unknown')).status, 404, 'Unknown artwork routes stay closed');
assert.equal((await get('/native-assets/models/city-neon/stone.png')).status, 404, 'Old proxy route is removed');
console.log(`PASS: ${base} serves the application and all ${manifest.files.length} static artwork files with exact sizes and SHA-256 hashes.`);
