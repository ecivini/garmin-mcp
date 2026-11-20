# Garmin Personal MCP

This project is a single-owner, read-only Garmin Connect MCP server for Codex CLI and ChatGPT. It runs on Node.js 22 and Next.js App Router, with Auth0 for MCP authorization and browser download sign-in.

## Working with the owner

- Before creating, editing, or deleting files, or changing external state, present a concrete plan and wait for explicit approval. Read-only inspection is allowed. Proceed within the approved scope and ask for approval again if it changes materially.
- A question or request for a recommendation authorizes discussion. A manually invoked skill can produce its routine outputs if the owner has already approved that skill's behavior. Actions outside that scope require approval.
- Write Codex skill instructions in English. Use the language requested by the owner for user-facing content.

## Repository map

| Path | Responsibility |
| --- | --- |
| `app/mcp/route.ts` and `src/mcp/` | MCP HTTP transport, tool definitions, input validation, and output projections. |
| `src/security/` | Auth0 token verification, owner checks, browser sessions, and download tickets. |
| `src/garmin/client.ts` | Fixed Garmin operations, token exchange, timeouts, and size limits. |
| `app/downloads/activity/` and `src/archive/` | Authorized ZIP delivery and bounded FIT analysis. |

Use the [setup guide](docs/setup.md) for configuration, the [tool catalog](docs/tool-catalog.md) for tool contracts, and the [architecture](docs/architecture.md) and [security](docs/security.md) docs for deployment and authorization constraints. Follow the [release checklist](docs/release-checks.md) for hosted or live verification.

## Verification commands

Use Node.js 22.12 or later in the 22.x series and npm.

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

## Security and test boundaries

- Verify the Auth0 owner and OAuth client before MCP dispatch. Browser ZIP redemption requires its own verified session and an owner-bound ticket before archive access.
- Use the bounded Garmin client, fixed operation mappings, and explicit output field projections. Apply the existing request, response, and archive limits.
- Use synthetic records, tokens, and archives in tests. Keep real Garmin records, credentials, private URLs, and download tickets out of fixtures and logs.
- Keep live secrets in server-side environment settings. Keep secret values and local environment files out of Git.
