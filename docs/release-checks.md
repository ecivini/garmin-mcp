# Garmin MCP release verification

Follow the [setup guide](setup.md) for Auth0 registrations, Vercel variables, and client connections.

## Recorded checks

| Check | Result |
| --- | --- |
| Live Auth0 checkpoint on fixture commit `e1e1259` | ChatGPT and Codex CLI both discovered and called `list_activity_types` as the owner. Issuer, audience, scope, and application checks passed on each call. The negotiated client revisions were unavailable in the captured results. |
| Complete local catalog | Automated tests with signed owner tokens cover all five MCP registrations, discovery of the exact 29 tool names, and calls to `list_activity_types`. Gemini passes over MCP `2025-11-25` both alone and alongside the other clients. Local tests also cover `2025-03-26`, `2025-06-18`, and Claude Code's `2026-07-28` path. |
| Local Gemini authorization | Signed tokens for a disabled Gemini client, wrong issuer or audience, wrong owner, missing scope, or the browser client are denied before MCP dispatch. |
| Local OpenCode V2 server compatibility | Signed fixture tokens cover OpenCode alone and alongside the other clients. The tests verify the MCP `2025-11-25` handshake, all 29 tool names, and a `list_activity_types` call. Invalid tokens and client configurations are rejected before MCP dispatch. |
| Local authorization and logging | Denied requests stop before Garmin. Browser cookies cannot authorize MCP, and the MCP bearer cannot redeem a browser download. The release fixture flow emits no application console logs. |
| Local streaming | The authorized route streams a valid synthetic ZIP of 5,243,004 bytes without a downstream Content-Length. The byte count and SHA-256 matched over production-mode HTTP. |
| Local production FIT runtime | A signed fixture call through `next start` exercised the native worker. The Next.js function trace includes the worker and runtime dependencies. |

The original release passed `npm ci` and 165 tests on Node.js 22.20.0. The Claude compatibility change passed all 178 tests, lint, typecheck, and the production build on the same Node.js version.

## Deployment checks

1. Set up the separate confidential Auth0 browser application and set its credentials and both keys as described in [Security](security.md#browser-zip-access). Verify owner redemption and denial cases on a fixture deployment. Use an injected synthetic archive reader for the fixture deployment and check that a ZIP above 4.5 MB streams through Vercel with matching byte count and SHA-256. The local fixture test verifies the application route and the hosted check verifies the platform. [Vercel streaming guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
2. Review the terms presented when creating the Garmin key and the [Garmin FIT SDK license](https://github.com/garmin/fit-javascript-sdk). Confirm that the intended hosting and data disclosures are permitted. Then set `GARMIN_PERSONAL_API_KEY` in Vercel's sensitive environment settings and deploy the tested release commit.
3. Check `/healthz` and OAuth metadata, then verify a Garmin read, FIT summary, and browser download from each configured client. Check the downloaded ZIP against an authorized direct download of that activity by byte count and SHA-256. Verify negative authorization cases and inspect platform logs and drains for prohibited fields before releasing real data.
4. Record the deployed commit, client and runtime versions, negotiated MCP revision from each client's sanitized protocol trace when available, pass/fail for each check, and request timings. Keep raw account records, credentials, and download links out of the record.
5. For OpenCode V2, follow the [OpenCode setup](setup.md#8-connect-opencode-v2). Run `opencode mcp auth garmin` and complete the owner sign-in. Confirm `opencode mcp list` reports `garmin` as connected, then call `list_activity_types` from an OpenCode session. Record the OpenCode version, deployed commit, and result.

Browser Auth0, hosted ZIP streaming, live Garmin calls, platform log review, and the OpenCode V2 hosted check are pending.

## Rollback

If an incident requires rollback, select **Instant Rollback** on Vercel's Production Deployment tile and confirm the previous known-good deployment and production domain. Hobby rollback is limited to the immediately previous production deployment. Verify `/healthz`, OAuth discovery, and the previously healthy tool call afterward. Check the restored deployment's environment configuration before re-promoting a replacement. [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback)
