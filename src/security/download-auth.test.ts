import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { GET as downloadRoute } from "../../app/downloads/activity/route";
import { POST as postMcp } from "../../app/mcp/route";
import { zipArchive } from "../archive/zip-fixture";
import { fixtureUpstream } from "../mcp/tool-test-fixtures";
import { createDownloadActivityRoute, handleDownloadCallback, issueDownloadTicket } from "./download-auth";

const origin = "https://garmin.example.test";
const issuer = "https://auth.example.test/";
const subject = "auth0|fixture-owner";
const activityId = "9223372036854775807";
const callbackUrl = origin + "/downloads/activity/callback";
const clientId = "fixture-browser-client";
const clientSecret = "fixture-browser-client-secret";
const env = {
  MCP_RESOURCE_URL: origin + "/mcp",
  AUTH0_ISSUER: issuer,
  AUTH0_CHATGPT_CLIENT_ID: "fixture-chatgpt",
  AUTH0_CODEX_CLIENT_ID: "fixture-codex",
  AUTH0_OWNER_SUBJECT: subject,
  AUTH0_BROWSER_CLIENT_ID: clientId,
  AUTH0_BROWSER_CLIENT_SECRET: clientSecret,
  DOWNLOAD_TICKET_KEY: Buffer.alloc(32, 7).toString("base64url"),
  DOWNLOAD_COOKIE_KEY: Buffer.alloc(32, 9).toString("base64url"),
};
let signingKey: CryptoKey;
let otherKey: CryptoKey;
let publicJwk: object;
const readArchive = vi.fn(() => new Response("synthetic archive bytes", {
  headers: { "Content-Type": "application/zip" },
}));
const redeem = createDownloadActivityRoute(readArchive);

beforeAll(async () => {
  const [trusted, other] = await Promise.all([generateKeyPair("RS256"), generateKeyPair("RS256")]);
  signingKey = trusted.privateKey;
  otherKey = other.privateKey;
  publicJwk = { ...(await exportJWK(trusted.publicKey)), kid: "fixture-key" };
});

beforeEach(() => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  readArchive.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

function cookie(response: Response, name: string): string {
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(name + "="));
  if (!setCookie) throw new Error("Fixture did not receive " + name);
  expect(setCookie).toContain("Path=/");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Lax");
  expect(setCookie).not.toContain("Domain=");
  return setCookie.split(";")[0];
}

async function startLogin(link?: string, headers?: HeadersInit) {
  const url = new URL(link ?? (await issueDownloadTicket({ issuer, subject }, activityId)).url);
  const response = await redeem(new Request("https://untrusted-host.example.test" + url.pathname + url.search, { headers }));
  expect(response.status).toBe(303);
  expectPrivate(response);
  const authorizeUrl = new URL(response.headers.get("location")!);
  const params = authorizeUrl.searchParams;
  expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(issuer + "authorize");
  expect(params.get("redirect_uri")).toBe(callbackUrl);
  expect(params.get("client_id")).toBe(clientId);
  expect(params.get("scope")).toBe("openid");
  expect(params.get("response_type")).toBe("code");
  expect(params.get("code_challenge_method")).toBe("S256");
  expect(params.get("state")).toBeTruthy();
  expect(params.get("nonce")).toBeTruthy();
  expect(authorizeUrl.href).not.toContain(url.searchParams.get("ticket")!);
  expect(authorizeUrl.href).not.toContain(clientSecret);
  const transaction = cookie(response, "__Host-garmin-download-transaction");
  expect(transaction).not.toContain(url.searchParams.get("ticket")!);
  expect(readArchive).not.toHaveBeenCalled();
  return { url, params, transaction };
}

function callback(state: string, transaction?: string) {
  return new Request(`https://untrusted-host.example.test/downloads/activity/callback?code=fixture-code&state=${state}`, {
    headers: transaction ? { Cookie: transaction } : undefined,
  });
}

function mockAuth0(params: URLSearchParams, overrides: JWTPayload = {}, key?: CryptoKey) {
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url) === issuer + "oauth/token") {
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("manual");
      expect(init?.cache).toBe("no-store");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("code")).toBe("fixture-code");
      expect(body.get("client_id")).toBe(clientId);
      expect(body.get("client_secret")).toBe(clientSecret);
      expect(body.get("redirect_uri")).toBe(callbackUrl);
      expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(params.get("code_challenge"));
      const idToken = await new SignJWT({
        iss: issuer, aud: clientId, sub: subject, nonce: params.get("nonce"),
        iat: Math.floor(Date.now() / 1_000), exp: Math.floor(Date.now() / 1_000) + 3600, ...overrides,
      }).setProtectedHeader({ alg: "RS256", kid: "fixture-key" }).sign(key ?? signingKey);
      return Response.json({ id_token: idToken, access_token: "unused-fixture-access-token", token_type: "Bearer" });
    }
    expect(String(url)).toBe(issuer + ".well-known/jwks.json");
    return Response.json({ keys: [publicJwk] });
  });
  vi.stubGlobal("fetch", request);
  return request;
}

async function signIn(link?: string, owner = subject) {
  const { url, params, transaction } = await startLogin(link);
  mockAuth0(params, { sub: owner });
  const response = await handleDownloadCallback(callback(params.get("state")!, transaction));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(url.href);
  expect(response.headers.getSetCookie().find((value) => value.startsWith("__Host-garmin-download-transaction="))).toContain("Max-Age=0");
  expectPrivate(response);
  return { url, session: cookie(response, "__Host-garmin-download-session") };
}

function tamper(value: string) {
  const parts = value.split(".");
  parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  return parts.join(".");
}

it("takes the owner through Auth0 and passes the exact activity ID to the archive reader", async () => {
  const { url, session } = await signIn();
  const controller = new AbortController();
  const incoming = new Request(url, { headers: { Cookie: session }, signal: controller.signal });
  const response = await redeem(incoming);
  expect(response.status).toBe(200);
  expectPrivate(response);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(await response.text()).toBe("synthetic archive bytes");
  expect(readArchive).toHaveBeenCalledExactlyOnceWith({
    activityId, signal: incoming.signal, deadline: expect.any(Number),
  });
});

it("serves original ZIP bytes only after browser authorization on the deployed route", async () => {
  const { url, session } = await signIn();
  const zip = Buffer.from("504b0506" + "00".repeat(18), "hex");
  const upstream = fixtureUpstream(new Response(zip));

  const denied = await downloadRoute(new Request(url, {
    headers: { Authorization: "Bearer no-browser-session" },
  }));
  expect(denied.status).toBe(303);
  expect(upstream.paths()).toEqual([]);

  const response = await downloadRoute(new Request(url, { headers: { Cookie: session } }));
  expect(response.status).toBe(200);
  expectPrivate(response);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="activity.zip"');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(zip);
  expect(upstream.paths()).toEqual([`/download-service/files/activity/${activityId}`]);
});

it("keeps browser and MCP credentials separate and streams a ZIP above Vercel's buffered limit", async () => {
  const logSpies = (["debug", "error", "info", "log", "warn"] as const)
    .map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
  try {
    const bearer = await new SignJWT({ azp: env.AUTH0_CHATGPT_CLIENT_ID, scope: "garmin:read" })
      .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
      .setIssuer(issuer)
      .setSubject(subject)
      .setAudience(env.MCP_RESOURCE_URL)
      .setExpirationTime("5m")
      .sign(signingKey);
    const jwks = vi.fn(async () => Response.json({ keys: [publicJwk] }));
    vi.stubGlobal("fetch", jwks);
    function mcpRequest(headers: Record<string, string>) {
      return new Request(env.MCP_RESOURCE_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json", accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25", ...headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "tools/call",
          params: { name: "download_activity", arguments: { activityId } },
        }),
      });
    }
    const authorization = `Bearer ${bearer}`;
    const issued = await postMcp(mcpRequest({ authorization }));
    expect(issued.status).toBe(200);
    expect(issued.headers.get("cache-control")).toBe("private, no-store");
    const wire = await issued.text();
    const message = /^data: (.+)$/m.exec(wire)?.[1] ?? wire;
    const { url: link } = JSON.parse(message).result.structuredContent;
    expect(jwks).toHaveBeenCalledExactlyOnceWith(issuer + ".well-known/jwks.json", expect.anything());

    const { url, session } = await signIn(link);
    const fixture = zipArchive([{ name: "synthetic.bin", bytes: Buffer.alloc(5 * 1024 * 1024, 0x5a) }]);
    const chunkSize = 64 * 1024;
    let sent = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        const end = Math.min(sent + chunkSize, fixture.length);
        controller.enqueue(new Uint8Array(fixture.subarray(sent, end)));
        sent = end;
        if (sent === fixture.length) controller.close();
      },
    }, { highWaterMark: 0 });
    const upstream = fixtureUpstream(new Response(source, {
      headers: { "content-length": String(fixture.length), "content-type": "application/zip" },
    }));

    expect((await postMcp(mcpRequest({ cookie: session }))).status).toBe(401);
    expect((await downloadRoute(new Request(url, { headers: { authorization } }))).status).toBe(303);
    expect(upstream.paths()).toEqual([]);

    const archive = await downloadRoute(new Request(url, { headers: { cookie: session } }));
    expect(archive.status).toBe(200);
    expectPrivate(archive);
    expect(archive.headers.get("content-length")).toBeNull();
    expect(sent).toBeLessThan(fixture.length);
    const reader = archive.body!.getReader();
    const hash = createHash("sha256");
    let received = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      hash.update(chunk.value);
    }
    expect(received).toBe(fixture.length);
    expect(received).toBeGreaterThan(4_500_000);
    expect(hash.digest("hex")).toBe(createHash("sha256").update(fixture).digest("hex"));
    expect(upstream.paths()).toEqual([`/download-service/files/activity/${activityId}`]);
    for (const spy of logSpies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of logSpies) spy.mockRestore();
  }
});

it("issues an opaque, replayable ten-minute ticket and refuses an expired ticket", async () => {
  vi.useFakeTimers();
  const now = Date.UTC(2025, 0, 1, 8);
  vi.setSystemTime(now);
  const link = await issueDownloadTicket({ issuer, subject }, activityId);
  expect(link.expiresAt).toBe(new Date(now + 600_000).toISOString());
  const ticket = new URL(link.url).searchParams.get("ticket")!;
  expect(ticket).not.toContain(subject);
  expect(ticket).not.toContain(activityId);
  const { url, session } = await signIn(link.url);
  for (let use = 0; use < 2; use++) {
    expect((await redeem(new Request(url, { headers: { Cookie: session } }))).status).toBe(200);
  }
  readArchive.mockClear();
  vi.setSystemTime(now + 600_000);
  const expired = await redeem(new Request(url, { headers: { Cookie: session } }));
  expect(expired.status).toBe(410);
  expectPrivate(expired);
  expect(readArchive).not.toHaveBeenCalled();
});

it("rejects a tampered or mismatched ticket even with an owner session", async () => {
  const { url, session } = await signIn();
  const other = "auth0|another-fixture";
  vi.stubEnv("AUTH0_OWNER_SUBJECT", other);
  const { url: wrongLink } = await issueDownloadTicket({ issuer, subject: other }, activityId);
  vi.stubEnv("AUTH0_OWNER_SUBJECT", subject);
  url.searchParams.set("ticket", tamper(url.searchParams.get("ticket")!));
  for (const link of [url.href, wrongLink]) {
    const denied = await redeem(new Request(link, { headers: { Cookie: session } }));
    expect(denied.status).toBe(403);
    expectPrivate(denied);
  }
  expect(readArchive).not.toHaveBeenCalled();
});

it("rechecks the current owner even for a valid encrypted browser session", async () => {
  const { url } = await issueDownloadTicket({ issuer, subject }, activityId);
  const other = "auth0|another-fixture";
  vi.stubEnv("AUTH0_OWNER_SUBJECT", other);
  const otherTicket = await issueDownloadTicket({ issuer, subject: other }, activityId);
  const { session } = await signIn(otherTicket.url, other);
  vi.stubEnv("AUTH0_OWNER_SUBJECT", subject);

  const denied = await redeem(new Request(url, { headers: { Cookie: session } }));
  expect(denied.status).toBe(403);
  expectPrivate(denied);
  expect(readArchive).not.toHaveBeenCalled();
});

it("requires an independent current browser session and disregards MCP bearer credentials", async () => {
  vi.useFakeTimers();
  const now = Date.UTC(2025, 0, 1, 8);
  vi.setSystemTime(now);
  const { url, session } = await signIn();
  const signedBearer = await new SignJWT({ azp: env.AUTH0_CHATGPT_CLIENT_ID, scope: "garmin:read" })
    .setProtectedHeader({ alg: "RS256", kid: "fixture-key" }).setIssuer(issuer).setSubject(subject)
    .setAudience(env.MCP_RESOURCE_URL).setExpirationTime("5m").sign(signingKey);
  await startLogin(url.href, { Authorization: `Bearer ${signedBearer}` });
  await startLogin(url.href, { Cookie: tamper(session) });
  vi.setSystemTime(now + 15 * 60_000);
  const fresh = await issueDownloadTicket({ issuer, subject }, activityId);
  await startLogin(fresh.url, { Cookie: session });
  expect(readArchive).not.toHaveBeenCalled();
});

it("rejects absent, modified, expired and mismatched callback state before exchange", async () => {
  vi.useFakeTimers();
  const now = Date.UTC(2025, 0, 1, 8);
  vi.setSystemTime(now);
  const { params, transaction } = await startLogin();
  const request = mockAuth0(params);
  const state = params.get("state")!;
  for (const invalid of [
    callback(state), callback(state + "x", transaction), callback(state, tamper(transaction)),
  ]) {
    const denied = await handleDownloadCallback(invalid);
    expect(denied.status).toBe(403);
    expectPrivate(denied);
  }
  vi.setSystemTime(now + 10 * 60_000);
  expect((await handleDownloadCallback(callback(state, transaction))).status).toBe(403);
  expect(request).not.toHaveBeenCalled();
  expect(readArchive).not.toHaveBeenCalled();
});

it.each([
  { name: "unapproved owner", claims: { sub: "auth0|other-fixture" } },
  { name: "invalid issuer", claims: { iss: "https://elsewhere.example.test/" } },
  { name: "MCP audience", claims: { aud: env.MCP_RESOURCE_URL } },
  { name: "invalid nonce", claims: { nonce: "bad-fixture" } },
  { name: "expired token", claims: { exp: 1 } },
  { name: "invalid signature", claims: {}, differentKey: true },
])("rejects an Auth0 callback with $name without setting a session", async ({ claims, differentKey }) => {
  const { params, transaction } = await startLogin();
  mockAuth0(params, claims, differentKey ? otherKey : signingKey);
  const denied = await handleDownloadCallback(callback(params.get("state")!, transaction));
  expect(denied.status).toBe(403);
  expect(denied.headers.getSetCookie().some((value) => value.startsWith("__Host-garmin-download-session="))).toBe(false);
  expectPrivate(denied);
  expect(readArchive).not.toHaveBeenCalled();
});

it("fails closed when browser setup is missing or reuses the MCP client or ticket key", async () => {
  const link = await issueDownloadTicket({ issuer, subject }, activityId);
  for (const [name, value] of [
    ["DOWNLOAD_COOKIE_KEY", ""], ["DOWNLOAD_COOKIE_KEY", env.DOWNLOAD_TICKET_KEY],
    ["AUTH0_BROWSER_CLIENT_ID", env.AUTH0_CHATGPT_CLIENT_ID],
  ]) {
    vi.stubEnv(name, value);
    expect((await redeem(new Request(link.url))).status).toBe(503);
    vi.stubEnv(name, env[name as keyof typeof env]);
  }
  expect(readArchive).not.toHaveBeenCalled();
});
