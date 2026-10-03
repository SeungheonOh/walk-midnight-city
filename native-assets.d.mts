import type { IncomingMessage, ServerResponse } from 'node:http';
export function nativeAssets(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
export function allowedNativeAsset(path: string): boolean;
