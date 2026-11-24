import { createRemoteJWKSet, jwtVerify } from "jose";

export type OwnerIdentity = Readonly<{ issuer: string; subject: string }>;

type McpAuthConfig = Readonly<{
  resource: string;
  issuer: string;
  clients: readonly string[];
  ownerSubject: string;
  trustedOrigins: readonly string[];
}>;

type McpDispatch = (request: Request, identity: OwnerIdentity) => Response | Promise<Response>;
type Environment = Readonly<Record<string, string | undefined>>;

const requiredScope = "garmin:read";
const metadataPath = "/.well-known/oauth-protected-resource/mcp";
const privateHeaders = { "Cache-Control": "private, no-store" };
const mcpClientSettings = [
  "AUTH0_CHATGPT_CLIENT_ID",
  "AUTH0_CODEX_CLIENT_ID",
  "AUTH0_CLAUDE_CLIENT_ID",
  "AUTH0_CLAUDE_CODE_CLIENT_ID",
  "AUTH0_GEMINI_CLIENT_ID",
  "AUTH0_OPENCODE_CLIENT_ID",
];

function requiredSetting(env: Environment, name: string): string {
  const value = env[name];
  if (!value || /\s/.test(value)) {
    throw new Error(`Invalid ${name} configuration`);
  }
  return value;
}

function requireHttpsUrl(value: string, path: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || value !== url.origin + path) {
    throw new Error("Invalid MCP URL configuration");
  }
  return value;
}

export function readMcpAuthConfig(env: Environment = process.env): McpAuthConfig {
  const resource = requireHttpsUrl(requiredSetting(env, "MCP_RESOURCE_URL"), "/mcp");
  const issuer = requireHttpsUrl(requiredSetting(env, "AUTH0_ISSUER"), "/");
  const clients = mcpClientSettings.filter((name) => env[name]).map((name) => requiredSetting(env, name));
  const ownerSubject = requiredSetting(env, "AUTH0_OWNER_SUBJECT");

  const browserClient = env.AUTH0_BROWSER_CLIENT_ID;
  if (clients.length === 0 || new Set(clients).size !== clients.length ||
      (browserClient && clients.includes(browserClient)) || ownerSubject.endsWith("@clients")) {
    throw new Error("Invalid MCP identity configuration");
  }

  const trustedOrigins = env.MCP_TRUSTED_ORIGINS?.trim()
    ? env.MCP_TRUSTED_ORIGINS.split(",").map((origin) => requireHttpsUrl(origin.trim(), ""))
    : [];

  return { resource, issuer, clients, ownerSubject, trustedOrigins };
}

export function createMcpAuthorization(config: McpAuthConfig) {
  const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", config.issuer));
  const challenge = `Bearer resource_metadata="${new URL(metadataPath, config.resource).href}", scope="${requiredScope}"`;

  function unauthorized(invalidToken: boolean) {
    const error = invalidToken ? ', error="invalid_token"' : "";
    return Response.json({ error: "unauthorized" }, {
      status: 401,
      headers: { ...privateHeaders, "WWW-Authenticate": challenge + error },
    });
  }

  function forbidden() {
    return Response.json({ error: "forbidden" }, { status: 403, headers: privateHeaders });
  }

  return async function authorize(request: Request, dispatch: McpDispatch): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && !config.trustedOrigins.includes(origin)) {
      return forbidden();
    }

    const authorization = request.headers.get("authorization");
    const bearer = /^Bearer +([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(authorization ?? "")?.[1];
    if (!bearer) {
      return unauthorized(authorization !== null);
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(bearer, jwks, {
        algorithms: ["RS256"],
        issuer: config.issuer,
        audience: config.resource,
        requiredClaims: ["exp", "sub"],
      }));
    } catch {
      return unauthorized(true);
    }

    if (!Number.isFinite(payload.exp) ||
        (payload.nbf !== undefined && !Number.isFinite(payload.nbf)) ||
        typeof payload.sub !== "string" || payload.sub === "") {
      return unauthorized(true);
    }

    if (typeof payload.azp !== "string" || !config.clients.includes(payload.azp) ||
        payload.gty === "client-credentials" || payload.sub !== config.ownerSubject) {
      return forbidden();
    }

    if (typeof payload.scope !== "string" || !payload.scope.split(" ").includes(requiredScope)) {
      return Response.json({ error: "insufficient_scope" }, {
        status: 403,
        headers: { ...privateHeaders, "WWW-Authenticate": challenge + ', error="insufficient_scope"' },
      });
    }

    const response = await dispatch(request, { issuer: config.issuer, subject: payload.sub });
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", privateHeaders["Cache-Control"]);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}

let authorize: ReturnType<typeof createMcpAuthorization> | undefined;

export function authorizeMcpRequest(request: Request, dispatch: McpDispatch): Promise<Response> {
  try {
    authorize ??= createMcpAuthorization(readMcpAuthConfig());
  } catch {
    return Promise.resolve(unavailable());
  }
  return authorize(request, dispatch);
}

export function protectedResourceMetadata(): Response {
  try {
    const { resource, issuer } = readMcpAuthConfig();
    return Response.json({
      resource,
      authorization_servers: [issuer],
      scopes_supported: [requiredScope],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}

function unavailable() {
  return Response.json({ error: "service_unavailable" }, { status: 503, headers: privateHeaders });
}
