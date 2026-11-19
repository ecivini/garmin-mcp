import { vi } from "vitest";
import type { RegisteredTool } from "./tools";

export function fixtureUpstream(...responses: Response[]) {
  const paths: string[] = [];
  vi.stubEnv("GARMIN_PERSONAL_API_KEY", "fixture-key");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.origin !== "https://personal.connectapi.garmin.com") throw new Error("Unexpected fixture host");
    if (url.pathname === "/personalapitoken-service/personal-api/personal-api-key/token") {
      const claims = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
      return new Response(`eyJhbGciOiJSUzI1NiJ9.${claims.toString("base64url")}.c2lnbmF0dXJl`);
    }
    paths.push(url.pathname + url.search);
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fixture request");
    return response;
  }));
  return { paths: () => paths };
}

export function invoke(tool: RegisteredTool, input: unknown) {
  return tool.invoke(input, {
    identity: { issuer: "https://fixture-issuer.test/", subject: "auth0|fixture-owner" },
    signal: new AbortController().signal,
    deadline: Date.now() + 15_000,
  });
}
