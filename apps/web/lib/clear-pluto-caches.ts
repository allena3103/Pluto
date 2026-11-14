/**
 * Drops every Pluto Cache Storage entry and asks the service worker to do the
 * same. The prefix and message type match `public/sw.js`. Sign-out calls this
 * before the session cookies are cleared so a shared device cannot replay a
 * cached page from the previous student.
 */
export const PLUTO_CACHE_PREFIX = "pluto-";
export const CLEAR_CACHES_TYPE = "CLEAR_CACHES";

type CacheStorageLike = {
  keys: () => Promise<string[]>;
  delete: (cacheName: string) => Promise<boolean>;
};

type ClearPlutoCachesDeps = {
  caches?: CacheStorageLike;
  postMessage?: (message: { type: typeof CLEAR_CACHES_TYPE }) => void;
};

async function postToWorkers(message: { type: typeof CLEAR_CACHES_TYPE }): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  const controller = navigator.serviceWorker.controller;
  controller?.postMessage(message);

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const extra = registration?.active ?? registration?.waiting ?? null;
    if (extra && extra !== controller) {
      extra.postMessage(message);
    }
  } catch {
    // Cache Storage was already cleared by the caller. A missing worker is fine.
  }
}

export async function clearPlutoCaches(deps?: ClearPlutoCachesDeps): Promise<void> {
  const cachesApi = deps?.caches ?? (typeof caches !== "undefined" ? caches : undefined);
  if (cachesApi) {
    const keys = await cachesApi.keys();
    await Promise.all(keys.filter((key) => key.startsWith(PLUTO_CACHE_PREFIX)).map((key) => cachesApi.delete(key)));
  }

  const message = { type: CLEAR_CACHES_TYPE } as const;
  if (deps?.postMessage) {
    deps.postMessage(message);
    return;
  }
  await postToWorkers(message);
}
