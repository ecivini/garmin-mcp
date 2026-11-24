import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as rootMetadata } from "../../app/.well-known/oauth-protected-resource/route";
import { GET as pathMetadata } from "../../app/.well-known/oauth-protected-resource/mcp/route";
import * as route from "../../app/mcp/route";
import { createMcpAuthorization, readMcpAuthConfig } from "./mcp-auth";

const resource = "https://garmin.example.test/mcp";
const issuer = "https://auth.example.test/";
const origin = "https://trusted.example.test";
const owner = "auth0|fixture-owner";
const metadataUrl = "https://garmin.example.test/.well-known/oauth-protected-resource/mcp";
const claudeClient = "claude-fixture";
const claudeCodeClient = "claude-code-fixture";
const geminiClient = "gemini-fixture";
const openCodeClient = "opencode-fixture";
const env = {
  MCP_RESOURCE_URL: resource,
  AUTH0_ISSUER: issuer,
  AUTH0_CHATGPT_CLIENT_ID: "chatgpt-fixture",
  AUTH0_CODEX_CLIENT_ID: "codex-fixture",
  AUTH0_BROWSER_CLIENT_ID: "browser-fixture",
  AUTH0_OWNER_SUBJECT: owner,
  MCP_TRUSTED_ORIGINS: origin,
};
const claudeOnlyEnv = {
  ...env,
  AUTH0_CHATGPT_CLIENT_ID: undefined,
  AUTH0_CODEX_CLIENT_ID: "",
  AUTH0_CLAUDE_CLIENT_ID: claudeClient,
  AUTH0_CLAUDE_CODE_CLIENT_ID: claudeCodeClient,
};
const claims: JWTPayload = {
  iss: issuer,
  sub: owner,
  aud: resource,
  azp: env.AUTH0_CHATGPT_CLIENT_ID,
  scope: "openid garmin:read",
};
const rpcMethods = ["initialize", "tools/list", "tools/call"];
const dispatch = vi.fn(() => new Response(null, { status: 204 }));
let signingKey: CryptoKey;
let foreignKey: CryptoKey;
let publicJwk: object;

beforeAll(async () => {
  const [trustedPair, foreignPair] = await Promise.all([
    generateKeyPair("RS256", { extractable: true }),
    generateKeyPair("RS256"),
  ]);
  signingKey = trustedPair.privateKey;
  foreignKey = foreignPair.privateKey;
  publicJwk = { ...(await exportJWK(trustedPair.publicKey)), kid: "fixture-key" };
});

beforeEach(() => {
  dispatch.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function token(overrides: JWTPayload = {}, key: CryptoKey | Uint8Array = signingKey) {
  return new SignJWT({ exp: Math.floor(Date.now() / 1000) + 300, ...claims, ...overrides })
    .setProtectedHeader({ alg: key instanceof Uint8Array ? "HS256" : "RS256", kid: "fixture-key" })
    .sign(key);
}

function request(method: string, bearer?: string, suppliedOrigin?: string) {
  const headers = new Headers();
  if (bearer !== undefined) headers.set("authorization", `Bearer ${bearer}`);
  if (suppliedOrigin !== undefined) headers.set("origin", suppliedOrigin);
  return new Request("https://forwarded-host.example.test/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method, id: 1 }),
  });
}

function fixtureGate(settings: Parameters<typeof readMcpAuthConfig>[0] = env) {
  const fetch = vi.fn(async () => Response.json({ keys: [publicJwk] }));
  vi.stubGlobal("fetch", fetch);
  return { fetch, authorize: createMcpAuthorization(readMcpAuthConfig(settings)) };
}

describe("MCP authorization", () => {
  it.each([
    ["ChatGPT without Origin", env.AUTH0_CHATGPT_CLIENT_ID, undefined],
    ["Codex with an approved Origin", env.AUTH0_CODEX_CLIENT_ID, origin],
  ])("dispatches for %s with the verified owner", async (_name, clientId, suppliedOrigin) => {
    const { fetch, authorize } = fixtureGate();
    const bearer = await token({ azp: clientId, aud: [resource, new URL("userinfo", issuer).href] });
    const incoming = request("tools/list", bearer, suppliedOrigin);

    expect((await authorize(incoming, dispatch)).status).toBe(204);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(incoming, { issuer, subject: owner });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      new URL(".well-known/jwks.json", issuer).href,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it.each([claudeClient, claudeCodeClient])("dispatches for %s in a Claude-only deployment", async (client) => {
    const { authorize } = fixtureGate(claudeOnlyEnv);
    const incoming = request("tools/list", await token({ azp: client }));
    expect((await authorize(incoming, dispatch)).status).toBe(204);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(incoming, { issuer, subject: owner });
  });

  it.each([
    { name: "missing bearer", issue: async () => undefined, status: 401 },
    { name: "malformed bearer", issue: async () => "malformed", status: 401 },
    { name: "expired bearer", issue: () => token({ exp: 1 }), status: 401 },
    { name: "missing expiry", issue: () => token({ exp: undefined }), status: 401 },
    { name: "not yet valid", issue: () => token({ nbf: Math.floor(Date.now() / 1000) + 300 }), status: 401 },
    { name: "invalid signature", issue: () => token({}, foreignKey), status: 401 },
    { name: "incorrect algorithm", issue: () => token({}, new Uint8Array(32)), status: 401 },
    { name: "wrong issuer", issue: () => token({ iss: "https://other.example.test/" }), status: 401 },
    { name: "wrong audience", issue: () => token({ aud: `${resource}/` }), status: 401 },
    { name: "ID token", issue: () => token({ aud: env.AUTH0_CHATGPT_CLIENT_ID, azp: undefined, scope: undefined }), status: 401 },
    { name: "missing subject", issue: () => token({ sub: undefined }), status: 401 },
    { name: "unapproved subject", issue: () => token({ sub: "auth0|fixture-other" }), status: 403 },
    { name: "browser client", issue: () => token({ azp: env.AUTH0_BROWSER_CLIENT_ID }), status: 403 },
    { name: "unconfigured Claude client", issue: () => token({ azp: claudeClient }), status: 403 },
    { name: "unknown client", issue: () => token({ azp: "unknown-fixture" }), status: 403 },
    { name: "missing client", issue: () => token({ azp: undefined }), status: 403 },
    { name: "machine grant", issue: () => token({ gty: "client-credentials" }), status: 403 },
    { name: "machine subject", issue: () => token({ sub: "chatgpt-fixture@clients" }), status: 403 },
    { name: "missing scope", issue: () => token({ scope: undefined }), status: 403, insufficientScope: true },
    { name: "partial scope", issue: () => token({ scope: "garmin:read-all" }), status: 403, insufficientScope: true },
    { name: "untrusted Origin", issue: () => token(), status: 403, suppliedOrigin: "https://untrusted.example.test" },
    { name: "opaque Origin", issue: () => token(), status: 403, suppliedOrigin: "null" },
  ])("never dispatches with $name", async ({ issue, status, insufficientScope, suppliedOrigin }) => {
    const { fetch, authorize } = fixtureGate();
    const bearer = await issue();
    for (const method of rpcMethods) {
      const response = await authorize(request(method, bearer, suppliedOrigin), dispatch);
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const challenge = response.headers.get("www-authenticate");
      if (status === 401 || insufficientScope) {
        expect(challenge).toBe(
          `Bearer resource_metadata="${metadataUrl}", scope="garmin:read"` +
            (insufficientScope ? ', error="insufficient_scope"' : bearer ? ', error="invalid_token"' : ""),
        );
      } else {
        expect(challenge).toBeNull();
      }
    }
    expect(dispatch).not.toHaveBeenCalled();
    if (suppliedOrigin) expect(fetch).not.toHaveBeenCalled();
  });

  describe.each([
    { clientId: geminiClient, setting: "AUTH0_GEMINI_CLIENT_ID" },
    { clientId: openCodeClient, setting: "AUTH0_OPENCODE_CLIENT_ID" },
  ])("OAuth with $setting", ({ clientId, setting }) => {
    it.each([
      { name: "client unset", configuredId: undefined, overrides: {}, status: 403 },
      { name: "client empty", configuredId: "", overrides: {}, status: 403 },
      { name: "wrong issuer", configuredId: clientId, overrides: { iss: "https://other.example.test/" }, status: 401 },
      { name: "wrong audience", configuredId: clientId, overrides: { aud: `${resource}/` }, status: 401 },
      { name: "wrong owner", configuredId: clientId, overrides: { sub: "auth0|fixture-other" }, status: 403 },
      { name: "missing scope", configuredId: clientId, overrides: { scope: undefined }, status: 403 },
      { name: "browser client", configuredId: clientId, overrides: { azp: env.AUTH0_BROWSER_CLIENT_ID }, status: 403 },
    ])("never dispatches with $name", async ({ configuredId, overrides, status }) => {
      const { authorize } = fixtureGate({ ...env, [setting]: configuredId });
      const bearer = await token({ azp: clientId, ...overrides });

      for (const method of rpcMethods) {
        expect((await authorize(request(method, bearer), dispatch)).status).toBe(status);
      }
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  it("fails closed if the pinned key endpoint is unavailable", async () => {
    const { fetch, authorize } = fixtureGate();
    fetch.mockRejectedValueOnce(new Error("fixture JWKS failure"));

    const response = await authorize(request("tools/list", await token()), dispatch);

    expect(response.status).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("JWKS");
  });
});

describe("MCP authorization routes", () => {
  it("fails closed when deployment configuration is missing", async () => {
    vi.stubEnv("MCP_RESOURCE_URL", "");
    expect((await route.POST(request("initialize"))).status).toBe(503);
    expect(rootMetadata().status).toBe(503);
  });

  it("serves both public metadata paths and authenticates every App Router method", async () => {
    for (const [key, value] of Object.entries(claudeOnlyEnv)) vi.stubEnv(key, value);
    const expected = {
      resource,
      authorization_servers: [issuer],
      scopes_supported: ["garmin:read"],
    };

    for (const get of [rootMetadata, pathMetadata]) {
      const response = get();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual(expected);
    }

    for (const method of ["GET", "POST", "DELETE", "HEAD", "OPTIONS", "PUT", "PATCH"] as const) {
      const response = await route[method](new Request(resource, { method }));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(metadataUrl);
    }
  });
});

describe("MCP authorization configuration", () => {
  it("allows one configured MCP client", () => {
    expect(readMcpAuthConfig({ ...claudeOnlyEnv, AUTH0_CLAUDE_CODE_CLIENT_ID: "" }).clients)
      .toEqual([claudeClient]);
  });

  it.each([
    { MCP_RESOURCE_URL: `${resource}/` },
    { MCP_RESOURCE_URL: "http://garmin.example.test/mcp" },
    { MCP_RESOURCE_URL: `${resource}?query=1` },
    { AUTH0_ISSUER: `${issuer}wrong/` },
    { AUTH0_ISSUER: "https://someone@auth.example.test/" },
    { AUTH0_CODEX_CLIENT_ID: env.AUTH0_CHATGPT_CLIENT_ID },
    { AUTH0_CLAUDE_CLIENT_ID: env.AUTH0_CHATGPT_CLIENT_ID },
    { AUTH0_CLAUDE_CODE_CLIENT_ID: env.AUTH0_BROWSER_CLIENT_ID },
    { AUTH0_CLAUDE_CLIENT_ID: " " },
    { AUTH0_CLAUDE_CODE_CLIENT_ID: "client with spaces" },
    { AUTH0_GEMINI_CLIENT_ID: env.AUTH0_CHATGPT_CLIENT_ID },
    { AUTH0_GEMINI_CLIENT_ID: env.AUTH0_BROWSER_CLIENT_ID },
    { AUTH0_GEMINI_CLIENT_ID: "client with spaces" },
    { AUTH0_OPENCODE_CLIENT_ID: env.AUTH0_CHATGPT_CLIENT_ID },
    { AUTH0_OPENCODE_CLIENT_ID: env.AUTH0_BROWSER_CLIENT_ID },
    { AUTH0_OPENCODE_CLIENT_ID: "client with spaces" },
    { AUTH0_CHATGPT_CLIENT_ID: "", AUTH0_CODEX_CLIENT_ID: undefined },
    { AUTH0_OWNER_SUBJECT: "fixture-machine@clients" },
    { MCP_TRUSTED_ORIGINS: "*" },
  ])("rejects misconfiguration %j", (overrides) => {
    expect(() => readMcpAuthConfig({ ...env, ...overrides })).toThrow();
  });
});
