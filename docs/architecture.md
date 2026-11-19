# Garmin Personal MCP architecture

## Deployment and request flow

Run a TypeScript Next.js App Router app on Vercel Hobby using the Node.js runtime. The official TypeScript MCP SDK serves stateless Streamable HTTP on one canonical HTTPS URL, such as `https://garmin.example.com/mcp`. ChatGPT custom MCP and Codex CLI share that URL. Pin the SDK version during implementation and test protocol negotiation with both clients. The transport uses request-local state, with no session IDs, server-initiated events, or event replay. Support Streamable HTTP POST responses and return 405 for a standalone GET event stream or DELETE after applying the endpoint's authorization checks. [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) · [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) · [Vercel Hobby](https://vercel.com/docs/plans/hobby)

1. The MCP route verifies the Auth0 bearer token before dispatch, including before initialization and tool discovery. The tool handler validates arguments against its schema and maps them to a fixed Garmin operation. See [Security](security.md) and the [Tool catalog](tool-catalog.md).
2. The Garmin client obtains an upstream token and fetches data on demand from `https://personal.connectapi.garmin.com`. It applies the request deadline and byte limits, then validates the response and returns the catalog's bounded result.
3. The download tool issues a short-lived browser link. A separate Next.js route checks the browser session before it opens the Garmin ZIP stream. FIT analysis uses that same Garmin GET in a separate MCP tool, checks the archive and FIT file, and returns structured summaries.

One Garmin key covers the owner's account. Keep records, ZIP bytes, and decoded messages in memory for the active request. Disable Next.js fetch caching and response caching for private routes. The deployment needs no database, object storage, or scheduled import. Each Vercel instance can serve a request independently.

## Garmin credentials and failure handling

- Store `GARMIN_PERSONAL_API_KEY` as a sensitive production environment variable, accessible only to server code. POST to `/personalapitoken-service/personal-api/personal-api-key/token` with `Authorization: ApiKey <key>`. Use the returned access token as a bearer credential on Garmin GETs. Garmin documents a token lifetime of 24 hours or until the Personal API key expires, whichever comes first. Obtain a new access token by repeating the exchange. [Garmin Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq)
- Reuse a token in process memory until shortly before expiry. Coalesce concurrent exchanges per instance and clear the pending exchange on completion or failure. Treat cold starts and separate instances as independent. On a read's first Garmin 401, invalidate only the rejected token, obtain or reuse its replacement, and retry once within the original deadline. A credential rejection during exchange or a second read 401 maps to `garmin_auth_failed`. A read 403 maps to `garmin_forbidden`. Apply the same timeout, throttling and transient failure rules to the exchange and to reads.
- On Garmin 429, surface `rate_limited` with a valid upstream `Retry-After` translated to seconds when available. Keep a short instance-local cooldown bounded by the upstream delay when present, with a five-second default if absent. Surface repeated throttling to the caller and avoid automatic 429 retries or multi-page fan-out. There is no cross-instance quota coordination. Confirm any account-specific quota during release verification.
- Track the Personal API key expiry outside the app. Create a replacement before expiry, update the production secret, redeploy, and verify a fresh exchange and read on the canonical URL. Revoke the old key after verification where Garmin allows overlap. If key creation invalidates the previous key, schedule the cutover and verify it immediately. For a suspected leak, revoke the key promptly and confirm whether already-minted tokens still work.
- Use initial application budgets of 15 seconds for JSON reads, 30 seconds for FIT analysis, and 60 seconds for ZIP delivery, measured end to end. Set the deployed function duration above these budgets and verify the client and Vercel ceilings during release. Give each upstream attempt at most five seconds to receive headers and apply an idle-read timeout of 10 seconds. Abort the upstream request when the deadline expires, the size cap is crossed, or the caller disconnects. Run FIT decoding in a worker that can be terminated at the deadline.

## Response and ZIP limits

Cap MCP requests at 64 KiB, upstream JSON bodies at 2 MiB, and each serialized MCP tool response at 128 KiB. Reject an oversized result with `payload_too_large` and suggest a smaller page or date range when the endpoint supports one. These are application limits for the first release. [Vercel Functions limits](https://vercel.com/docs/functions/limitations)

For browser downloads, stream the original ZIP bytes with backpressure and an attachment disposition. Confirm the upstream response is a ZIP before sending headers, using a small prefix buffer if necessary. Apply a 100 MiB delivery cap, checking the advertised length when available and counting bytes as they pass through. Once the response starts, abort a failed, oversized, or interrupted stream so the browser sees an incomplete transfer. A new browser request fetches the file again. FIT analysis has independent archive and decoder limits in the catalog. [Vercel streaming guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)

## Future verification

| Case | Expected result |
| --- | --- |
| Invalid IDs, dates, reversed or excessive ranges, bad filters | Local validation fails before contacting Garmin |
| Empty list, missing optional metrics, HRV 204 | Successful empty or partial-data result with the documented shape |
| Garmin 429 with and without `Retry-After` | Sanitized retry guidance and no automatic replay |
| Expired Auth0 token, expired Garmin token, expired Garmin key | MCP rejects the Auth0 token. Garmin 401 triggers at most one renewal and retry. Expired keys surface a sanitized configuration error |
| Cold starts, concurrent exchange, secret rotation | Independent instances work. One exchange runs per warm instance at a time. The replacement deployment uses only its configured key |
| Oversized request, JSON result, stream or decompressed archive | Limits hold with and without a declared content length. Aborted streams and decoders release resources |
| Corrupt ZIP, corrupt FIT, unsupported format and valid multisport FIT | Stable catalog errors or bounded session and lap results with missing measurements preserved |
| Missing scope, wrong issuer or audience, unapproved client and unapproved subject | No tool discovery, invocation or upstream Garmin call. Browser authorization is tested separately |

## Vercel release check

1. Review the terms presented during Garmin Personal API key creation before testing with real account data. Specifically confirm the planned hosting and disclosure to ChatGPT and Codex. If the terms do not permit the use, keep verification on fixtures.
2. Deploy to Vercel Hobby at the canonical HTTPS hostname. Check protected-resource discovery and both OAuth registrations with the actual Auth0 Free tenant. Exercise the negative authorization cases in [Security](security.md) before supplying real records to either client.
3. In a regular ChatGPT conversation using the custom MCP connection, sign in as the owner, discover tools, run a Garmin read, run FIT analysis on a known activity, and open the ZIP link in a browser. Repeat from Codex CLI using its separately registered client. Check that a browser without a session receives a login prompt and an unapproved identity receives no ZIP.
4. Compare the downloaded ZIP's byte count and SHA-256 with an authorized direct Garmin download of the same unchanged activity. Test streaming with a fixture over Vercel's documented buffered response limit. Compare FIT metrics with a known fixture and record pass/fail, deployed versions, and timing without recording account data or credentials. [ChatGPT custom MCP](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) · [Codex MCP setup](https://learn.chatgpt.com/docs/extend/mcp)
