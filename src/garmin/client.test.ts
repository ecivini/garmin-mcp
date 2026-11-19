import { afterEach, expect, it, vi } from "vitest";
import { createGarminClient } from "./client";

const base = "https://personal.connectapi.garmin.com";
const exchangePath = "/personalapitoken-service/personal-api/personal-api-key/token";
const jsonPath = "/activity-service/activity/activityTypes/simple";
const fixture = [{ key: "fixture", parent: null }];
const MiB = 1024 * 1024;
const key = "fixture-key";

function token(label = "first", expiresIn = 3_600) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresIn, label }));
  return `eyJhbGciOiJSUzI1NiJ9.${payload.toString("base64url")}.c2lnbmF0dXJl`;
}

function context(duration = 15_000, signal = new AbortController().signal) {
  return { signal, deadline: Date.now() + duration };
}

function clientWith(mockFetch: typeof fetch) {
  return createGarminClient({ apiKey: () => key, fetch: mockFetch });
}

function read(client: ReturnType<typeof createGarminClient>, scope = context()) {
  return client.readJson("list_activity_types", scope);
}

function waitOnAbort(signal?: AbortSignal | null): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

afterEach(() => vi.useRealTimers());

it("coalesces the exchange and caches the JWT until shortly before its expiry", async () => {
  vi.useFakeTimers();
  const firstToken = token("first", 120);
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
    String(url).endsWith(exchangePath) ? new Response(token("first", 120)) : Response.json(fixture),
  );
  const client = clientWith(fetch);
  await expect(Promise.all([read(client), read(client)])).resolves.toEqual([fixture, fixture]);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([base + exchangePath, base + jsonPath, base + jsonPath]);
  expect(fetch.mock.calls[0][1]).toMatchObject({
    method: "POST", cache: "no-store", redirect: "error",
    headers: { Authorization: `ApiKey ${key}`, Accept: "*/*" },
  });
  expect(fetch.mock.calls[1][1]).toMatchObject({
    method: "GET", cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${firstToken}` },
  });
  await vi.advanceTimersByTimeAsync(59_000);
  await read(client);
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith(exchangePath))).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1_000);
  await read(client);
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith(exchangePath))).toHaveLength(2);
});

it("retries a read 401 once, refreshing the token before the retry", async () => {
  const replacement = token("replacement");
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(token("rejected")))
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(replacement))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(read(clientWith(fetch))).rejects.toMatchObject({ code: "garmin_auth_failed" });
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    base + exchangePath, base + jsonPath, base + exchangePath, base + jsonPath,
  ]);
  expect(fetch.mock.calls[3][1]?.headers).toMatchObject({ Authorization: `Bearer ${replacement}` });
});

it("coalesces parallel stale reads without invalidating a newer token", async () => {
  const late401 = Promise.withResolvers<Response>();
  const staleDispatched = Promise.withResolvers<void>();
  let exchanges = 0;
  let originalReads = 0;
  const initial = token("first");
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (String(url).endsWith(exchangePath)) {
      return new Response(++exchanges === 1 ? initial : token("replacement"));
    }
    if (new Headers(init?.headers).get("Authorization") !== `Bearer ${initial}`) return Response.json(fixture);
    if (++originalReads === 1) {
      staleDispatched.resolve();
      return late401.promise;
    }
    return new Response(null, { status: 401 });
  });
  const client = clientWith(fetch);
  const stale = read(client);
  await staleDispatched.promise;
  await expect(read(client)).resolves.toEqual(fixture);
  late401.resolve(new Response(null, { status: 401 }));
  await expect(stale).resolves.toEqual(fixture);
  expect(exchanges).toBe(2);
});

it.each([400, 401, 403])("sanitizes a credential rejection at exchange status %s", async (status) => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response("private response", { status }))
    .mockResolvedValueOnce(new Response(token()))
    .mockResolvedValueOnce(Response.json(fixture));
  const client = clientWith(fetch);
  await expect(read(client)).rejects.toMatchObject({
    code: "garmin_auth_failed", message: "Garmin credentials could not be accepted.",
  });
  await expect(read(client)).resolves.toEqual(fixture);
});

it.each([
  ["3", 3, 3],
  ["Wed, 01 Jan 2025 00:00:12 GMT", 12, 5],
  ["bad", undefined, 5],
  [null, undefined, 5],
] as const)("reports Retry-After %s and enforces a bounded cooldown", async (header, retryAfterSeconds, cooldown) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  const headers = header === null ? undefined : { "Retry-After": header };
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(token()))
    .mockResolvedValueOnce(new Response(null, { status: 429, headers }))
    .mockResolvedValueOnce(Response.json(fixture));
  const client = clientWith(fetch);
  await expect(read(client)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds });
  await vi.advanceTimersByTimeAsync(cooldown * 1000 - 1);
  await expect(read(client)).rejects.toMatchObject({ code: "rate_limited" });
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await expect(read(client)).resolves.toEqual(fixture);
});

it("applies 429 cooldown to the credential exchange and never automatically retries it", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(null, { status: 429, headers: { "Retry-After": "10" } }),
  );
  const client = clientWith(fetch);
  await expect(read(client)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 10 });
  await expect(read(client)).rejects.toMatchObject({ code: "rate_limited" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("lets an active caller finish when another caller cancels their shared exchange", async () => {
  const exchanged = Promise.withResolvers<Response>();
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockReturnValueOnce(exchanged.promise)
    .mockResolvedValueOnce(Response.json(fixture));
  const client = clientWith(fetch);
  const controller = new AbortController();
  const first = read(client, context(15_000, controller.signal));
  const second = read(client);
  controller.abort(new Error("private reason"));
  await expect(first).rejects.toMatchObject({ code: "timeout" });
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(false);
  exchanged.resolve(new Response(token()));
  await expect(second).resolves.toEqual(fixture);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("cancels an exchange abandoned by all callers and allows a new exchange immediately", async () => {
  const abandoned = Promise.withResolvers<Response>();
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockReturnValueOnce(abandoned.promise)
    .mockResolvedValueOnce(new Response(token("replacement")))
    .mockResolvedValueOnce(Response.json(fixture));
  const client = clientWith(fetch);
  const controller = new AbortController();
  const pending = read(client, context(15_000, controller.signal));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "timeout" });
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await expect(read(client)).resolves.toEqual(fixture);
  abandoned.resolve(new Response(token("abandoned")));
  expect(fetch).toHaveBeenCalledTimes(3);
});

it.each([
  ["caller deadline", 500],
  ["header timeout", 5_000],
])("aborts upstream on %s", async (_condition, time) => {
  vi.useFakeTimers();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_, init) => waitOnAbort(init?.signal));
  const pending = expect(read(clientWith(fetch), context(time === 500 ? time : 15_000))).rejects.toMatchObject({ code: "timeout" });
  await vi.advanceTimersByTimeAsync(time);
  await pending;
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it("times out idle response bodies and cancels upstream", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(token()))
    .mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
  const pending = expect(read(clientWith(fetch))).rejects.toMatchObject({ code: "timeout" });
  await vi.advanceTimersByTimeAsync(10_000);
  await pending;
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true);
});

it("keeps the original caller deadline for a 401 retry", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(token()))
    .mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return new Response(null, { status: 401 });
    })
    .mockResolvedValueOnce(new Response(token("replacement")))
    .mockImplementationOnce((_, init) => waitOnAbort(init?.signal));
  const pending = expect(read(clientWith(fetch), context(800))).rejects.toMatchObject({ code: "timeout" });
  await vi.advanceTimersByTimeAsync(800);
  await pending;
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(fetch.mock.calls[3][1]?.signal?.aborted).toBe(true);
});

it.each(["declared", "streamed"])("rejects %s oversized JSON and cancels upstream", async (sizeKind) => {
  const cancel = vi.fn();
  const body = new ReadableStream({
    start(controller) {
      if (sizeKind === "streamed") controller.enqueue(new Uint8Array(2 * MiB + 1));
    },
    cancel,
  });
  const headers = sizeKind === "declared" ? { "Content-Length": String(2 * MiB + 1) } : undefined;
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(token()))
    .mockResolvedValueOnce(new Response(body, { headers }));
  await expect(read(clientWith(fetch))).rejects.toMatchObject({ code: "payload_too_large" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true);
});

it("preserves integers Garmin sends beyond the safe JSON number range", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(token()))
    .mockResolvedValueOnce(new Response('{"activityId":9223372036854775807,"count":12,"name":"9223372036854775807"}'));
  await expect(read(clientWith(fetch))).resolves.toEqual({
    activityId: "9223372036854775807", count: 12, name: "9223372036854775807",
  });
});

it("uses the fixed archive path and cancels the upstream request if the archive consumer stops", async () => {
  const cancel = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(token()))
    .mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
      cancel,
    }), { headers: { "Content-Length": "3", "Content-Type": "application/zip" } }));
  const client = clientWith(fetch);
  await expect(client.readActivityArchive("1/anything", context(), 8)).rejects.toMatchObject({ code: "invalid_input" });
  expect(fetch).not.toHaveBeenCalled();
  const { body, contentLength, contentType } = await client.readActivityArchive("9223372036854775807", context(), 8);
  expect(String(fetch.mock.calls[1][0])).toBe(base + "/download-service/files/activity/9223372036854775807");
  expect(contentLength).toBe(3);
  expect(contentType).toBe("application/zip");
  const reader = body.getReader();
  expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([1, 2, 3]) });
  await reader.cancel();
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true);
});
