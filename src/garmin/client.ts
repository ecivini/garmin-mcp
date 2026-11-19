import { decodeJwt } from "jose";

const base = "https://personal.connectapi.garmin.com";
const exchangePath = "/personalapitoken-service/personal-api/personal-api-key/token";
const jsonPaths = {
  list_activity_types: "/activity-service/activity/activityTypes/simple",
  get_activity: "/activity-service/activity/{activityId}",
  get_activity_workouts: "/activity-service/activity/{activityId}/workouts",
  search_activities: "/activitylist-service/activities/search/activities",
  get_heart_rate_zones: "/biometric-service/heartRateZones/v2",
  get_fitness_age: "/fitnessage-service/fitnessage/v2/{calendarDate}",
  get_vo2_max: "/metrics-service/metrics/maxmet/daily/{startDate}/{endDate}",
  get_hrv_day: "/hrv-service/hrv/{calendarDate}",
  get_hrv_range: "/hrv-service/hrv/daily/{fromDate}/{toDate}",
} as const;
const maxJsonBytes = 2 * 1024 * 1024;
const maxTokenBytes = 16 * 1024;
const maxArchiveBytes = 100 * 1024 * 1024;
const headerTimeoutMs = 5_000;
const idleTimeoutMs = 10_000;
const exchangeTimeoutMs = 15_000;
const renewalMarginMs = 60_000;
const maxTokenAgeMs = 24 * 60 * 60 * 1000;
const maxCooldownMs = 5_000;

const messages = {
  invalid_input: "The supplied arguments are invalid.",
  not_found: "The requested Garmin record was not found.",
  rate_limited: "Garmin is rate limiting requests.",
  garmin_auth_failed: "Garmin credentials could not be accepted.",
  garmin_forbidden: "Garmin denied access to the requested data.",
  garmin_unavailable: "Garmin returned an unavailable or unexpected response.",
  timeout: "The Garmin request timed out or was cancelled.",
  payload_too_large: "The Garmin response exceeded its size limit.",
};

export class GarminError extends Error {
  constructor(readonly code: keyof typeof messages, readonly retryAfterSeconds?: number) {
    super(messages[code]);
    this.name = "GarminError";
  }
}

export type GarminRequestContext = Readonly<{ signal: AbortSignal; deadline: number }>;
export type GarminArchive = Readonly<{
  body: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
}>;

type ClientOptions = Readonly<{ apiKey?: () => string | undefined; fetch?: typeof fetch }>;
type Token = Readonly<{ value: string; expiresAt: number }>;
type Scope = ReturnType<typeof openScope>;
type Exchange = { scope: Scope; waiters: number; promise: Promise<Token> };
type QueryValue = string | number | boolean;
type OperationParams = {
  path?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, QueryValue | readonly QueryValue[] | undefined>>;
};

function jsonOperationPath(operation: keyof typeof jsonPaths, params?: OperationParams): string {
  if (!Object.hasOwn(jsonPaths, operation)) throw new GarminError("invalid_input");
  const path = jsonPaths[operation].replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.path?.[name];
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new GarminError("invalid_input");
    return value;
  });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params?.query ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, String(item));
  }
  return query.size ? `${path}?${query}` : path;
}

function openScope({ signal: caller, deadline }: GarminRequestContext) {
  const controller = new AbortController();
  const expire = () => controller.abort(new GarminError("timeout"));
  const remaining = deadline - Date.now();
  const timer = remaining > 0 && Number.isFinite(remaining) ? setTimeout(expire, remaining) : undefined;
  if (caller.aborted || timer === undefined) expire();
  else caller.addEventListener("abort", expire, { once: true });

  return {
    signal: controller.signal,
    abort: (error: GarminError) => controller.abort(error),
    close() {
      clearTimeout(timer);
      caller.removeEventListener("abort", expire);
    },
  };
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function toGarminError(error: unknown): GarminError {
  return error instanceof GarminError ? error : new GarminError("garmin_unavailable");
}

function discard(body: ReadableStream<Uint8Array> | null) {
  void body?.cancel().catch(() => {});
}

function contentLength(response: Response): number | undefined {
  const raw = response.headers.get("Content-Length");
  return raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
}

function boundBody(
  response: Response,
  scope: Scope,
  limit: number,
  length: number | undefined,
  requireLengthMatch = false,
): ReadableStream<Uint8Array> {
  const body = response.body;
  if (!body || (length !== undefined && length > limit)) {
    const error = new GarminError(body ? "payload_too_large" : "garmin_unavailable");
    scope.abort(error);
    discard(body);
    throw error;
  }

  const reader = body.getReader();
  let total = 0;
  let closed = false;
  let output: ReadableStreamDefaultController<Uint8Array>;

  function finish() {
    if (closed) return;
    closed = true;
    scope.signal.removeEventListener("abort", onAbort);
    scope.close();
  }

  function onAbort() {
    finish();
    void reader.cancel().catch(() => {});
    output.error(toGarminError(scope.signal.reason));
  }

  return new ReadableStream({
    start(controller) {
      output = controller;
      if (scope.signal.aborted) onAbort();
      else scope.signal.addEventListener("abort", onAbort, { once: true });
    },
    async pull(controller) {
      const timer = setTimeout(() => scope.abort(new GarminError("timeout")), idleTimeoutMs);
      try {
        const next = await reader.read();
        if (closed) return;
        if (next.done) {
          if (requireLengthMatch && length !== undefined && total !== length) throw new GarminError("garmin_unavailable");
          finish();
          controller.close();
          return;
        }
        total += next.value.byteLength;
        if (total > limit) throw new GarminError("payload_too_large");
        if (requireLengthMatch && length !== undefined && total > length) throw new GarminError("garmin_unavailable");
        controller.enqueue(next.value);
      } catch (error) {
        if (!closed) scope.abort(toGarminError(error));
      } finally {
        clearTimeout(timer);
      }
    },
    cancel() {
      finish();
      scope.abort(new GarminError("timeout"));
      void reader.cancel().catch(() => {});
    },
  }, { highWaterMark: 0 });
}

async function readText(response: Response, scope: Scope, limit: number): Promise<string> {
  const stream = boundBody(response, scope, limit, contentLength(response));
  const bytes = await new Response(stream).arrayBuffer();
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseJson(source: string): unknown {
  const parse = JSON.parse as (json: string, reviver: (
    key: string, value: unknown, context?: { source?: string },
  ) => unknown) => unknown;
  // Node 22 exposes the original token to the reviver, before numeric rounding.
  return parse(source, (_key, value, context) => {
    const raw = context?.source;
    if (typeof value === "number" && !Number.isSafeInteger(value) && raw && /^-?\d+$/.test(raw)) return raw;
    return value;
  });
}

function retryDelay(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  if (/^\d+$/.test(header)) {
    const seconds = Number(header);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const httpDate = /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;
  if (!httpDate.test(header)) return undefined;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : undefined;
}

function readStatus(status: number): GarminError {
  switch (status) {
    case 400: return new GarminError("invalid_input");
    case 401: return new GarminError("garmin_auth_failed");
    case 403: return new GarminError("garmin_forbidden");
    case 404: return new GarminError("not_found");
    default: return new GarminError("garmin_unavailable");
  }
}

export function isGarminId(value: string): boolean {
  return /^[1-9]\d{0,18}$/.test(value) && (value.length < 19 || value <= "9223372036854775807");
}

export function createGarminClient({
  apiKey = () => process.env.GARMIN_PERSONAL_API_KEY,
  fetch = (input, init) => globalThis.fetch(input, init),
}: ClientOptions = {}) {
  let cachedToken: Token | undefined;
  let pendingExchange: Exchange | undefined;
  let nextAllowedAt = 0;
  let retryAt: number | undefined;

  async function request(path: string, scope: Scope, init: RequestInit): Promise<Response> {
    scope.signal.throwIfAborted();
    const now = Date.now();
    if (now < nextAllowedAt) {
      const remaining = retryAt === undefined ? undefined : Math.max(0, Math.ceil((retryAt - now) / 1000));
      throw new GarminError("rate_limited", remaining);
    }
    const timer = setTimeout(() => scope.abort(new GarminError("timeout")), headerTimeoutMs);
    try {
      const fetched = fetch(base + path, { ...init, signal: scope.signal, cache: "no-store", redirect: "error" })
        .then((response) => {
          if (scope.signal.aborted) discard(response.body);
          return response;
        });
      const response = await untilAborted(fetched, scope.signal);
      scope.signal.throwIfAborted();
      if (response.status === 429) {
        const received = Date.now();
        const seconds = retryDelay(response.headers.get("Retry-After"), received);
        const allowedAt = received + Math.min(maxCooldownMs, seconds === undefined ? maxCooldownMs : seconds * 1000);
        if (allowedAt >= nextAllowedAt) {
          nextAllowedAt = allowedAt;
          retryAt = seconds === undefined ? undefined : received + seconds * 1000;
        }
        discard(response.body);
        throw new GarminError("rate_limited", seconds);
      }
      return response;
    } catch (error) {
      scope.signal.throwIfAborted();
      throw toGarminError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  async function exchange(scope: Scope): Promise<Token> {
    const key = apiKey()?.trim();
    if (!key || !/^[!-~]+$/.test(key)) throw new GarminError("garmin_auth_failed");
    const started = Date.now();
    const response = await request(exchangePath, scope, {
      method: "POST",
      headers: { Authorization: `ApiKey ${key}`, Accept: "*/*" },
    });
    if (response.status !== 200) {
      discard(response.body);
      if ([400, 401, 403].includes(response.status)) throw new GarminError("garmin_auth_failed");
      throw new GarminError("garmin_unavailable");
    }
    const value = (await readText(response, scope, maxTokenBytes)).trim();
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) throw new GarminError("garmin_unavailable");
    // The token is opaque to the application. Its exp only bounds cache reuse.
    const { exp } = decodeJwt(value);
    if (typeof exp !== "number" || !Number.isFinite(exp)) throw new GarminError("garmin_unavailable");
    const expiresAt = Math.min(exp * 1000, started + maxTokenAgeMs);
    if (expiresAt <= Date.now()) throw new GarminError("garmin_auth_failed");
    return { value, expiresAt };
  }

  function beginExchange(): Exchange {
    const scope = openScope({ signal: new AbortController().signal, deadline: Date.now() + exchangeTimeoutMs });
    const started: Exchange = {
      scope,
      waiters: 0,
      promise: exchange(scope)
        .then((token) => {
          scope.signal.throwIfAborted();
          if (pendingExchange === started) cachedToken = token;
          return token;
        })
        .catch((error: unknown) => { throw toGarminError(error); })
        .finally(() => {
          scope.close();
          if (pendingExchange === started) pendingExchange = undefined;
        }),
    };
    return started;
  }

  async function getToken(signal: AbortSignal): Promise<Token> {
    signal.throwIfAborted();
    if (cachedToken && cachedToken.expiresAt - Date.now() > renewalMarginMs) return cachedToken;
    pendingExchange ??= beginExchange();
    const pending = pendingExchange;
    pending.waiters++;
    try {
      return await untilAborted(pending.promise, signal);
    } finally {
      pending.waiters--;
      if (pending.waiters === 0 && pendingExchange === pending) {
        pendingExchange = undefined;
        pending.scope.abort(new GarminError("timeout"));
        pending.scope.close();
      }
    }
  }

  async function get(path: string, scope: Scope, accept: string, archive = false): Promise<Response> {
    const fetchWithToken = (token: Token) => request(path, scope, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.value}`,
        Accept: accept,
        ...(archive ? { "Accept-Encoding": "identity" } : {}),
      },
    });
    const token = await getToken(scope.signal);
    let response = await fetchWithToken(token);
    if (response.status === 401) {
      discard(response.body);
      if (cachedToken === token) cachedToken = undefined;
      const replacement = await getToken(scope.signal);
      response = await fetchWithToken(replacement);
      if (response.status === 401 && cachedToken === replacement) cachedToken = undefined;
    }
    if (response.ok) return response;
    discard(response.body);
    throw readStatus(response.status);
  }

  return {
    async readJson(operation: keyof typeof jsonPaths, context: GarminRequestContext, params?: OperationParams): Promise<unknown> {
      const path = jsonOperationPath(operation, params);
      const scope = openScope(context);
      try {
        const response = await get(path, scope, "application/json");
        // Only the HRV operations document HTTP 204. A successful JSON null remains a JSON value.
        if (response.status === 204 && (operation === "get_hrv_day" || operation === "get_hrv_range")) return undefined;
        if (response.status !== 200) {
          discard(response.body);
          throw new GarminError("garmin_unavailable");
        }
        return parseJson(await readText(response, scope, maxJsonBytes));
      } catch (error) {
        throw toGarminError(error);
      } finally {
        scope.close();
      }
    },

    async readActivityArchive(activityId: string, context: GarminRequestContext, maxBytes: number): Promise<GarminArchive> {
      if (!isGarminId(activityId) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > maxArchiveBytes) {
        throw new GarminError("invalid_input");
      }
      const scope = openScope(context);
      try {
        const response = await get(`/download-service/files/activity/${activityId}`, scope, "*/*", true);
        const encoding = response.headers.get("Content-Encoding");
        if (response.status !== 200 || (encoding && encoding.toLowerCase() !== "identity")) {
          discard(response.body);
          throw new GarminError("garmin_unavailable");
        }
        const length = contentLength(response);
        const contentType = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
        return { body: boundBody(response, scope, maxBytes, length, true), contentLength: length, contentType };
      } catch (error) {
        scope.close();
        throw toGarminError(error);
      }
    },
  };
}

export const garminClient = createGarminClient();
