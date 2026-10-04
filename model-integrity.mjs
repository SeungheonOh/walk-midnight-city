import { maximumAssetBytes } from './asset-policy.mjs';

export function modelByteLength(bytes) {
  if (bytes.byteLength < 12) throw new Error('Incomplete model header');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2) throw new Error('Invalid model header');
  const length = header.getUint32(8, true);
  if (length < 20 || length > maximumAssetBytes) throw new Error('Invalid model size');
  return length;
}

export function validateModel(bytes) {
  const length = modelByteLength(bytes);
  if (bytes.byteLength !== length) throw new Error(`Incomplete model: received ${bytes.byteLength} of ${length} bytes`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset < length) {
    if (offset + 8 > length) throw new Error('Incomplete model chunk header');
    const size = view.getUint32(offset, true);
    if (size % 4 !== 0 || offset + 8 + size > length) throw new Error('Incomplete model chunk');
    if (offset === 12 && view.getUint32(offset + 4, true) !== 0x4e4f534a) throw new Error('Missing model metadata');
    offset += 8 + size;
  }
}
