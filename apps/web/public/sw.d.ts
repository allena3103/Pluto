export const CACHE_VERSION: string;
export const PLUTO_CACHE_PREFIX: string;
export const CLEAR_CACHES_TYPE: string;
export const OFFLINE_URL: string;
export const PRECACHE_URLS: readonly string[];

export type SwHeaders = { get(name: string): string | null };

export type SwRequestLike = {
  method: string;
  mode: string;
  headers?: SwHeaders;
};

export function hasRscHeader(headers: SwHeaders | undefined): boolean;

export function isStaticAssetPath(pathname: string): boolean;

export function shouldCacheRequest(url: URL, request: SwRequestLike, workerOrigin?: string): boolean;

export function plutoCacheNames(keys: readonly string[]): string[];
