import { afterEach, expect, it, vi } from "vitest";
import { fixtureUpstream, invoke } from "./tool-test-fixtures";
import {
  getBodyBatteryRange, getHeartRateDay, getHydrationRange, getSpo2Day, getStepsRange, getStressRange,
  getWellnessActivities, getWellnessDay, getWellnessRange,
} from "./wellness-tools";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const leapRange = { startDate: "2024-02-29", endDate: "2024-03-01" };
const marker = "fixture-private";

it("projects hydration, steps and stress maps while preserving zeros and empties", async () => {
  const upstream = fixtureUpstream(
    Response.json([{ calendarDate: "2024-02-29", valueInML: 0, userId: marker }]),
    Response.json([{ calendarDate: "2024-03-01", totalSteps: 0, stepGoal: null }]),
    Response.json([
      { calendarDate: "2024-02-29", values: { highStressDuration: 0, restStressDuration: 12, [marker]: 123 } },
      { calendarDate: "2024-03-01", values: {} },
    ]),
  );
  expect((await invoke(getHydrationRange, leapRange)).structuredContent).toMatchObject({
    data: [{ calendarDate: "2024-02-29", valueInML: 0 }], units: { valueInML: "mL" },
  });
  expect((await invoke(getStepsRange, leapRange)).structuredContent).toMatchObject({
    data: [{ calendarDate: "2024-03-01", totalSteps: 0, stepGoal: null }], units: { totalDistance: "m" },
  });
  const result = await invoke(getStressRange, leapRange);
  expect(result.structuredContent).toMatchObject({
    data: [{ values: { highStressDuration: 0, restStressDuration: 12 } }, { values: {} }],
    units: { highStressDuration: "s" },
  });
  expect(JSON.stringify(result)).not.toContain(marker);
  expect(upstream.paths()).toEqual(["hydration", "steps", "stress"].map(type => `/usersummary-service/stats/${type}/daily/2024-02-29/2024-03-01`));
});

it("projects daily and v2 wellness groups and preserves distinct duration units", async () => {
  const upstream = fixtureUpstream(
    Response.json({ calendarDate: "2024-02-29", userProfileId: marker,
      includesWellnessData: false, durationInMilliseconds: 0, activeSeconds: 3600, vigorousIntensityMinutes: 3, averageSpo2: null }),
    Response.json({ data: [{ calendarDate: "2024-02-29",
      movement: { steps: { value: 0, distanceInMeters: 0, userProfilePk: marker } },
      stress: { totalDurationInMillis: 0, avgLevel: 21 },
      pulseOx: { latestValue: 96, latestTimestampLocal: "2024-02-29T12:30:00" },
      jetLag: { tripName: marker },
    }] }),
    Response.json({ data: [] }),
  );
  const day = await invoke(getWellnessDay, { calendarDate: "2024-02-29" });
  expect(day.structuredContent).toMatchObject({
    data: { includesWellnessData: false, durationInMilliseconds: 0, activeSeconds: 3600, vigorousIntensityMinutes: 3, averageSpo2: null },
    units: { durationInMilliseconds: "ms", activeSeconds: "s", vigorousIntensityMinutes: "min" },
  });
  const range = await invoke(getWellnessRange, leapRange);
  expect(range.structuredContent).toMatchObject({
    data: { data: [{ movement: { steps: { value: 0, distanceInMeters: 0 } }, stress: { totalDurationInMillis: 0, avgLevel: 21 } }] },
    units: { "movement.*.distanceInMeters": "m", "stress.totalDurationInMillis": "ms", "pulseOx.latestValue": "%" },
  });
  expect(JSON.stringify([day, range])).not.toContain(marker);
  expect((await invoke(getWellnessRange, leapRange)).structuredContent).toMatchObject({ data: { data: [] } });
  expect(upstream.paths()).toEqual([
    "/usersummary-service/usersummary/daily?calendarDate=2024-02-29",
    "/usersummary-service/v2/dailysummaries?startDate=2024-02-29&endDate=2024-03-01",
    "/usersummary-service/v2/dailysummaries?startDate=2024-02-29&endDate=2024-03-01",
  ]);
});

it("keeps Body Battery column indexes, drops unknown values, and sends bounded chunks", async () => {
  const upstream = fixtureUpstream(Response.json([{
    date: "2024-02-29", charged: 0, drained: 22,
    bodyBatteryValueDescriptorDTOList: [
      { bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: "timestamp" },
      { bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: marker },
      { bodyBatteryValueDescriptorIndex: 2, bodyBatteryValueDescriptorKey: "bodyBatteryLevel" },
    ],
    bodyBatteryValuesArray: [[1710000000000, { privateOwnerId: marker }, 0]],
    bodyBatteryActivityEvent: [{ eventType: "REST", durationInMilliseconds: 50, deviceId: marker }],
  }]));
  const result = await invoke(getBodyBatteryRange, { ...leapRange, chunks: 8 });
  expect(result.structuredContent).toMatchObject({ data: [{
    charged: 0, bodyBatteryValuesArray: [[1710000000000, null, 0]],
    bodyBatteryValueDescriptorDTOList: [{ bodyBatteryValueDescriptorIndex: 0 }, { bodyBatteryValueDescriptorIndex: 2 }],
    bodyBatteryActivityEvent: [{ eventType: "REST", durationInMilliseconds: 50 }],
  }] });
  expect(JSON.stringify(result)).not.toContain(marker);
  expect(upstream.paths()).toEqual(["/wellness-service/wellness/bodyBattery/reports/daily?startDate=2024-02-29&endDate=2024-03-01&chunks=8"]);
});

it("projects the SpO₂ series and keeps raw monitoring-environment encoding", async () => {
  const upstream = fixtureUpstream(Response.json({
    userProfilePK: marker, averageSpO2: 97.5, latestSpO2: null,
    spO2SingleValues: [[1710000000000, 0]], spO2SingleValuesDescriptorList: [
      { spo2ValueDescriptorIndex: 0, spo2ValueDescriptorKey: "timestamp" },
      { spo2ValueDescriptorIndex: 1, spo2ValueDescriptorKey: "spo2Level" },
    ],
    monitoringEnvironmentValues: [[1710000000000, 3]], monitoringEnvironmentValuesDescriptorList: [
      { monEnvValueDescIndex: 0, monEnvValueDescKey: "timestamp" },
      { monEnvValueDescIndex: 1, monEnvValueDescKey: "monitoringEnvironmentLevel" },
    ],
  }));
  const result = await invoke(getSpo2Day, { calendarDate: "2024-02-29" });
  expect(result.structuredContent).toMatchObject({
    data: { averageSpO2: 97.5, latestSpO2: null, spO2SingleValues: [[1710000000000, 0]], monitoringEnvironmentValues: [[1710000000000, 3]] },
    units: { averageSpO2: "%", spo2Level: "%" },
  });
  expect(JSON.stringify(result)).not.toContain(marker);
  expect(upstream.paths()).toEqual(["/wellness-service/wellness/daily/spo2acclimation/2024-02-29"]);
});

it("projects heart-rate descriptors and limits rows to known columns", async () => {
  const upstream = fixtureUpstream(Response.json({
    calendarDate: { localDate: "2024-02-29" }, minHeartRate: 0, maxHeartRate: 185,
    restingHeartRate: null, heartRateValueDescriptors: [{ index: 1, key: "heartRate" }, { index: 0, key: "timestamp" }, { index: 2, key: marker }],
    heartRateValues: [[1710000000000, 42, marker]],
    abnormalHRValuesArray: [[1710000000000, 240, marker]],
  }));
  const result = await invoke(getHeartRateDay, { date: "2024-02-29" });
  expect(result.structuredContent).toMatchObject({
    data: { minHeartRate: 0, maxHeartRate: 185, restingHeartRate: null, heartRateValues: [[1710000000000, 42, null]] },
    units: { heartRate: "bpm" },
  });
  expect(JSON.stringify(result)).not.toContain(marker);
  expect(JSON.stringify(result)).not.toContain("abnormalHRValuesArray");
  expect(upstream.paths()).toEqual(["/wellness-service/wellness/dailyHeartRate?date=2024-02-29"]);
});

it("projects wellness activity metrics by type and omits device metadata", async () => {
  const upstream = fixtureUpstream(Response.json([{
    activityName: "Fixture activity", wellnessActivityType: "BREATHWORK", calendarDate: { localDate: "2024-02-29" },
    summaryTypeDataList: [{ summaryType: "HEART_RATE", minValue: 0, avgValue: 45 }, { summaryType: marker, minValue: 5 }],
    timeInZoneList: [{ zoneNumber: 1, millisInZone: 500, zoneLowBoundary: 30 }], deviceMetaData: { deviceId: marker },
  }]));
  const result = await invoke(getWellnessActivities, { fromDate: "2024-02-29", untilDate: "2024-03-01" });
  expect(result.structuredContent).toMatchObject({
    data: [{ activityName: "Fixture activity", summaryTypeDataList: [{ summaryType: "HEART_RATE", minValue: 0, avgValue: 45 }],
      timeInZoneList: [{ millisInZone: 500 }] }],
    units: { HEART_RATE: "bpm", millisInZone: "ms" },
  });
  expect(JSON.stringify(result)).not.toContain(marker);
  expect(upstream.paths()).toEqual(["/wellnessactivity-service/activity/summary/range/2024-02-29/2024-03-01"]);
});

it("rejects invalid wellness intervals and chunks before Garmin", async () => {
  const upstream = fixtureUpstream();
  for (const [tool, input] of [
    [getHydrationRange, { startDate: "2024-02-01", endDate: "2024-03-03" }],
    [getStepsRange, { startDate: "2024-02-01", endDate: "2024-02-29" }],
    [getStressRange, { startDate: "2024-02-01", endDate: "2024-02-29" }],
    [getWellnessRange, { startDate: "2024-02-01", endDate: "2024-03-03" }],
    [getBodyBatteryRange, { ...leapRange, chunks: 0 }],
    [getBodyBatteryRange, { ...leapRange, chunks: 2_147_483_648 }],
    [getHeartRateDay, { date: "2025-02-29" }],
    [getWellnessActivities, { fromDate: "2024-03-01", untilDate: "2024-02-29" }],
  ] as const) {
    await expect(invoke(tool, input)).resolves.toMatchObject({ isError: true, structuredContent: { code: "invalid_input" } });
  }
  expect(upstream.paths()).toEqual([]);
});
