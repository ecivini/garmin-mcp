---
name: garmin-mcp
description: Use Garmin Personal MCP to answer questions about the owner’s Garmin Connect activities, workouts, FIT laps, and health or wellness trends, or to provide an original activity ZIP download link.
---

# Garmin Personal MCP

Use the authenticated Garmin MCP tools exposed by the current client. Tool names may carry a client-specific prefix. Follow the live input schemas and request only the data needed. If the tools are unavailable or the client needs authorization, ask the user to connect or reconnect Garmin in the client and sign in as the owner. Keep credentials out of the conversation. `list_activity_types` takes `{}` and can verify a connection or supply Garmin activity type keys for a search.

## Dates, results, and errors

- Resolve relative periods in the user’s time zone. Use `get_profile_settings` if the zone matters and is unknown. Pass explicit `YYYY-MM-DD` dates without converting them to UTC. Count both endpoints when splitting a range into consecutive windows. Most wellness range tools allow 31 days, while steps and stress allow 28. Check the selected tool’s limit and date field names.
- Pass `activityId` and other Garmin IDs as decimal strings. Read the result’s `units` and preserve its local and UTC timestamp labels. Most tools return `{data, units}` and some put the records in a named collection inside `data`. An empty list, null, or omitted field means there is no corresponding reading to report. Preserve recorded zeroes and give the dates and coverage behind comparisons. Describe patterns without inferring causes or diagnoses.
- Correct the arguments for `invalid_input`. On `payload_too_large`, use a shorter range or page when the tool supports it. Respect `retryAfterSeconds` on `rate_limited` and avoid repeated retries. If authentication or an upstream error prevents a read, explain which data is unavailable and label any remaining results as partial.

## Compare two weeks

For the last seven complete local days and the seven before them, fetch `get_sleep_range` and `get_wellness_range` with `startDate` and `endDate`, and `get_hrv_range` with `fromDate` and `toDate`. Align readings on their reported dates. Use sleep duration, wellness resting heart rate and steps, and overnight HRV (`lastNightAvg`). Average available readings and show coverage for each period, such as six of seven nights. Use `search_activities` with the same date bounds for training. Follow `nextStart` as `start` until it is null, then sum recorded timer duration for the activities in each period. If a page fails or any duration is missing, label the total as partial. Report the two date ranges, units, and data gaps.

## Inspect or download an activity

- If the user gives a name or date, find the activity with `search_activities`. Use `get_activity` for its summary and splits or `get_activity_workouts` for structured workout steps. If multiple matches remain plausible, ask which activity they mean.
- For original FIT session and lap metrics, call `analyze_activity_fit` with the selected `activityId`. For the first ten laps, set `lapLimit` to 10. For more laps, pass each returned `nextLapOffset` as `lapOffset` until you have the requested laps or it is null. Sessions are returned with each page. Preserve sport-specific units when comparing pace, cadence, heart rate, or power, and report which metrics were recorded.
- When the user requests the original ZIP, call `download_activity` with the selected `activityId`. Give the requesting user the returned link and its expiry. The user opens it in a browser and signs in as the owner if prompted. Keep the link out of shared notes and logs. Request a fresh link if the user needs to replace an expired one.
