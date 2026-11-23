# Set up Garmin Personal MCP

This guide connects a single Garmin account to Claude, Claude Code, ChatGPT, Codex CLI, or Gemini through an Auth0-protected Next.js deployment on Vercel. You need a Vercel project for this repository, an Auth0 tenant, and at least one supported MCP client. For hosted Claude, your account or workspace must allow custom connectors. For ChatGPT, your workspace must allow custom MCP servers with your own OAuth client credentials. Use Node.js 22.12 or later in the 22.x series for local checks.

Replace `garmin.example.com` with your stable Vercel production hostname and `YOUR_AUTH0_DOMAIN` with your Auth0 tenant domain wherever they appear.

## 1. Choose the hostname and register the API

1. In Vercel, import the repository as a Next.js project and choose the production hostname. The MCP URL in this guide is `https://garmin.example.com/mcp`.
2. In Auth0, go to **Applications → APIs → Create API**. Name it **Garmin MCP** and set the **Identifier** to the exact MCP URL, including `/mcp` and without a trailing slash. Select **RS256** and use the **Auth0** access-token profile, which supplies the `azp` claim. Under **Permissions**, add `garmin:read`. [Auth0 token profiles](https://auth0.com/blog/jwt-access-tokens-profiles-now-in-ga/)
3. In Auth0 tenant **Settings → Advanced → Settings**, enable **Resource Parameter Compatibility Profile**. This lets Auth0 use the OAuth `resource` parameter to select the API. [Auth0 resource compatibility](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0)

## 2. Set up the owner and Auth0 applications

1. Under **Authentication → Database**, choose the connection for the owner's account and enable **Disable Sign Ups**. Create the owner in **User Management → Users** if needed. Open the user profile and copy the full **User ID**, including its prefix, for `AUTH0_OWNER_SUBJECT`. Use this same account for every sign-in. [Auth0 database connections](https://dev.auth0.com/docs/connections/database)
2. Under **Applications → Applications → Create Application**, register the MCP clients you plan to use and the separate browser app for ZIP downloads. Use the same tenant for each registration.

   | Application | Type and OAuth settings | Allowed Callback URLs |
   | --- | --- | --- |
   | **Garmin Codex CLI** | **Native**, Authorization Code with PKCE, token endpoint authentication **None**. | Copy the exact callback from Codex in step 4. |
   | **Garmin ChatGPT** | **Regular Web Application** if ChatGPT asks for a Client ID and secret. If ChatGPT explicitly offers authentication **None**, use **Native**. Match the token endpoint authentication method on both sides. | Copy the exact redirect URI from ChatGPT in step 5. |
   | **Garmin Claude** | **Native**, Authorization Code with S256 PKCE, token endpoint authentication **None**. | `https://claude.ai/api/mcp/auth_callback` |
   | **Garmin Claude Code** | **Native**, Authorization Code with S256 PKCE, token endpoint authentication **None**. | `http://localhost:36878/callback` |
   | **Garmin Gemini** | **Regular Web Application**, Authorization Code with S256 PKCE, token endpoint authentication `client_secret_post`. | Copy the exact Google HTTPS redirect URI observed in step 7. |
   | **Garmin Browser Downloads** | **Regular Web Application**, Authorization Code with PKCE, token endpoint authentication `client_secret_post`. | `https://garmin.example.com/downloads/activity/callback` |

3. Open each application's **Connections** tab and enable only the database connection that contains the owner. You can also enable the app from **Authentication → Database → your connection → Applications**. [Auth0 connection settings](https://support.auth0.com/center/s/article/Error-Connection-must-be-enabled-for-this-client-to-perform-single-user-creation-and-signup-operations)
4. Under **Applications → APIs → Garmin MCP → Settings → Application Access Policy**, set **User-Delegated Access** to **Per-app authorization**. In the API's **Application Access** tab, grant each MCP app **User-Delegated Access** to `garmin:read`. The browser app uses the `openid` scope for sign-in. [Auth0 application access policies](https://auth0.com/blog/developers-guide-api-access-policies-auth0/#setting-policies-and-grants-with-the-auth0-dashboard)

## 3. Set the Vercel variables and deploy

1. Open `https://YOUR_AUTH0_DOMAIN/.well-known/openid-configuration`. Copy the JSON `issuer` exactly, including its trailing slash.
2. Run this command locally to generate two independent 32-byte keys. Copy only the value after `=` for each variable.

   ```sh
   node -e 'const { randomBytes } = require("node:crypto"); for (const name of ["DOWNLOAD_TICKET_KEY", "DOWNLOAD_COOKIE_KEY"]) console.log(`${name}=${randomBytes(32).toString("base64url")}`)'
   ```

3. In the Vercel project, add the following under **Settings → Environment Variables** for **Production**. Set at least one MCP client ID and give each configured app a distinct ID. Leave unused MCP client IDs unset or empty. Mark the browser client secret, both encryption keys, and the Garmin key as **Sensitive**. Enter any ChatGPT client secret directly in ChatGPT's connection form.

   | Variable | Value |
   | --- | --- |
   | `MCP_RESOURCE_URL` | `https://garmin.example.com/mcp`, the same URL used as the Auth0 API Identifier. |
   | `AUTH0_ISSUER` | Exact Auth0 `issuer` from discovery. |
   | `AUTH0_OWNER_SUBJECT` | Full Auth0 User ID of the owner. |
   | `AUTH0_CODEX_CLIENT_ID` | Client ID of **Garmin Codex CLI**. |
   | `AUTH0_CHATGPT_CLIENT_ID` | Client ID of **Garmin ChatGPT**. |
   | `AUTH0_CLAUDE_CLIENT_ID` | Client ID of **Garmin Claude**. |
   | `AUTH0_CLAUDE_CODE_CLIENT_ID` | Client ID of **Garmin Claude Code**. |
   | `AUTH0_GEMINI_CLIENT_ID` | Optional client ID of **Garmin Gemini**. |
   | `AUTH0_BROWSER_CLIENT_ID` | Client ID of **Garmin Browser Downloads**. |
   | `AUTH0_BROWSER_CLIENT_SECRET` | Client secret of **Garmin Browser Downloads**. |
   | `DOWNLOAD_TICKET_KEY` | Unpadded base64url key generated for tickets. |
   | `DOWNLOAD_COOKIE_KEY` | The separate unpadded base64url key generated for cookies. |
   | `GARMIN_PERSONAL_API_KEY` | Add when you are ready for live Garmin reads in step 8. |
   | `MCP_TRUSTED_ORIGINS` | Optional comma-separated list of exact HTTPS origins. Leave empty for clients that send no `Origin` header. |

4. Deploy the branch or commit that contains the full catalog to the production hostname. Vercel applies updated environment variables on a new deployment. If a push creates a Preview at another hostname, the existing MCP connections still reach the production URL. [Vercel environment variables](https://vercel.com/docs/environment-variables)
5. Check the deployment:

   ```sh
   curl -fsS https://garmin.example.com/healthz
   curl -fsS https://garmin.example.com/.well-known/oauth-protected-resource/mcp
   ```

   The first command should return `{"status":"ok"}`. The second should list the MCP URL as `resource`, the exact Auth0 issuer in `authorization_servers`, and `garmin:read` in `scopes_supported`. A request to `/mcp` without a bearer token should receive HTTP 401 with a Bearer discovery challenge.

## 4. Connect Codex CLI

1. Add the server using the **Garmin Codex CLI** Client ID.

   ```sh
   codex mcp add garmin \
     --url 'https://garmin.example.com/mcp' \
     --oauth-client-id 'YOUR_CODEX_CLIENT_ID'
   ```

2. Copy the callback URL Codex displays into **Garmin Codex CLI → Settings → Allowed Callback URLs** in Auth0 and save. If Codex displays only the authorization URL, use its decoded `redirect_uri` value. Match the scheme, host, path, callback suffix if any, and port used by the login attempt.
3. If the loopback port changes on each attempt, add these entries to the existing `[mcp_servers.garmin.oauth]` table in `~/.codex/config.toml`, keeping its `client_id`. Use the same port in the URL and listener, then register the exact resulting URL in Auth0. Preserve any callback suffix Codex requires.

   ```toml
   callback_url = "http://127.0.0.1:36877/callback"
   callback_port = 36877
   ```

4. Run `codex mcp login garmin --scopes garmin:read` and sign in as the owner. Open a fresh `codex` session and use `/mcp` to verify that `garmin` lists the 29 tools in the [tool catalog](tool-catalog.md). [Codex MCP and callback settings](https://learn.chatgpt.com/docs/extend/mcp#oauth-client-registration-and-callbacks)

## 5. Connect ChatGPT

1. In ChatGPT on the web, go to **Plugins → + → Add custom MCP server** and enter `https://garmin.example.com/mcp`. Choose OAuth and **Use your own OAuth client credentials**. Enter the **Garmin ChatGPT** Client ID and its secret if the chosen method requires one. Leave the registration URL empty for a predefined client. [ChatGPT custom MCP connections](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
2. If ChatGPT asks for manual OAuth settings, copy the endpoints from your tenant's discovery response. For a standard Auth0 tenant they are:

   | Field | Value |
   | --- | --- |
   | Authorization URL | `https://YOUR_AUTH0_DOMAIN/authorize` |
   | Token URL | `https://YOUR_AUTH0_DOMAIN/oauth/token` |
   | Discovery URL, if requested | `https://YOUR_AUTH0_DOMAIN/.well-known/oauth-authorization-server` |
   | Scope, if requested | `garmin:read` |

3. Copy the redirect URI shown by ChatGPT into **Garmin ChatGPT → Settings → Allowed Callback URLs** in Auth0 and save. Complete the connection and sign in as the owner. Open a new conversation, select the plugin, and confirm that the connection lists all 29 tools. After future tool changes, open the connection, select **Refresh**, and start a new conversation. [ChatGPT OAuth callbacks](https://developers.openai.com/plugins/build/auth#redirect-url) · [Refreshing tools](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata)

## 6. Connect Claude and Claude Code

### Claude custom connector

1. Make `https://garmin.example.com/mcp` reachable from Anthropic over public HTTPS on port 443. If you restrict inbound traffic, consult Anthropic's published egress ranges. [Claude network requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) · [Anthropic egress addresses](https://claude.com/docs/connectors/building/authentication#network-reference)
2. In Claude, open **Customize → Connectors → Add custom connector**. Enter `Garmin` and `https://garmin.example.com/mcp`. Under **Authentication**, choose **Sign in now**. Under **OAuth client**, choose **Use your own OAuth client**, enter the **Garmin Claude** Client ID, and leave the secret blank. For a Team or Enterprise workspace, follow the organization setup in Anthropic's guide. [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) · [Claude OAuth client options](https://claude.com/docs/connectors/building/authentication#custom-connectors)
3. Complete the Auth0 sign-in as the owner. Enable the Garmin connector in a conversation.

### Direct connection in Claude Code

1. Use a current Claude Code release. Verify that the **Garmin Claude Code** Auth0 app allows `http://localhost:36878/callback` as registered in step 2, then run this command in your shell. If port `36878` is in use, select a free port and use it in both the callback URL and the command. [Claude Code OAuth setup](https://code.claude.com/docs/en/mcp#use-pre-configured-oauth-credentials)

   ```sh
   claude mcp add --transport http --scope user \
     --client-id 'YOUR_CLAUDE_CODE_CLIENT_ID' --callback-port 36878 \
     garmin 'https://garmin.example.com/mcp'
   ```

2. Start `claude`, open `/mcp`, select `garmin`, and follow the browser flow to sign in as the owner. [Claude Code remote MCP](https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers)

If you use a Claude subscription login in Claude Code, the custom connector you already connected on Claude can appear in `/mcp` without a direct registration. Use the direct setup for independent OAuth or when your Claude Code authentication method does not load Claude connectors. A direct entry for the same URL takes precedence. [Claude connector reuse](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claudeai)

## 7. Connect Gemini on web and mobile

Google currently offers custom apps in English to adults in the US who use a personal Google Account with History enabled. [Google's custom app eligibility and setup](https://support.google.com/gemini/answer/17209137?hl=en-45)

1. In Auth0, use the dedicated **Garmin Gemini** app from step 2, enable the owner's connection, and grant **User-Delegated Access** to `garmin:read` for the **Garmin MCP** API. Set `AUTH0_GEMINI_CLIENT_ID` on the deployment. The MCP server only needs the client ID. [Google's OAuth guide](https://developers.google.com/connected-apps/mcp/oauth) · [Auth0 PKCE guidance](https://support.auth0.com/center/s/article/combining-pkce-and-a-client-secret-for-auth0-applications)
2. In Gemini web, open **Settings → Connected Apps** and choose **Add a custom app**. If needed, look under **Personal Intelligence → Connected Apps**. Enter `https://garmin.example.com/mcp`. Under **Advanced features → Show more**, enter the **Garmin Gemini** client ID and secret, then start linking. [Google's custom app setup](https://support.google.com/gemini/answer/17209137?hl=en-45#connect_a_custom_app)
3. From the Auth0 authorization request, copy the decoded `redirect_uri` into **Garmin Gemini → Settings → Allowed Callback URLs**. Register the exact Google HTTPS URL, including its full path. Save it, retry linking if needed, and complete Auth0 sign-in as the owner. [Google's OAuth redirect guidance](https://developers.google.com/connected-apps/mcp/oauth#authorization_code_flow_simplified_version)
4. After linking, select the app with `@` in Gemini web or in the mobile app signed in to the same Google Account. [Google's custom app setup](https://support.google.com/gemini/answer/17209137?hl=en-45#connect_a_custom_app)
5. If the access token expires and Gemini asks you to reconnect, return to **Connected Apps** in Gemini web and re-link the app as the owner. [Google's account linking guide](https://developers.google.com/connected-apps/mcp/oauth)

## 8. Enable live Garmin reads and verify a download

1. Verify the hosted browser flow with a synthetic ZIP before enabling live reads. Use the fixture deployment described in the [release checklist](release-checks.md#deployment-checks). On the full deployment, discovery and issuing a download link can work before the Garmin key is set. Live reads and ZIP delivery need the key.
2. Review the terms shown during Personal API key creation and the FIT SDK license for your intended hosting and use. Generate a Personal API key in Garmin Connect, add it to Vercel as `GARMIN_PERSONAL_API_KEY`, and redeploy. Keep the key in Vercel's server-side settings. [Garmin Personal API key setup](https://developer.garmin.com/gc-developer-program/personal/personal-faq) · [FIT SDK license](https://github.com/garmin/fit-javascript-sdk/blob/main/LICENSE.txt)
3. In each client, ask it to call `list_activity_types` and show the result.
4. Choose a known activity and call `download_activity` with its decimal activity ID as a string. Open the link within ten minutes. If your browser has no current session, sign in to Auth0 as the owner. The browser should save `activity.zip`. Compare its byte count and SHA-256 with a direct Garmin download of the same activity. Call `analyze_activity_fit` for the same ID to verify the FIT summary. [Browser download security](security.md#browser-zip-access)

## Troubleshooting

| Symptom | Check |
| --- | --- |
| **Callback URL mismatch** | Compare the current request's decoded `redirect_uri` with the **Allowed Callback URLs** on that client's Auth0 app. For a CLI, match the hostname, port, and path used by that version. |
| **Client is not authorized to access resource server** or **insufficient scope** | Check that the failing app has **User-Delegated Access** to `garmin:read`, and that the API Identifier exactly matches the MCP URL. In Codex, retry with `--scopes garmin:read`. |
| **A client cannot discover OAuth** | Check the 401 challenge and protected-resource JSON in step 3. For hosted Claude, verify that both the MCP endpoint and Auth0 discovery are reachable from Anthropic. In ChatGPT, select the predefined client option and enter the tenant's authorization and token URLs manually if prompted. |
| **Auth0 login succeeds but the connection still fails** | Check **Auth0 → Monitoring → Logs** for a failed code exchange. Verify the Client ID, secret, and token endpoint authentication method for that app. If the exchange succeeded, check the next `POST /mcp` status in Vercel and confirm the production Client ID and owner User ID. |
| **Browser download link expired** | Call `download_activity` again for a new ten-minute link. |
