import { afterEach, expect, it, vi } from "vitest";
import { fixtureUpstream } from "../mcp/tool-test-fixtures";
import { deliverActivityArchive } from "./download";

const activityId = "9223372036854775807";
const archive = Buffer.from("504b0506" + "00".repeat(18), "hex");
const MiB = 1024 * 1024;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function redeem(signal = new AbortController().signal) {
  return deliverActivityArchive({ activityId, signal, deadline: Date.now() + 60_000 });
}

it("preserves original bytes when the ZIP signature spans multiple chunks", async () => {
  const chunks = [archive.subarray(0, 1), archive.subarray(1, 3), archive.subarray(3)];
  const upstream = fixtureUpstream(new Response(new ReadableStream({
    pull(controller) {
      const next = chunks.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  }), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'inline; filename="private-upstream-name.zip"',
      "Content-Length": String(archive.length),
    },
  }));

  const response = await redeem();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="activity.zip"');
  expect(response.headers.has("content-length")).toBe(false);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(archive);
  expect(upstream.paths()).toEqual([`/download-service/files/activity/${activityId}`]);
});

it("cancels a body whose bytes are not ZIP even if Garmin labels it ZIP", async () => {
  const cancel = vi.fn();
  fixtureUpstream(new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new TextEncoder().encode("private upstream response")); },
    cancel,
  }, { highWaterMark: 0 }), { headers: { "Content-Type": "application/zip" } }));

  const response = await redeem();

  expect(response.status).toBe(415);
  expect(await response.json()).toEqual({ error: "unsupported_archive" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("rejects an advertised archive above 100 MiB before delivering headers", async () => {
  const cancel = vi.fn();
  fixtureUpstream(new Response(new ReadableStream({ cancel }), {
    headers: { "Content-Length": String(100 * MiB + 1) },
  }));

  const response = await redeem();

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "payload_too_large" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("aborts an unbounded-length archive when the byte count crosses 100 MiB", async () => {
  const cancel = vi.fn();
  let chunks = 0;
  const megabyte = new Uint8Array(MiB);
  fixtureUpstream(new Response(new ReadableStream({
    pull(controller) {
      controller.enqueue(chunks++ === 0 ? archive : megabyte);
    },
    cancel,
  }, { highWaterMark: 0 })));

  const response = await redeem();
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  expect((await reader.read()).value).toEqual(archive);
  for (let chunk = 0; chunk < 99; chunk++) {
    expect((await reader.read()).value?.byteLength).toBe(MiB);
  }
  await expect(reader.read()).rejects.toMatchObject({ code: "payload_too_large" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("passes browser body cancellation through to Garmin without pulling more chunks", async () => {
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => controller.enqueue(archive));
  const cancel = vi.fn();
  fixtureUpstream(new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 })));

  const response = await redeem();
  expect(pull).toHaveBeenCalledOnce();
  const reader = response.body!.getReader();
  expect((await reader.read()).value).toEqual(archive);
  await reader.cancel();
  expect(pull).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
});

it("propagates the request abort to an in-flight Garmin body read", async () => {
  const cancel = vi.fn();
  let sent = false;
  fixtureUpstream(new Response(new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(archive);
      }
      return new Promise(() => {});
    },
    cancel,
  }, { highWaterMark: 0 })));

  const caller = new AbortController();
  const response = await redeem(caller.signal);
  const reader = response.body!.getReader();
  await reader.read();
  const pending = reader.read();
  caller.abort("private abort reason");

  await expect(pending).rejects.toMatchObject({ code: "timeout" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("fails an already-started download with a sanitized error when Garmin disconnects", async () => {
  let sent = false;
  fixtureUpstream(new Response(new ReadableStream({
    pull(controller) {
      if (sent) controller.error(new Error("private upstream error"));
      else controller.enqueue(archive);
      sent = true;
    },
  }, { highWaterMark: 0 })));

  const response = await redeem();
  const reader = response.body!.getReader();
  expect((await reader.read()).value).toEqual(archive);
  await expect(reader.read()).rejects.toMatchObject({
    code: "garmin_unavailable",
    message: "Garmin returned an unavailable or unexpected response.",
  });
});

it.each([
  { status: 404, headers: {}, expectedStatus: 404, error: "not_found" },
  { status: 429, headers: { "Retry-After": "0" }, expectedStatus: 429, error: "rate_limited" },
  { status: 500, headers: { "X-Upstream": "private" }, expectedStatus: 502, error: "garmin_unavailable" },
])("maps Garmin $status before streaming", async ({ status, headers, expectedStatus, error }) => {
  fixtureUpstream(new Response("private upstream response", { status, headers: headers as Record<string, string> }));

  const response = await redeem();

  expect(response.status).toBe(expectedStatus);
  expect(await response.json()).toEqual({ error });
  expect(response.headers.has("x-upstream")).toBe(false);
  expect(response.headers.get("retry-after")).toBe(headers["Retry-After"] ?? null);
});
