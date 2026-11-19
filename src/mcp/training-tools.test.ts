import { afterEach, expect, it, vi } from "vitest";
import { fixtureUpstream, invoke } from "./tool-test-fixtures";
import { getFitnessAge, getHeartRateZones, getHrvDay, getHrvRange, getVo2Max } from "./training-tools";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("requests default heart rate zones, preserves 0 and null, and keeps unspecified floor units unlabeled", async () => {
  const upstream = fixtureUpstream(Response.json([{
    sport: "RUNNING", trainingMethod: "HR_MAX", restingHeartRateUsed: 0,
    zone1Floor: 50, zone5Floor: null, userProfileId: "fixture-private",
  }]));
  const result = await invoke(getHeartRateZones, {});
  expect(result.structuredContent).toEqual({
    data: [{ sport: "RUNNING", trainingMethod: "HR_MAX", restingHeartRateUsed: 0, zone1Floor: 50, zone5Floor: null }],
    units: { restingHeartRateUsed: "bpm", lactateThresholdHeartRateUsed: "bpm", maxHeartRateUsed: "bpm" },
  });
  expect(upstream.paths()).toEqual(["/biometric-service/heartRateZones/v2?generateDefaults=true"]);
});

it("keeps documented fitness age contributors and supports the short history scan", async () => {
  const upstream = fixtureUpstream(Response.json([{
    chronologicalAge: 38, fitnessAge: 31.5, invalidReason: null,
    components: {
      VIGOROUS_DAYS: { value: 3, targetValue: 4, privateField: "fixture-private" },
      restingHeartRate: { value: 46, stale: false },
      unknownPrivateKey: { value: 5 },
    },
  }]));
  const result = await invoke(getFitnessAge, { calendarDate: "2024-02-29", fullHistoryScan: false });
  expect(result.structuredContent).toMatchObject({
    data: [{
      chronologicalAge: 38, fitnessAge: 31.5, invalidReason: null,
      components: { VIGOROUS_DAYS: { value: 3, targetValue: 4 }, restingHeartRate: { value: 46, stale: false } },
    }],
    units: { chronologicalAge: "years", "components.VIGOROUS_DAYS.value": "days", "components.restingHeartRate.value": "bpm" },
  });
  expect(JSON.stringify(result)).not.toMatch(/fixture-private|unknownPrivateKey/);
  expect(upstream.paths()).toEqual(["/fitnessage-service/fitnessage/v2/2024-02-29?fullHistoryScan=false"]);
});

it("retains the fitness age unavailable reason and uses full history by default", async () => {
  const upstream = fixtureUpstream(Response.json([{ invalidReason: "USER_EMPTY_AGE" }]));
  const result = await invoke(getFitnessAge, { calendarDate: "2025-01-02" });
  expect(result.structuredContent).toMatchObject({ data: [{ invalidReason: "USER_EMPTY_AGE" }] });
  expect(upstream.paths()).toEqual(["/fitnessage-service/fitnessage/v2/2025-01-02?fullHistoryScan=true"]);
});

it("repeats valid FIT sport filters and omits missing VO2 entries", async () => {
  const upstream = fixtureUpstream(Response.json([{
    cycling: { calendarDate: "2025-01-01", vo2MaxPreciseValue: 48.2, vo2MaxValue: 48, note: "fixture-private" },
    rowing: null,
  }]));
  const result = await invoke(getVo2Max, { startDate: "2025-01-01", endDate: "2025-01-31", sport: ["CYCLING", "ROWING"] });
  expect(result.structuredContent).toMatchObject({
    data: [{ cycling: { calendarDate: "2025-01-01", vo2MaxPreciseValue: 48.2, vo2MaxValue: 48 }, rowing: null }],
    units: { vo2MaxValue: "mL/kg/min" },
  });
  expect(JSON.stringify(result)).not.toContain("fixture-private");
  expect(upstream.paths()).toEqual(["/metrics-service/metrics/maxmet/daily/2025-01-01/2025-01-31?sport=CYCLING&sport=ROWING"]);
});

it.each([
  { startDate: "2025-01-01", endDate: "2025-02-01" },
  { startDate: "2025-01-02", endDate: "2025-01-01" },
  { startDate: "2025-01-01", endDate: "2025-01-01", sport: ["UNSUPPORTED"] },
  { startDate: "2025-01-01", endDate: "2025-01-01", sport: "CYCLING" },
])("rejects invalid VO₂ max bounds or sport filter %# before contacting Garmin", async (input) => {
  const upstream = fixtureUpstream(Response.json([]));
  await expect(invoke(getVo2Max, input)).resolves.toMatchObject({ isError: true, structuredContent: { code: "invalid_input" } });
  expect(upstream.paths()).toEqual([]);
});

it("projects HRV timed readings and baseline fields while excluding internal IDs", async () => {
  const fetch = fixtureUpstream(Response.json({
    userProfilePk: 52,
    hrvSummary: { calendarDate: "2025-03-01", lastNightAvg: 0, baseline: { balancedLower: 0, balancedLow: 34 } },
    hrvReadings: [{ hrvValue: 28, readingTimeGMT: "2025-03-01T21:00:00", readingTimeLocal: "2025-03-01T22:00:00" }],
  }));
  const result = await invoke(getHrvDay, { calendarDate: "2025-03-01" });
  expect(result.structuredContent).toMatchObject({
    data: { hrvSummary: { lastNightAvg: 0, baseline: { balancedLow: 34 } },
      hrvReadings: [{ hrvValue: 28, readingTimeGMT: "2025-03-01T21:00:00", readingTimeLocal: "2025-03-01T22:00:00" }] },
    units: { hrvValue: "ms" },
  });
  expect(JSON.stringify(result)).not.toMatch(/userProfilePk|balancedLower/);
  expect(fetch.paths()).toEqual(["/hrv-service/hrv/2025-03-01"]);
});

it("projects the daily HRV range wrapper and preserves empty collections", async () => {
  const fetch = fixtureUpstream(Response.json({ hrvSummaries: [], userProfilePk: 52 }));
  await expect(invoke(getHrvRange, { fromDate: "2024-02-29", toDate: "2024-03-02" })).resolves.toMatchObject({
    structuredContent: { data: { hrvSummaries: [] } },
  });
  expect(fetch.paths()).toEqual(["/hrv-service/hrv/daily/2024-02-29/2024-03-02"]);
});

it("maps documented HRV 204 responses to null and rejects 204 for other training tools", async () => {
  fixtureUpstream(...Array.from({ length: 3 }, () => new Response(null, { status: 204 })));
  await expect(invoke(getHrvDay, { calendarDate: "2025-01-01" })).resolves.toMatchObject({ structuredContent: { data: null } });
  await expect(invoke(getHrvRange, { fromDate: "2025-01-01", toDate: "2025-01-31" })).resolves.toMatchObject({ structuredContent: { data: null } });
  await expect(invoke(getHeartRateZones, {})).resolves.toMatchObject({ isError: true, structuredContent: { code: "garmin_unavailable" } });
});
