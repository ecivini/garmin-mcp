import { afterEach, expect, it, vi } from "vitest";
import { fixtureUpstream, invoke } from "./tool-test-fixtures";
import { getWeightEntries, getWeightGoals, getWeightRange } from "./weight-tools";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const range = { startDate: "2024-02-29", endDate: "2024-03-30" };

it("projects goal records and preserves the inclusive dates and empty collections", async () => {
  const upstream = fixtureUpstream(Response.json({
    userGoals: [{ goalValue: 70_000, startDate: { localDate: "2024-02-29", date: "2024-02-28T23:00:00Z" }, userProfileId: 1 }],
    userGoalRanges: [{ lowWeightGoalInGrams: 68_000, highWeightGoalInGrams: 73_000, weekNum: 4, ownerId: 1 }],
  }), Response.json({ userGoals: [], userGoalRanges: [] }));
  const result = await invoke(getWeightGoals, range);
  expect(result.structuredContent).toMatchObject({
    data: {
      userGoals: [{ goalValue: 70_000, startDate: { localDate: "2024-02-29", date: "2024-02-28T23:00:00Z" } }],
      userGoalRanges: [{ lowWeightGoalInGrams: 68_000, highWeightGoalInGrams: 73_000, weekNum: 4 }],
    },
    units: { goalValue: "g", lowWeightGoalInGrams: "g" },
  });
  expect(JSON.stringify(result)).not.toMatch(/userProfileId|ownerId/);
  await expect(invoke(getWeightGoals, range)).resolves.toMatchObject({ structuredContent: { data: { userGoals: [], userGoalRanges: [] } } });
  expect(upstream.paths()).toEqual(Array(2).fill("/goal-service/goal/user/effective/weightgoal/2024-02-29/2024-03-30"));
});

it("preserves distinct same-day readings, local and UTC timestamps, and zero composition metrics", async () => {
  const upstream = fixtureUpstream(Response.json([
    { calendarDate: "2024-02-29", weight: 71.1, bodyFat: 0, date: 1_709_164_800_000, timestampGMT: 1_709_186_400_000, deviceId: 3 },
    { calendarDate: "2024-02-29", weight: 71, bodyFat: null, timestampGMT: 1_709_190_000_000 },
  ]), Response.json([]));
  const result = await invoke(getWeightEntries, { startDate: range.startDate, endDate: range.startDate });
  expect(result.structuredContent).toMatchObject({
    data: [
      { calendarDate: "2024-02-29", weight: 71.1, bodyFat: 0, date: 1_709_164_800_000, timestampGMT: 1_709_186_400_000 },
      { calendarDate: "2024-02-29", weight: 71, bodyFat: null, timestampGMT: 1_709_190_000_000 },
    ],
    units: { weight: "kg", date: "ms", timestampGMT: "ms" },
  });
  expect(JSON.stringify(result)).not.toContain("deviceId");
  await expect(invoke(getWeightEntries, range)).resolves.toMatchObject({ structuredContent: { data: [] } });
  expect(upstream.paths()).toEqual(["/weight-service/weight/all/2024-02-29/2024-02-29", "/weight-service/weight/all/2024-02-29/2024-03-30"]);
});

it("shares only explicitly requested daily readings and preserves optional adjacent context", async () => {
  const fixture = {
    dailyWeightSummaries: [{
      summaryDate: "2024-02-29", numOfWeightEntries: 2,
      latestWeight: { weight: 71.5 }, allWeightMetrics: [{ weight: 71.6, deviceName: "fixture-private" }, { weight: 71.5 }],
    }],
    totalAverage: { weight: 71.5, bodyWater: 55.5 },
    previousDateWeight: { calendarDate: "2024-02-28", weight: 72, userProfileId: 12 },
    nextDateWeight: null,
  };
  const upstream = fixtureUpstream(Response.json(fixture), Response.json(fixture), Response.json({ dailyWeightSummaries: [] }));
  const latest = await invoke(getWeightRange, range);
  expect(latest.structuredContent).toMatchObject({
    data: { dailyWeightSummaries: [{ latestWeight: { weight: 71.5 } }], totalAverage: { weight: 71.5, bodyWater: 55.5 },
      previousDateWeight: { calendarDate: "2024-02-28", weight: 72 }, nextDateWeight: null },
  });
  expect(JSON.stringify(latest)).not.toMatch(/allWeightMetrics|userProfileId/);
  const all = await invoke(getWeightRange, { ...range, includeAll: true });
  expect(all.structuredContent).toMatchObject({ data: { dailyWeightSummaries: [{ allWeightMetrics: [{ weight: 71.6 }, { weight: 71.5 }] }] } });
  expect(JSON.stringify(all)).not.toContain("fixture-private");
  await expect(invoke(getWeightRange, range)).resolves.toMatchObject({ structuredContent: { data: { dailyWeightSummaries: [] } } });
  expect(upstream.paths()).toEqual([
    "/weight-service/weight/range/2024-02-29/2024-03-30?includeAll=false",
    "/weight-service/weight/range/2024-02-29/2024-03-30?includeAll=true",
    "/weight-service/weight/range/2024-02-29/2024-03-30?includeAll=false",
  ]);
});

it("rejects invalid weight date intervals before contacting Garmin", async () => {
  const upstream = fixtureUpstream();
  for (const [tool, input] of [
    [getWeightGoals, { ...range, endDate: "2024-03-31" }],
    [getWeightEntries, { ...range, startDate: "2024-03-31" }],
    [getWeightRange, { startDate: "2025-02-29", endDate: "2025-03-01" }],
    [getWeightRange, { ...range, includeAll: "true" }],
  ] as const) {
    await expect(invoke(tool, input)).resolves.toMatchObject({ isError: true, structuredContent: { code: "invalid_input" } });
  }
  expect(upstream.paths()).toEqual([]);
});
