import assert from 'node:assert/strict';
import { validNativeAsset } from '../asset-policy.mjs';

const base = process.env.SITE_URL;
if (!base) throw new Error('Set SITE_URL to the site to verify.');
const get = (path, options = {}) => fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(30000) });
const home = await get('/');
assert.equal(home.status, 200, 'Home page loads');
const html = await home.text();
assert(html.includes('Walk Midnight'), 'Expected application is deployed');
const script = html.match(/src="([^"]+\.js)"/)?.[1];
assert(script, 'Built application entry exists');
assert.equal((await get(script, { method: 'HEAD' })).status, 200, 'Built JavaScript loads');
for (const name of ['stone.png', 'charging-bed-double-orange.glb']) {
  const path = `/models/city-neon/${name}`;
  const response = await get(`/native-assets${path}`);
  assert.equal(response.status, 200, `${name} loads`);
  const reader = response.body.getReader();
  const prefix = new Uint8Array(16);
  let length = 0;
  while (length < prefix.length) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const count = Math.min(prefix.length - length, chunk.value.length);
    prefix.set(chunk.value.subarray(0, count), length); length += count;
  }
  await reader.cancel();
  assert(validNativeAsset(path, prefix.subarray(0, length)), `${name} has the correct binary format`);
}
assert.equal((await get('/native-assets/unknown')).status, 404, 'Unknown artwork routes stay closed');
assert.equal((await get('/native-assets/models/city-neon/stone.png?extra=1')).status, 404, 'Artwork query strings are not forwarded');
assert.equal((await get('/native-assets/models/city-neon/stone.png', { method: 'POST' })).status, 405, 'Artwork adapter remains read-only');
console.log(`PASS: ${base} serves the application, PNG and GLB artwork with read-only routing.`);
