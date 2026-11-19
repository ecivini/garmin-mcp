import { afterEach, expect, it, vi } from "vitest";
import { getActivity, getActivityWorkouts, searchActivities } from "./activity-tools";
import { fixtureUpstream, invoke } from "./tool-test-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("projects the activity details, retaining int64 IDs and timestamp semantics", async () => {
  const upstream = fixtureUpstream(new Response(`{
    "activityId":9223372036854775807,
    "parentId":9223372036854775806,
    "activityName":"fixture",
    "activityTypeDTO":{"typeKey":"running","userId":123},
    "metadataDTO":{"fileFormat":{"formatId":7,"formatKey":"fit","mediaUrl":"fixture secret"},"userInfoDto":{"displayName":"fixture secret"}},
    "summaryDTO":{"startTimeGMT":"2025-02-03T04:05:06.010","startTimeLocal":"2025-02-03T02:05:06.010","distance":0,"startLatitude":1.5},
    "splitSummaries":[{"splitType":"INTERVAL","duration":12,"endLongitude":4}]
  }`));
  const result = await invoke(getActivity, { activityId: "9223372036854775807" });
  expect(result.structuredContent).toMatchObject({
    data: {
      activityId: "9223372036854775807",
      parentId: "9223372036854775806",
      activityName: "fixture",
      activityTypeDTO: { typeKey: "running" },
      metadataDTO: { fileFormat: { formatId: 7, formatKey: "fit" } },
      summaryDTO: { startTimeGMT: "2025-02-03T04:05:06.010", startTimeLocal: "2025-02-03T02:05:06.010", distance: 0 },
      splitSummaries: [{ splitType: "INTERVAL", duration: 12 }],
    },
    units: { distance: "m", duration: "s" },
  });
  expect(JSON.stringify(result)).not.toMatch(/fixture secret|userId|startLatitude|endLongitude/);
  expect(upstream.paths()).toEqual(["/activity-service/activity/9223372036854775807"]);
});

it.each(["0", "-1", "9223372036854775808", "01", "1/..", 123])(
  "rejects invalid int64 ID %s before dispatch", async (activityId) => {
    const upstream = fixtureUpstream(Response.json({ activityId: 123 }));
    await expect(invoke(getActivity, { activityId })).resolves.toMatchObject({
      isError: true, structuredContent: { code: "invalid_input" },
    });
    expect(upstream.paths()).toEqual([]);
  },
);

it("projects workout steps in their original order and preserves device-encoded targets", async () => {
  const upstream = fixtureUpstream(Response.json([{
    index: 0,
    workoutName: "Fixture workout",
    sport: "RUNNING",
    steps: [
      { stepIndex: 0, name: "Hard effort", durationType: "TIME", durationValue: 20, targetType: "HEART_RATE", targetValueLow: 240, targetValueHigh: 258, trainerId: 10 },
      { stepIndex: 1, durationType: "REPEAT_UNTIL_STEPS_CMPLT", durationValue: 0, targetValue: 3 },
    ],
  }]));
  const result = await invoke(getActivityWorkouts, { activityId: "41" });
  expect(result.structuredContent).toMatchObject({
    data: [{ workoutName: "Fixture workout", sport: "RUNNING", steps: [
      { stepIndex: 0, targetValueLow: 240, targetValueHigh: 258 },
      { stepIndex: 1, durationValue: 0, targetValue: 3 },
    ] }],
  });
  expect(JSON.stringify(result)).not.toContain("trainerId");
  expect(upstream.paths()).toEqual(["/activity-service/activity/41/workouts"]);
});

it("searches with repeated filters, starts at the requested offset, and returns a full next-page offset", async () => {
  const upstream = fixtureUpstream(Response.json([{
    activityId: 123, activityName: "Fixture search", isFavorite: false, elapsedDuration: 0,
    activityType: { typeKey: "running" }, comments: [{ text: "fixture secret" }], ownerId: 24,
  }]));
  const result = await invoke(searchActivities, {
    start: 4, limit: 1, activityType: "running", activitySubType: "trail_running",
    excludedActivitySubType: ["treadmill_running", "indoor_running"],
    requiredField: ["duration", "distance"],
    startDate: "2024-02-29", endDate: "2024-03-02", minAvgPower: 0,
    upperLatitude: 5, lowerLatitude: -5, leftLongitude: 175, rightLongitude: 179,
  });
  expect(result.structuredContent).toMatchObject({
    data: [{ activityId: "123", isFavorite: false, elapsedDuration: 0, activityType: { typeKey: "running" } }],
    nextStart: 5,
  });
  expect(JSON.stringify(result)).not.toMatch(/fixture secret|ownerId|comments/);
  const [path] = upstream.paths();
  const url = new URL(path, "https://fixture.test");
  expect(url.pathname).toBe("/activitylist-service/activities/search/activities");
  expect(url.searchParams.getAll("excludedActivitySubType")).toEqual(["treadmill_running", "indoor_running"]);
  expect(url.searchParams.getAll("requiredField")).toEqual(["duration", "distance"]);
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    favorite: "-1", excludeChildren: "true", sortOrder: "desc", sortBy: "startLocal", start: "4",
    limit: "1", minAvgPower: "0", startDate: "2024-02-29", endDate: "2024-03-02",
  });
});

it("uses the documented page size and preserves empty results", async () => {
  const upstream = fixtureUpstream(Response.json([]));
  await expect(invoke(searchActivities, { endDate: "2025-10-22" })).resolves.toMatchObject({
    structuredContent: { data: [], nextStart: null },
  });
  const [path] = upstream.paths();
  const query = new URL(path, "https://fixture.test").searchParams;
  expect(query.get("limit")).toBe("25");
  expect(query.get("start")).toBe("0");
  expect(query.has("startDate")).toBe(false);
  expect(query.get("endDate")).toBe("2025-10-22");
});

it.each([
  { limit: 0 }, { limit: 100 }, { start: -1 }, { favorite: 2 }, { sortOrder: "ascending" },
  { startDate: "2025-02-29" }, { startDate: "2025-05-01", endDate: "2025-04-01" },
  { startDate: "2024-01-01", endDate: "2025-01-01" },
  { minDistance: 200, maxDistance: 100 }, { lowerMaxDepth: 12, upperMaxDepth: 11 },
  { upperLatitude: 10 }, { upperLatitude: 91, lowerLatitude: -1, leftLongitude: 0, rightLongitude: 3 },
  { upperLatitude: -2, lowerLatitude: 1, leftLongitude: 0, rightLongitude: 3 },
  { upperLatitude: 10, lowerLatitude: -5, leftLongitude: 4, rightLongitude: 3 },
  { activityType: "running", activitySubType: "running" }, { maxAvgPower: 50 }, { unknown: "fixture" },
])("rejects invalid filter combinations %# without requesting Garmin", async (input) => {
  const upstream = fixtureUpstream(Response.json([]));
  await expect(invoke(searchActivities, input)).resolves.toMatchObject({
    isError: true, structuredContent: { code: "invalid_input" },
  });
  expect(upstream.paths()).toEqual([]);
});

it("handles Garmin rejecting a mismatched activity type and subtype", async () => {
  fixtureUpstream(new Response("fixture-private-error", { status: 400 }));
  const result = await invoke(searchActivities, { activityType: "running", activitySubType: "road_cycling" });
  expect(result).toMatchObject({ isError: true, structuredContent: { code: "invalid_input" } });
  expect(JSON.stringify(result)).not.toContain("fixture-private-error");
});
