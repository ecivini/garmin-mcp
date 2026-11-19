import { EncryptJWT, errors, jwtDecrypt, type JWTPayload } from "jose";
import {
  authorizationCodeGrant, buildAuthorizationUrl, calculatePKCECodeChallenge, ClientSecretPost,
  Configuration, customFetch, enableNonRepudiationChecks, randomNonce, randomPKCECodeVerifier, randomState,
} from "openid-client";
import { isGarminId } from "../garmin/client";
import { readMcpAuthConfig, type OwnerIdentity } from "./mcp-auth";

const activityPath = "/downloads/activity";
const callbackPath = activityPath + "/callback";
const sessionCookie = "__Host-garmin-download-session";
const transactionCookie = "__Host-garmin-download-transaction";
const ticketPurpose = "garmin-download-ticket";
const transactionPurpose = "garmin-download-transaction";
const sessionPurpose = "garmin-download-session";
const ticketLifetime = 10 * 60;
const sessionLifetime = 15 * 60;
const downloadBudget = 60_000;
const downloadHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

type BrowserConfig = ReturnType<typeof readBrowserConfig>;
type DownloadRequest = Readonly<{ activityId: string; signal: AbortSignal; deadline: number }>;
type ReadArchive = (request: DownloadRequest) => Response | Promise<Response>;

function encryptionKey(name: string): Buffer {
  const value = process.env[name] ?? "";
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== value) throw new Error("Invalid browser encryption key");
  return key;
}

function readBrowserConfig() {
  const mcp = readMcpAuthConfig();
  const clientId = process.env.AUTH0_BROWSER_CLIENT_ID;
  const clientSecret = process.env.AUTH0_BROWSER_CLIENT_SECRET;
  if (!clientId || !clientSecret || /\s/.test(clientId) || mcp.clients.includes(clientId)) {
    throw new Error("Invalid browser client configuration");
  }
  const ticketKey = encryptionKey("DOWNLOAD_TICKET_KEY");
  const cookieKey = encryptionKey("DOWNLOAD_COOKIE_KEY");
  if (ticketKey.equals(cookieKey) || mcp.ownerSubject.length > 255) throw new Error("Invalid browser configuration");

  const activityUrl = new URL(activityPath, mcp.resource);
  const callbackUrl = new URL(callbackPath, activityUrl);
  return { ...mcp, activityUrl, callbackUrl, clientId, clientSecret, ticketKey, cookieKey };
}

function browserConfig(): BrowserConfig | undefined {
  try {
    return readBrowserConfig();
  } catch {
    return undefined;
  }
}

function oidc(config: BrowserConfig) {
  const oidc = new Configuration({
    issuer: config.issuer,
    authorization_endpoint: new URL("authorize", config.issuer).href,
    token_endpoint: new URL("oauth/token", config.issuer).href,
    jwks_uri: new URL(".well-known/jwks.json", config.issuer).href,
    code_challenge_methods_supported: ["S256"],
  }, config.clientId, { id_token_signed_response_alg: "RS256" }, ClientSecretPost(config.clientSecret));
  oidc.timeout = 5;
  oidc[customFetch] = (url, options) => fetch(url, {
    ...options,
    body: options.body instanceof Uint8Array ? new Uint8Array(options.body) : options.body,
    cache: "no-store",
  });
  enableNonRepudiationChecks(oidc);
  return oidc;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1_000);
}

function seal(config: BrowserConfig, key: Buffer, purpose: string, expiresAt: number, claims: JWTPayload) {
  return new EncryptJWT(claims)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: `${purpose}+jwt` })
    .setIssuer(config.issuer)
    .setAudience(config.activityUrl.href)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .encrypt(key);
}

async function unseal(config: BrowserConfig, key: Buffer, purpose: string, value: string) {
  const { payload } = await jwtDecrypt(value, key, {
    keyManagementAlgorithms: ["dir"],
    contentEncryptionAlgorithms: ["A256GCM"],
    typ: `${purpose}+jwt`,
    issuer: config.issuer,
    audience: config.activityUrl.href,
    requiredClaims: ["iat", "exp"],
  });
  if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) throw new Error("Invalid browser claims");
  return payload;
}

function deliveryUrl(config: BrowserConfig, ticket: string) {
  const url = new URL(config.activityUrl);
  url.searchParams.set("ticket", ticket);
  return url;
}

export async function issueDownloadTicket(identity: OwnerIdentity, activityId: string) {
  const config = readBrowserConfig();
  if (identity.issuer !== config.issuer || identity.subject !== config.ownerSubject || !isGarminId(activityId)) {
    throw new Error("Invalid download authorization");
  }
  const expiration = nowSeconds() + ticketLifetime;
  const ticket = await seal(config, config.ticketKey, ticketPurpose, expiration, { sub: identity.subject, activityId });
  return { url: deliveryUrl(config, ticket).href, expiresAt: new Date(expiration * 1_000).toISOString() };
}

function setCookie(headers: Headers, name: string, value: string, seconds: number) {
  // Values are compact JOSE strings or empty for deletion. The host prefix requires this exact path.
  headers.append("Set-Cookie", `${name}=${value}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Lax`);
}

function getCookie(request: Request, name: string) {
  const matches = request.headers.get("cookie")?.split(";").map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(name + "="));
  const value = matches?.length === 1 ? matches[0].slice(name.length + 1) : undefined;
  return value && value.length <= 4_096 ? value : undefined;
}

function reply(status: number, error: string) {
  return Response.json({ error }, { status, headers: downloadHeaders });
}

function redirect(url: URL) {
  return new Response(null, { status: 303, headers: { ...downloadHeaders, Location: url.href } });
}

function queryTicket(request: Request) {
  const tickets = new URL(request.url).searchParams.getAll("ticket");
  return tickets.length === 1 && tickets[0] && tickets[0].length <= 2_048 ? tickets[0] : undefined;
}

async function readTicket(config: BrowserConfig, ticket: string) {
  const { sub, exp, activityId } = await unseal(config, config.ticketKey, ticketPurpose, ticket);
  if (sub !== config.ownerSubject || exp === undefined || typeof activityId !== "string" || !isGarminId(activityId)) {
    throw new Error("Invalid download ticket");
  }
  return { sub, exp, activityId };
}

async function readSession(config: BrowserConfig, request: Request) {
  const value = getCookie(request, sessionCookie);
  if (!value) return undefined;
  try {
    return await unseal(config, config.cookieKey, sessionPurpose, value);
  } catch {
    return undefined;
  }
}

async function beginLogin(config: BrowserConfig, ticket: string, expiresAt: number) {
  const verifier = randomPKCECodeVerifier();
  const state = randomState();
  const nonce = randomNonce();
  const transaction = await seal(config, config.cookieKey, transactionPurpose, expiresAt, { ticket, verifier, state, nonce });
  const location = buildAuthorizationUrl(oidc(config), {
    redirect_uri: config.callbackUrl.href, response_type: "code", response_mode: "query", scope: "openid",
    state, nonce, code_challenge: await calculatePKCECodeChallenge(verifier), code_challenge_method: "S256",
  });
  const response = redirect(location);
  setCookie(response.headers, transactionCookie, transaction, Math.max(0, expiresAt - nowSeconds()));
  return response;
}

export function createDownloadActivityRoute(readArchive: ReadArchive) {
  return async function getDownload(request: Request): Promise<Response> {
    const deadline = Date.now() + downloadBudget;
    const config = browserConfig();
    if (!config) return reply(503, "service_unavailable");
    const ticket = queryTicket(request);
    if (!ticket) return reply(403, "forbidden");

    let ownerTicket;
    try {
      ownerTicket = await readTicket(config, ticket);
    } catch (error) {
      return error instanceof errors.JWTExpired ? reply(410, "expired_ticket") : reply(403, "forbidden");
    }

    const session = await readSession(config, request);
    if (!session) return beginLogin(config, ticket, ownerTicket.exp).catch(() => reply(503, "service_unavailable"));
    if (session.sub !== ownerTicket.sub || session.clientId !== config.clientId) return reply(403, "forbidden");

    const response = await readArchive({ activityId: ownerTicket.activityId, signal: request.signal, deadline });
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(downloadHeaders)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}

export async function handleDownloadCallback(request: Request): Promise<Response> {
  const config = browserConfig();
  if (!config) return reply(503, "service_unavailable");
  let response: Response;

  try {
    const transaction = getCookie(request, transactionCookie);
    if (!transaction) throw new Error("Missing login transaction");
    const { ticket, verifier, state, nonce } = await unseal(config, config.cookieKey, transactionPurpose, transaction);
    if (typeof ticket !== "string" || typeof verifier !== "string" || typeof state !== "string" || typeof nonce !== "string") {
      throw new Error("Invalid login transaction");
    }
    const ownerTicket = await readTicket(config, ticket);
    const callback = new URL(config.callbackUrl);
    callback.search = new URL(request.url).search;
    const tokens = await authorizationCodeGrant(oidc(config), callback, {
      expectedState: state, expectedNonce: nonce, pkceCodeVerifier: verifier,
    });
    const id = tokens.claims();
    if (id?.iss !== config.issuer || id.sub !== ownerTicket.sub || !Number.isSafeInteger(id.exp)) {
      throw new Error("Invalid browser identity");
    }
    await readTicket(config, ticket);

    const expiration = Math.min(id.exp, nowSeconds() + sessionLifetime);
    const session = await seal(config, config.cookieKey, sessionPurpose, expiration, {
      sub: id.sub, clientId: config.clientId,
    });
    response = redirect(deliveryUrl(config, ticket));
    setCookie(response.headers, sessionCookie, session, Math.max(0, expiration - nowSeconds()));
  } catch {
    response = reply(403, "forbidden");
  }

  setCookie(response.headers, transactionCookie, "", 0);
  return response;
}

export function downloadMethodNotAllowed() {
  return new Response(null, { status: 405, headers: { ...downloadHeaders, Allow: "GET" } });
}
