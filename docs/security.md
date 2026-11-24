# Garmin Personal MCP security

## Auth0 and discovery

Use an Auth0 Free tenant for authorization code with PKCE (`S256`). Pre-register a separate Auth0 application for each MCP client you configure. Configure the API identifier and required JWT audience to the exact canonical HTTPS MCP URL, including `/mcp` and with no trailing slash. Define and issue the single delegated API scope `garmin:read`. Enable the Auth0 Resource Parameter Compatibility Profile so the clients' OAuth `resource` parameter targets that audience. Verify issuance for each configured client on the actual tenant before release. [Auth0 resource configuration](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0)

Publish `GET /.well-known/oauth-protected-resource/mcp` with the canonical MCP URL as `resource`, the pinned Auth0 issuer in `authorization_servers`, and `garmin:read` in `scopes_supported`. Serve the same public metadata at the root well-known location for clients that try it. Point the Bearer challenge at the path-specific metadata URL and include the required scope. Auth0 provides issuer discovery, authorization, token exchange and JWKS. Verify its metadata advertises `S256` and that the resource is carried through authorization and token exchange. [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) · [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)

| Registration | Configuration |
| --- | --- |
| ChatGPT custom MCP connection | Use the predefined OAuth client option, with the exact redirect URI shown by ChatGPT for that connection and the matching token endpoint authentication method. Keep any confidential client secret in Auth0 and the client connection configuration. Verify that the target account and workspace allow predefined client credentials for a custom connection in regular chats. Treat a missing option as a compatibility blocker for this design. |
| Codex CLI | Register a public native application with PKCE. Add it with `codex mcp add garmin --url https://garmin.example.com/mcp --oauth-client-id <id>`. Register the exact callback displayed by Codex, including its callback ID if present. If the provider requires a fixed port, align the registered URI, configured callback URL and listener port. Use `codex mcp login garmin` to sign in again. |
| Claude custom connector | Use a pre-registered public client with PKCE and the exact `https://claude.ai/api/mcp/auth_callback` callback. |
| Claude Code direct connection | Use a separate public native app with PKCE and the fixed loopback callback described in the [setup guide](setup.md#direct-connection-in-claude-code). |
| OpenCode V2 | Use a separate public native app with S256 PKCE and token endpoint authentication `None`. Register `http://127.0.0.1:19876/callback` and match the redirect URI and listener port in [OpenCode configuration](setup.md#8-connect-opencode-v2). |
| Browser downloads | Register a separate confidential web application for the server's same-origin login callback. Enable only the owner connection. Its ID token establishes the browser session after the server verifies the OIDC callback. |

Keep public sign-ups disabled on the Auth0 database connection. Manually provision the owner's account and enable only that connection for the registered applications. Keep an explicit server-side allowlist of issuer and subject pairs controlled by the Garmin account owner. Start with one pair. Use stable Auth0 subject IDs and keep email addresses out of authorization decisions. Any test user with a valid tenant login must remain outside the allowlist. [Auth0 Disable Sign Ups](https://support.auth0.com/center/s/article/Disable-Signups-at-Connection-Level) · [Claude OAuth requirements](https://claude.com/docs/connectors/building/authentication)

Configure these server-side environment variables for MCP authorization and discovery.

| Variable | Value |
| --- | --- |
| `MCP_RESOURCE_URL` | Canonical HTTPS MCP endpoint ending in `/mcp`, matching the Auth0 API identifier. |
| `AUTH0_ISSUER` | Exact HTTPS issuer from Auth0 discovery, with its trailing slash. |
| `AUTH0_CHATGPT_CLIENT_ID` | Pre-registered ChatGPT application client ID. |
| `AUTH0_CODEX_CLIENT_ID` | Separate pre-registered Codex CLI application client ID. |
| `AUTH0_CLAUDE_CLIENT_ID` | Pre-registered Claude application client ID. |
| `AUTH0_CLAUDE_CODE_CLIENT_ID` | Separate pre-registered Claude Code application client ID. |
| `AUTH0_OPENCODE_CLIENT_ID` | Separate pre-registered OpenCode V2 application client ID. |
| `AUTH0_OWNER_SUBJECT` | Stable Auth0 `sub` of the owner under the configured issuer. |
| `MCP_TRUSTED_ORIGINS` | Optional comma-separated HTTPS origins, using scheme and host with an optional port. An empty value permits only origin-less requests. |

Set at least one MCP client ID. Unset or empty values disable that client. Configured IDs must be distinct from each other and from `AUTH0_BROWSER_CLIENT_ID`.

## Authorization on every MCP request

Authenticate before handing the request to the SDK, including for `initialize`, `tools/list`, `tools/call`, and HTTP method handling. Use the standard Auth0 access-token profile and require all of the following.

- A bearer JWT signed with RS256 using the pinned tenant's JWKS, exact issuer, canonical MCP URL in `aud`, required unexpired `exp`, and a valid `nbf` if present.
- An `azp` claim matching a configured MCP client ID. Interpret it as the OAuth authorized party. Accept user delegation only and exclude machine-to-machine grants, tokens for the browser client, and OIDC ID tokens.
- The exact `garmin:read` token in the space-delimited `scope` claim, plus the issuer and `sub` pair in the owner allowlist.

Respond with 401 and a Bearer discovery challenge for missing or invalid authentication. Return 403 with an `insufficient_scope` challenge for a valid token missing the scope, and a generic 403 for a disallowed client or subject. Validate any supplied HTTP `Origin` against the configured trusted origins, and accept origin-less requests from the supported non-browser transports. Keep Garmin credentials entirely server-side. [Auth0 audience and authorized party](https://support.auth0.com/center/s/article/value-of-the-audience-attribute-in-access-token-requests-and-its-significance) · [MCP transport security](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

## Browser ZIP access

The download tool returns a same-origin URL such as `/downloads/activity?ticket=<opaque-ticket>`. The ticket is authenticated and encrypted with a dedicated server secret and contains the exact activity ID, permitted issuer and subject, purpose, and expiry. Give it a ten-minute lifetime. Treat it as replayable during that window by the same authenticated owner. A browser without a session goes through Auth0 Universal Login with state, nonce and PKCE. Keep the pending ticket in an encrypted, short-lived, host-only transaction cookie through the redirect and use a fixed same-origin return route. Keep the ticket out of Auth0 redirect parameters. Verify the OIDC callback and use a short-lived, encrypted, host-only session cookie with `Secure`, `HttpOnly`, and `SameSite=Lax`. Recheck the session subject against the allowlist, verify the ticket and bind it to that subject before fetching Garmin. An expired link requires a fresh tool call.

Register a separate Auth0 Regular Web Application with `client_secret_post`, authorization code with PKCE, and the exact HTTPS callback `https://<canonical-host>/downloads/activity/callback`. Use the same issuer configured for MCP and enable the owner connection for this application. The browser requests the `openid` scope and uses a 15-minute session, bounded by the ID token's expiry. [Auth0 PKCE for web applications](https://auth0.com/blog/pkce-in-web-applications-with-spring-security/)

| Variable | Value |
| --- | --- |
| `AUTH0_BROWSER_CLIENT_ID` | Client ID of the confidential browser application. |
| `AUTH0_BROWSER_CLIENT_SECRET` | Client secret of that application. |
| `DOWNLOAD_TICKET_KEY` | 32 random bytes encoded as unpadded base64url for download tickets. |
| `DOWNLOAD_COOKIE_KEY` | A separate 32 random bytes encoded as unpadded base64url for browser cookies. |

Set the secret and both keys directly in Vercel's sensitive environment settings. Verify the browser flow with a fixture ticket before using any Garmin archive.

Send the ZIP as an attachment with a server-chosen generic filename, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. Apply no-store and no-referrer to the login and download flow too. Keep the MCP bearer token out of browser URLs and cookies.

## Data handling and authorization tests

Use allowlisted operational fields such as route template, coarse status or error code, duration, and a generated request ID. Omit raw URLs and query strings, request and response bodies, headers, cookies, credentials, subject identifiers, Garmin records, tool inputs, and tool results. Check Vercel logging, log drains, and error reporting for automatic collection before using real data. Treat tool results as disclosure to the selected client and keep raw Garmin archives in the browser download flow.

Test missing, expired, invalid-signature, wrong-issuer and wrong-audience tokens. For each, verify that `tools/list` and `tools/call` fail before Garmin access. Repeat with a valid token for an unapproved subject, a token from a third client, and a token missing the read scope. Verify that sign-ups are disabled and an allowlisted owner can use either approved client. For downloads, use a real valid ticket with no session, an expired session and an unapproved subject. Also test an expired, tampered or mismatched ticket with an owner session and an MCP bearer without a browser session. Assert zero upstream ZIP requests in every denied case. Verify that a current owner session and matching ticket stream the original bytes. Inspect emitted logs during these tests for prohibited fields.
