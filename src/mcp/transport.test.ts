import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "../../app/mcp/route";

const resource = "https://garmin.example.test/mcp";
const issuer = "https://auth.example.test/";
const subject = "auth0|fixture-owner";
const clients = ["chatgpt-fixture", "codex-fixture"];
const maxBodyBytes = 64 * 1024;
const garminOrigin = "https://personal.connectapi.garmin.com";
const garminExchange = garminOrigin + "/personalapitoken-service/personal-api/personal-api-key/token";
const activityTypes = garminOrigin + "/activity-service/activity/activityTypes/simple";
const garminKey = "fixture-personal-key";
const privateUpstreamValue = "fixture-private-record";
const expectedResult = {
  data: [
    { key: "fixture_activity", parent: null },
    { key: "fixture_activity_variant", parent: "fixture_activity" },
  ],
  units: {},
};
let publicKey: object;
let tokens: string[];
let garminToken: string;
let upstream: ReturnType<typeof vi.fn<() => Response>>;
let requests: ReturnType<typeof vi.fn<typeof fetch>>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  publicKey = { ...(await exportJWK(pair.publicKey)), kid: "fixture-key" };
  tokens = await Promise.all(clients.map((azp) =>
    new SignJWT({ azp, scope: "garmin:read" })
      .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
      .setIssuer(issuer)
      .setSubject(subject)
      .setAudience(resource)
      .setExpirationTime("5m")
      .sign(pair.privateKey),
  ));
  garminToken = await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setExpirationTime("1h").sign(pair.privateKey);
});

beforeEach(() => {
  vi.stubEnv("MCP_RESOURCE_URL", resource);
  vi.stubEnv("AUTH0_ISSUER", issuer);
  vi.stubEnv("AUTH0_CHATGPT_CLIENT_ID", clients[0]);
  vi.stubEnv("AUTH0_CODEX_CLIENT_ID", clients[1]);
  vi.stubEnv("AUTH0_OWNER_SUBJECT", subject);
  vi.stubEnv("MCP_TRUSTED_ORIGINS", "");
  vi.stubEnv("GARMIN_PERSONAL_API_KEY", garminKey);
  upstream = vi.fn(() => Response.json([
    { ...expectedResult.data[1], userProfileId: privateUpstreamValue },
    { ...expectedResult.data[0], privateNotes: privateUpstreamValue },
  ]));
  requests = vi.fn(async (input, init) => {
    const url = String(input);
    if (url === issuer + ".well-known/jwks.json") return Response.json({ keys: [publicKey] });
    if (url === garminExchange) {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toBe(`ApiKey ${garminKey}`);
      return new Response(garminToken);
    }
    if (url === activityTypes) {
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${garminToken}`);
      return upstream();
    }
    throw new Error("Unexpected fixture request");
  });
  vi.stubGlobal("fetch", requests);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function post(body: string, token?: string, headers?: HeadersInit) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Content-Type", "application/json");
  requestHeaders.set("Accept", "application/json, text/event-stream");
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  return new Request(resource, { method: "POST", headers: requestHeaders, body });
}

function rpc(method: string, params?: object, id = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

async function readRpc(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.has("Mcp-Session-Id")).toBe(false);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");

  if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    const data = (await response.text()).split(/\r?\n/).find((line) => line.startsWith("data: "));
    if (!data) throw new Error("MCP response contained no SSE message");
    return JSON.parse(data.slice("data: ".length));
  }

  return response.json();
}

it.each([
  ["2025-03-26", 0],
  ["2025-06-18", 1],
  ["2025-11-25", 0],
] as const)("negotiates %s and calls the Garmin activity-types operation without a session", async (version, client) => {
  const token = tokens[client];
  const initialized = await POST(post(rpc("initialize", {
    protocolVersion: version,
    capabilities: {},
    clientInfo: { name: "fixture-client", version: "1.0.0" },
  }), token));

  expect(await readRpc(initialized)).toMatchObject({
    jsonrpc: "2.0",
    id: 1,
    result: { protocolVersion: version, serverInfo: { name: "garmin-mcp" } },
  });

  const headers = { "MCP-Protocol-Version": version };
  const ack = await POST(post(JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }), token, headers));
  expect(ack.status).toBe(202);
  expect(ack.headers.has("Mcp-Session-Id")).toBe(false);

  const listed = await readRpc(await POST(post(rpc("tools/list", {}, 2), token, headers)));
  expect(listed.result.tools).toHaveLength(29);
  expect(listed.result.tools[0]).toMatchObject({
    name: "list_activity_types",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true },
  });
  expect(upstream).not.toHaveBeenCalled();
  expect(requests.mock.calls.some(([url]) => String(url).startsWith(garminOrigin))).toBe(false);

  const called = await readRpc(await POST(post(rpc("tools/call", {
    name: "list_activity_types",
    arguments: {},
  }, 3), token, headers)));
  expect(called.result.isError).not.toBe(true);
  expect(called.result.structuredContent).toEqual(expectedResult);
  expect(JSON.parse(called.result.content[0].text)).toEqual(expectedResult);
  expect(JSON.stringify(called)).not.toContain(privateUpstreamValue);
  expect(upstream).toHaveBeenCalledOnce();
});

function callActivityTypes(args: object, token?: string) {
  return POST(post(rpc("tools/call", { name: "list_activity_types", arguments: args }), token, {
    "MCP-Protocol-Version": "2025-11-25",
  }));
}

it("rejects unauthorized tool calls before reaching Garmin", async () => {
  expect((await callActivityTypes({})).status).toBe(401);
  expect(requests).not.toHaveBeenCalled();
});

it("issues an opaque owner download link without fetching Garmin", async () => {
  vi.stubEnv("AUTH0_BROWSER_CLIENT_ID", "fixture-browser-client");
  vi.stubEnv("AUTH0_BROWSER_CLIENT_SECRET", "fixture-browser-secret");
  vi.stubEnv("DOWNLOAD_TICKET_KEY", Buffer.alloc(32, 7).toString("base64url"));
  vi.stubEnv("DOWNLOAD_COOKIE_KEY", Buffer.alloc(32, 9).toString("base64url"));
  const activityId = "9223372036854775807";
  const headers = { "MCP-Protocol-Version": "2025-11-25" };
  const call = (args: object) => POST(post(rpc("tools/call", {
    name: "download_activity",
    arguments: args,
  }), tokens[0], headers));

  const valid = await readRpc(await call({ activityId }));
  const { url, expiresAt } = valid.result.structuredContent;
  expect(valid.result.structuredContent).toEqual({ activityId, url, expiresAt });
  const link = new URL(url);
  expect(link.origin + link.pathname).toBe("https://garmin.example.test/downloads/activity");
  expect(link.searchParams.get("ticket")).toBeTruthy();
  expect(link.href).not.toContain(activityId);
  expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
  expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);

  for (const invalid of [{ activityId: "9223372036854775808" }, { activityId, url: "https://elsewhere.example" }]) {
    const denied = await readRpc(await call(invalid));
    expect(denied.result).toMatchObject({ isError: true, structuredContent: { code: "invalid_input" } });
  }
  expect(requests.mock.calls.some(([url]) => String(url).startsWith(garminOrigin))).toBe(false);
});

it("rejects unknown tool arguments with a sanitized error before reaching Garmin", async () => {
  const result = await readRpc(await callActivityTypes({ [privateUpstreamValue]: true }, tokens[0]));
  expect(result.result).toMatchObject({ isError: true, structuredContent: { code: "invalid_input" } });
  expect(JSON.stringify(result)).not.toContain(privateUpstreamValue);
  expect(requests.mock.calls.some(([url]) => String(url).startsWith(garminOrigin))).toBe(false);
});

it("sanitizes upstream HTTP and malformed response failures", async () => {
  upstream.mockReturnValueOnce(new Response(privateUpstreamValue, { status: 502 }));
  upstream.mockReturnValueOnce(Response.json([{ key: false, parent: privateUpstreamValue }]));
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await readRpc(await callActivityTypes({}, tokens[0]));
    expect(result.result).toMatchObject({ isError: true, structuredContent: { code: "garmin_unavailable" } });
    expect(JSON.stringify(result)).not.toContain(privateUpstreamValue);
  }
});

it("limits the serialized result including both structured and text copies", async () => {
  upstream.mockReturnValueOnce(Response.json([{ key: "x".repeat(70 * 1024), parent: null }]));
  const result = await readRpc(await callActivityTypes({}, tokens[0]));
  expect(result.result).toMatchObject({ isError: true, structuredContent: { code: "payload_too_large" } });
});

it("applies a 64 KiB POST limit with or without a declared size", async () => {
  const version = { "MCP-Protocol-Version": "2025-11-25" };
  const atLimit = rpc("tools/list").padEnd(maxBodyBytes);
  await readRpc(await POST(post(atLimit, tokens[0], version)));

  const overLimit = atLimit + " ";
  for (const headers of [version, { ...version, "Content-Length": String(maxBodyBytes + 1) }]) {
    const response = await POST(post(overLimit, tokens[0], headers));
    expect(response.status).toBe(413);
    expect(response.headers.has("Mcp-Session-Id")).toBe(false);
  }

  const unauthorized = post(overLimit, undefined, version);
  expect((await POST(unauthorized)).status).toBe(401);
  expect(unauthorized.bodyUsed).toBe(false);
});

it.each([{ handler: GET, method: "GET" }, { handler: DELETE, method: "DELETE" }])(
  "gates $method before returning 405 for an authorized request",
  async ({ handler, method }) => {
    expect((await handler(new Request(resource, { method }))).status).toBe(401);
    const response = await handler(new Request(resource, {
      method,
      headers: { Authorization: `Bearer ${tokens[0]}` },
    }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.has("Mcp-Session-Id")).toBe(false);
  },
);
