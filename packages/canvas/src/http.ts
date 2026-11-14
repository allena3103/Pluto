import {
  CanvasAuthError,
  CanvasHttpError,
  CanvasNotFoundError,
  CanvasRateLimitError,
  CanvasTimeoutError,
} from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PAGES = 20;
const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 500;
const BACKOFF_JITTER_MAX_MS = 250;
const MAX_RETRY_DELAY_MS = 60_000;
const ORIGIN_MISMATCH_MESSAGE =
  "Canvas pagination link origin does not match the configured base URL.";

export type CanvasHttpClientOptions = {
  baseUrl: string;
  token: string;
  includeAuthHeader: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxPages?: number;
  sleep?: (ms: number) => Promise<void>;
};

type RequestPageResult = {
  data: unknown;
  headers: Headers;
};

export type PaginatedRequestOptions = {
  path: string;
  searchParams?: URLSearchParams;
  endpointName: string;
  allowForbiddenAsEmpty?: boolean;
};

type RetryDecision = {
  retryable: boolean;
  isRateLimit: boolean;
};

export type CanvasHttpClient = {
  getPaginatedArray: (options: PaginatedRequestOptions) => Promise<unknown[]>;
};

export function createCanvasHttpClient(options: CanvasHttpClientOptions): CanvasHttpClient {
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const sleep = options.sleep ?? defaultSleep;

  return {
    async getPaginatedArray(requestOptions) {
      let nextUrl: string | null = toRequestUrl(
        baseUrl,
        requestOptions.path,
        requestOptions.searchParams,
      );
      const rows: unknown[] = [];
      let pageCount = 0;

      while (nextUrl) {
        pageCount += 1;
        if (pageCount > maxPages) {
          throw new CanvasHttpError({
            status: 400,
            requestPath: requestOptions.path,
            message: `Canvas pagination exceeded maxPages for ${requestOptions.endpointName}`,
          });
        }

        const pageResult = await requestPage({
          url: nextUrl,
          path: requestOptions.path,
          baseUrl,
          includeAuthHeader: options.includeAuthHeader,
          token: options.token,
          fetchImpl,
          timeoutMs,
          sleep,
          allowForbiddenAsEmpty: requestOptions.allowForbiddenAsEmpty ?? false,
        });

        const normalized = normalizeArrayBody(pageResult.data);
        rows.push(...normalized);
        nextUrl = parseNextLink(pageResult.headers.get("Link"));
      }

      return rows;
    },
  };
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toRequestUrl(baseUrl: string, path: string, searchParams?: URLSearchParams): string {
  const url = new URL(path, baseUrl);
  if (searchParams) {
    url.search = searchParams.toString();
  }
  return url.toString();
}

function urlForTokenRequest(target: string, baseUrl: string, requestPath: string, token: string): string {
  let resolved: URL;
  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(baseUrl).origin;
    resolved = new URL(target, baseUrl);
  } catch {
    throw originMismatchError(requestPath, target, token);
  }

  const hasCredentials = resolved.username !== "" || resolved.password !== "";
  if (hasCredentials || resolved.origin !== allowedOrigin) {
    throw originMismatchError(requestPath, target, token, resolved);
  }

  return resolved.href;
}

function originMismatchError(
  requestPath: string,
  rejectedTarget: string,
  token: string,
  resolved?: URL,
): CanvasHttpError {
  return new CanvasHttpError({
    status: 400,
    requestPath: safeRequestPath(requestPath, rejectedTarget, token, resolved),
    message: ORIGIN_MISMATCH_MESSAGE,
  });
}

function safeRequestPath(
  requestPath: string,
  rejectedTarget: string,
  token: string,
  resolved?: URL,
): string {
  const secrets = [rejectedTarget, token];
  if (resolved) {
    secrets.push(resolved.href, resolved.username, resolved.password, resolved.host, resolved.hostname);
    if (resolved.username !== "" || resolved.password !== "") {
      secrets.push(`${resolved.username}:${resolved.password}`);
    }
  }

  for (const secret of secrets) {
    if (secret.length > 0 && requestPath.includes(secret)) {
      return "";
    }
  }
  return requestPath;
}

async function requestPage(options: {
  url: string;
  path: string;
  baseUrl: string;
  includeAuthHeader: boolean;
  token: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  allowForbiddenAsEmpty: boolean;
}): Promise<RequestPageResult> {
  const requestUrl = options.includeAuthHeader
    ? urlForTokenRequest(options.url, options.baseUrl, options.path, options.token)
    : options.url;
  let sawTimeout = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const headers = new Headers({ Accept: "application/json" });
    if (options.includeAuthHeader) {
      headers.set("Authorization", `Bearer ${options.token}`);
    }

    try {
      const response = await options.fetchImpl(requestUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      if (response.status === 401) {
        throw new CanvasAuthError({
          status: 401,
          requestPath: options.path,
          message: "Canvas authentication failed (401).",
        });
      }

      if (response.status === 404) {
        throw new CanvasNotFoundError({
          status: 404,
          requestPath: options.path,
          message: "Canvas endpoint not found (404).",
        });
      }

      if (response.ok) {
        const data = await safeReadResponseBody(response, options.path);
        return { data, headers: response.headers };
      }

      const errorBody = await safeReadErrorText(response);
      const retryDecision = classifyRetry(response, errorBody);
      if (response.status === 403 && !retryDecision.isRateLimit && options.allowForbiddenAsEmpty) {
        return { data: [], headers: response.headers };
      }

      if (!retryDecision.retryable) {
        throw new CanvasHttpError({
          status: response.status,
          requestPath: options.path,
          message: `Canvas request failed with status ${response.status}.`,
        });
      }

      if (attempt === MAX_ATTEMPTS - 1) {
        if (retryDecision.isRateLimit) {
          throw new CanvasRateLimitError({
            status: response.status,
            requestPath: options.path,
            message: `Canvas rate limit persisted after ${MAX_ATTEMPTS} attempts.`,
          });
        }
        throw new CanvasHttpError({
          status: response.status,
          requestPath: options.path,
          message: `Canvas request failed after ${MAX_ATTEMPTS} attempts.`,
        });
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      const waitMs = retryAfterMs ?? computeBackoffMs(attempt);
      assertRetryDelay(waitMs, response.status, options.path);
      await options.sleep(waitMs);
      continue;
    } catch (error) {
      if (error instanceof CanvasAuthError || error instanceof CanvasNotFoundError || error instanceof CanvasHttpError || error instanceof CanvasRateLimitError) {
        throw error;
      }

      if (isAbortError(error)) {
        sawTimeout = true;
      }

      const isRetryableNetwork = isAbortError(error) || isNetworkError(error);
      if (!isRetryableNetwork || attempt === MAX_ATTEMPTS - 1) {
        if (sawTimeout || isAbortError(error)) {
          throw new CanvasTimeoutError({
            status: 408,
            requestPath: options.path,
            message: `Canvas request timed out after ${MAX_ATTEMPTS} attempts.`,
          });
        }
        throw new CanvasHttpError({
          status: 500,
          requestPath: options.path,
          message: `Canvas network request failed after ${MAX_ATTEMPTS} attempts.`,
        });
      }

      const waitMs = computeBackoffMs(attempt);
      assertRetryDelay(waitMs, 500, options.path);
      await options.sleep(waitMs);
    }
  }

  throw new CanvasHttpError({
    status: 500,
    requestPath: options.path,
    message: "Canvas request failed unexpectedly.",
  });
}

function normalizeArrayBody(data: unknown): unknown[] {
  if (data == null) {
    return [];
  }
  return Array.isArray(data) ? data : [];
}

async function safeReadResponseBody(response: Response, requestPath: string): Promise<unknown> {
  if (response.status === 204) {
    return [];
  }
  const text = await response.text();
  if (text.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed == null) {
      return [];
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CanvasHttpError({
        status: response.status,
        requestPath,
        message: `Canvas response body was not valid JSON (status ${response.status}).`,
      });
    }
    throw error;
  }
}

async function safeReadErrorText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function classifyRetry(response: Response, errorBody: string): RetryDecision {
  const status = response.status;
  const isRateLimit = status === 429 || (status === 403 && isRateLimit403(response.headers, errorBody));
  if (isRateLimit) {
    return { retryable: true, isRateLimit: true };
  }
  if (status >= 500) {
    return { retryable: true, isRateLimit: false };
  }
  return { retryable: false, isRateLimit: false };
}

function isRateLimit403(headers: Headers, bodyText: string): boolean {
  const normalizedBody = bodyText.toLowerCase();
  if (normalizedBody.includes("rate limit exceeded")) {
    return true;
  }
  const remaining = headers.get("X-Rate-Limit-Remaining");
  if (remaining !== null) {
    const value = Number(remaining);
    if (Number.isFinite(value) && value <= 0) {
      return true;
    }
  }
  return false;
}

function assertRetryDelay(waitMs: number, status: number, requestPath: string): void {
  if (waitMs > MAX_RETRY_DELAY_MS) {
    throw new CanvasRateLimitError({
      status,
      requestPath,
      message: "Canvas retry delay exceeded 60 seconds.",
    });
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const target = Date.parse(value);
  if (!Number.isNaN(target)) {
    const diff = target - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

function computeBackoffMs(attempt: number): number {
  const base = BACKOFF_BASE_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * BACKOFF_JITTER_MAX_MS);
  return base + jitter;
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }
  const links = linkHeader.split(",");
  for (const entry of links) {
    const parts = entry.split(";");
    const rawUrl = parts[0]?.trim();
    if (!rawUrl?.startsWith("<") || !rawUrl.endsWith(">")) {
      continue;
    }
    const rel = parts.slice(1).find((part) => part.trim().startsWith("rel="));
    if (!rel) {
      continue;
    }
    const relValue = rel.split("=")[1]?.trim().replaceAll('"', "");
    if (relValue === "next") {
      return rawUrl.slice(1, -1);
    }
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || error.name === "TimeoutError";
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
