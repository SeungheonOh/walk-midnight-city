export const maximumAssetBytes: number;
export function allowedNativeAsset(path: string): boolean;
export function nativeAssetType(path: string): string;
export function nativeAssetLifetime(path: string): number;
export function validNativeAsset(path: string, bytes: Uint8Array): boolean;
