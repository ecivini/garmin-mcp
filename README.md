# Garmin Personal MCP

Make sense of your Garmin Connect data in Claude, Claude Code, ChatGPT, Codex CLI, or OpenCode V2. Ask for a weekly view of your health and training, explore a specific activity, or turn your observations into Markdown notes for your second brain.

Garmin Personal MCP is a read-only [Model Context Protocol](https://modelcontextprotocol.io/) server for one Garmin account. It uses Garmin's official Personal API to fetch data on demand. The 29 tools cover activities and workouts, sleep, heart rate and HRV, stress, Body Battery, steps, SpO₂, hydration, nutrition, weight, and menstrual-cycle tracking. The catalog also includes FIT activity summaries and original ZIP downloads. [Tool catalog](docs/tool-catalog.md)

Garmin Personal MCP is an independent project with no affiliation to Garmin.

Garmin® is a registered trademark of Garmin Ltd. or its subsidiaries. Garmin Connect™ is a trademark of Garmin Ltd. or its subsidiaries.

> **Personal, noncommercial use only.** Garmin's Personal API key is for the account holder's own use. Sharing the key or using it to offer this server as a service to other users would violate the Personal API Supplemental Terms. Garmin provides separate Business API options for commercial integrations. [Garmin Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq) · [Personal API terms](https://connect.garmin.com/app/settings/personalApiToken)

## Self-host or deploy on free tiers

- **Managed hosting.** Run the server on Vercel Hobby and use Auth0 Free for sign-in. This setup can run without a hosting or authentication subscription for personal, noncommercial use within the plans' limits. [Vercel Hobby](https://vercel.com/docs/plans/hobby) · [Auth0 Free](https://auth0.com/pricing)
- **Self-hosting.** Run the same Next.js app on a machine you manage. Configure the server environment, build with `npm run build`, and start it with `npm start`. Use a stable HTTPS hostname reachable by your clients and configure the reverse proxy to pass through streamed responses. The app uses Auth0 for sign-in in this setup too. [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)

## Review your health and training together

A weekly review can bring several signals into one conversation. Look at how sleep duration, resting heart rate, overnight HRV, daily movement, and recorded training changed together. Compare with your own recent baseline and ask the client to show the dates and measurements behind each observation. Use the review for personal reflection, with missing readings and uncertainty visible.

> Compare my last seven complete days with the preceding seven days using my Garmin data. Summarize sleep, resting heart rate, HRV, daily steps, and training duration. Show the date ranges and measurements behind your observations, flag missing readings, and describe any patterns without inferring causes.

For an activity you want to revisit, use its Garmin activity ID to examine the original FIT file through the server.

> Analyze the FIT archive for Garmin activity `1234567890`. Summarize each session and show the first ten laps. Compare pace, heart rate, and cadence where recorded, and flag any metrics the file does not contain.

## Add Garmin context to your second brain

Use the MCP client to draft a weekly note, then save the Markdown in Obsidian, Logseq, or your own notes repository. Keep the date range, units, and source alongside the summary so you can compare notes over time and trace each observation back to the underlying measurements.

> Draft a Markdown note from this Garmin review. Include the dates covered, a short metric table with units, two observations supported by the readings, and any gaps. Leave a section for my own notes on how I felt that week.

A note can follow this structure:

```markdown
# Weekly health review

Period: YYYY-MM-DD to YYYY-MM-DD
Source: Garmin Connect via Garmin Personal MCP

## Measurements

| Metric | This week | Previous week | Coverage |
| --- | --- | --- | --- |
| Average sleep duration | … h | … h | … of 7 nights |
| Training duration | … min | … min | … recorded activities |

## Observations

Summarize the changes and cite the dates or measurements that support them.

## Data gaps and personal notes

Record missing readings and add context such as travel, changes in routine, or how the week felt.
```

## Get started

1. Fork this repository to your GitHub account. Use your fork for the setup and deployment steps below.
2. Choose a stable HTTPS hostname and configure an Auth0 API with one OAuth app per MCP client you want to use. Register a separate app for browser downloads.
3. Set the server environment on Vercel, deploy the Next.js app, and connect your chosen clients to the same HTTPS `/mcp` endpoint.
4. Call `list_activity_types` from each client to check the connection. For ZIP delivery, call `download_activity` and open the short-lived link in your browser.

Follow the [step-by-step setup guide](docs/setup.md) for the exact settings, callbacks, and commands.

## Install the Garmin MCP skill

The [Garmin MCP skill](skills/garmin-mcp/SKILL.md) teaches your agent how to find the right tools, compare readings, and inspect activities. Connect and sign in to Garmin MCP in your client using the [setup guide](docs/setup.md). The Gemini CLI skill install assumes you already have a working MCP connection there.

### Claude marketplace

In Claude Code, run these commands once the marketplace files are available in the GitHub repository:

```sh
claude plugin marketplace add ecivini/garmin-mcp
claude plugin install garmin-mcp@ecivini-garmin
```

From a local checkout, use `claude plugin marketplace add "$PWD"` for the first command. In a new Claude Code session, you can invoke `/garmin-mcp:garmin-mcp`.

In Claude web or Desktop, open **Customize → Plugins → Add → Add marketplace** if available. Choose **Add from a repository**, enter `ecivini/garmin-mcp`, and install **garmin-mcp**. Claude must be able to access the repository. You can also run `zip -r garmin-mcp-skill.zip garmin-mcp` from the checkout’s `skills/` directory and upload the ZIP under **Customize → Skills → Upload a skill**. [Claude marketplace setup](https://support.claude.com/en/articles/13837440-use-plugins-in-claude) · [Claude skill upload](https://support.claude.com/en/articles/12512180-use-skills-in-claude)

### Standalone installation

Install the skill for Codex across all your projects with the [Skills CLI](https://github.com/vercel-labs/skills#install-a-skill):

```sh
npx skills add ecivini/garmin-mcp --skill garmin-mcp --agent codex --global
```

For another CLI, replace `codex` with `claude-code`, `opencode`, or `gemini-cli`. Repeat `--agent` to install for multiple clients. Omit `--global` to install in the current project, as in this example:

```sh
npx skills add ecivini/garmin-mcp --skill garmin-mcp \
  --agent claude-code --agent codex --agent opencode --agent gemini-cli
```

To install from a checkout, run the same command from its root with `./skills/garmin-mcp` in place of `ecivini/garmin-mcp`. For Gemini Apps, open **Customize → Skills → Create → Upload** in Gemini web and select the [SKILL.md file](skills/garmin-mcp/SKILL.md). [Gemini Apps skill upload](https://support.google.com/gemini/answer/17094296?hl=en)

## How your data is handled

Each request is authorized for the configured owner before tools can read Garmin. The server fetches records on demand and keeps no persistent copy. The Garmin key stays server-side. Your chosen MCP client receives the structured tool results you request. Original activity ZIPs are delivered through a separately authenticated browser session. [Security and data handling](docs/security.md)

For implementation details and deployment checks, see [Architecture](docs/architecture.md) and [Release verification](docs/release-checks.md).
