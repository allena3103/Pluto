const SUPABASE_TIMEOUT_MS = 10_000;

function combineWithTimeout(signal?: AbortSignal | null): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(SUPABASE_TIMEOUT_MS);

  if (!signal) {
    return timeoutSignal;
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }

  const controller = new AbortController();

  const abortFrom = (source: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(source.reason);
    }
  };

  if (signal.aborted) {
    abortFrom(signal);
  } else {
    signal.addEventListener("abort", () => abortFrom(signal), { once: true });
  }

  if (timeoutSignal.aborted) {
    abortFrom(timeoutSignal);
  } else {
    timeoutSignal.addEventListener("abort", () => abortFrom(timeoutSignal), { once: true });
  }

  return controller.signal;
}

/** Fetch wrapper with a 10s timeout, matching `apps/web/lib/supabase/fetch.ts`. */
export const supabaseFetch: typeof fetch = (input, init) => {
  return fetch(input, {
    ...init,
    signal: combineWithTimeout(init?.signal),
  });
};
