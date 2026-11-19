import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "../../app/mcp/route";

const resource = "https://garmin.example.test/mcp";
const issuer = "https://auth.example.test/";
const subject = "auth0|fixture-owner";
const clients = ["chatgpt-fixture", "codex-fixture"];
const maxBodyBytes = 64 * 1024;
const expectedResult = {
  data: [
    { key: "fixture_activity", parent: null },
    { key: "fixture_activity_variant", parent: "fixture_activity" },
  ],
  units: {},
};
let publicKey: object;
let tokens: string[];

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
});

beforeEach(() => {
  vi.stubEnv("MCP_RESOURCE_URL", resource);
  vi.stubEnv("AUTH0_ISSUER", issuer);
  vi.stubEnv("AUTH0_CHATGPT_CLIENT_ID", clients[0]);
  vi.stubEnv("AUTH0_CODEX_CLIENT_ID", clients[1]);
  vi.stubEnv("AUTH0_OWNER_SUBJECT", subject);
  vi.stubEnv("MCP_TRUSTED_ORIGINS", "");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [publicKey] })));
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
] as const)("negotiates %s and serves the fixture without a session", async (version, client) => {
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
  expect(listed.result.tools).toHaveLength(1);
  expect(listed.result.tools[0]).toMatchObject({
    name: "list_activity_types",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true },
  });

  const called = await readRpc(await POST(post(rpc("tools/call", {
    name: "list_activity_types",
    arguments: {},
  }, 3), token, headers)));
  expect(called.result.isError).not.toBe(true);
  expect(called.result.structuredContent).toEqual(expectedResult);
  expect(JSON.parse(called.result.content[0].text)).toEqual(expectedResult);
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
