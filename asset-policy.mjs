export const maximumAssetBytes = 24 * 1024 * 1024;

export function allowedNativeAsset(path) {
  return /^\/models\/city-neon\/[a-z0-9-]+\.(glb|png|hdr)$/.test(path)
    || /^\/characters\/[a-z0-9_]+\.png$/.test(path)
    || /^\/api\/characters\/[a-zA-Z0-9_-]+\.png$/.test(path)
    || /^\/api\/building-models\/[a-zA-Z0-9_-]+\.glb$/.test(path)
    || path === '/assets/workstations-v2-pVmukC4H.png';
}

export function nativeAssetType(path) {
  return path.endsWith('.png') ? 'image/png' : path.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream';
}

export function nativeAssetLifetime(path) {
  return path.startsWith('/api/building-models/') ? 60 : 3600;
}

export function validNativeAsset(path, bytes) {
  if (path.endsWith('.glb')) return bytes.length >= 4 && bytes[0] === 103 && bytes[1] === 108 && bytes[2] === 84 && bytes[3] === 70;
  if (path.endsWith('.png')) return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  return /^#\?(RADIANCE|RGBE)/.test(new TextDecoder().decode(bytes.subarray(0, 16)));
}
