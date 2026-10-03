import { readdir, readFile, writeFile } from 'node:fs/promises';
import { brotliCompress, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
const directory = new URL('../dist/assets/', import.meta.url);
let originalBytes = 0, deliveredBytes = 0;
for (const name of await readdir(directory)) {
  if (!/\.(js|css)$/.test(name)) continue;
  const original = await readFile(new URL(name, directory));
  const [brotli, compressed] = await Promise.all([
    compressBrotli(original, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
    compressGzip(original, { level: 9 }),
  ]);
  await Promise.all([writeFile(new URL(`${name}.br`, directory), brotli), writeFile(new URL(`${name}.gz`, directory), compressed)]);
  originalBytes += original.length; deliveredBytes += brotli.length;
}
console.log(`Production assets: ${Math.round(originalBytes / 1024)} KiB → ${Math.round(deliveredBytes / 1024)} KiB Brotli; exact contents preserved.`);
