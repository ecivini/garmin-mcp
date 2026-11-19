# Garmin MCP release verification

## Recorded checks

| Check | Result |
| --- | --- |
| Live Auth0 checkpoint on fixture commit `e1e1259` | ChatGPT and Codex CLI both discovered and called `list_activity_types` as the owner. Issuer, audience, scope, and application checks passed on each call. The negotiated client revisions were unavailable in the captured results. |
| Complete local catalog | Signed owner fixtures for both application registrations discover the exact 29 tool names. Local negotiations cover `2025-03-26`, `2025-06-18`, and `2025-11-25`. The production build also served discovery over HTTP for both fixture clients. |
| Local authorization and logging | Denied requests stop before Garmin. Browser cookies cannot authorize MCP, and the MCP bearer cannot redeem a browser download. The release fixture flow emits no application console logs. |
| Local streaming | The authorized route streams a valid synthetic ZIP of 5,243,004 bytes without a downstream Content-Length. The byte count and SHA-256 matched over production-mode HTTP. |
| Local production FIT runtime | A signed fixture call through `next start` exercised the native worker. The Next.js function trace includes the worker and runtime dependencies. |

On Node.js 22.20.0, `npm ci`, all 165 fixture tests, lint, typecheck, and the production build passed.

## Deployment checks

1. Set up the separate confidential Auth0 browser application and set its credentials and both keys as described in [Security](security.md#browser-zip-access). Verify owner redemption and denial cases on a fixture deployment. Use an injected synthetic archive reader for the fixture deployment and check that a ZIP above 4.5 MB streams through Vercel with matching byte count and SHA-256. The local fixture test verifies the application route and the hosted check verifies the platform. [Vercel streaming guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
2. Review the terms presented when creating the Garmin key and the [Garmin FIT SDK license](https://github.com/garmin/fit-javascript-sdk). Confirm that the intended hosting and data disclosures are permitted. Then set `GARMIN_PERSONAL_API_KEY` in Vercel's sensitive environment settings and deploy the tested commit.
3. Check `/healthz` and OAuth metadata, then verify a Garmin read, FIT summary, and browser download from ChatGPT and Codex CLI. Check the downloaded ZIP against an authorized direct download of that activity by byte count and SHA-256. Verify negative authorization cases and inspect platform logs and drains for prohibited fields before releasing real data.
4. Record the deployed commit, client and runtime versions, negotiated MCP revision from each client's sanitized protocol trace when available, pass/fail for each check, and request timings. Keep raw account records, credentials, and download links out of the record.

Browser Auth0, hosted fixture streaming, live Garmin calls, and platform log review are pending.

## Rollback

Keep the validated fixture deployment available until the full catalog release passes. If an incident requires rollback, select **Instant Rollback** on Vercel's Production Deployment tile and confirm the previous known-good deployment and production domain. Hobby rollback is limited to the immediately previous production deployment. Verify `/healthz`, OAuth discovery, and the previously healthy tool call afterward. Check the restored deployment's environment configuration before re-promoting a replacement. [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback)
