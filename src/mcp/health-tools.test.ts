import { afterEach, expect, it, vi } from "vitest";
import {
  getMenstrualCycleDay, getMenstrualCycleSummary, getNutritionDay, getProfileSettings, getSleepDay, getSleepRange,
} from "./health-tools";
import { fixtureUpstream, invoke } from "./tool-test-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("allows the owner's profile settings and projects nested preferences", async () => {
  const upstream = fixtureUpstream(Response.json({
    displayName: "fixture-owner", email: "fixture-private", preferredLocale: "en_US",
    timeZone: "Europe/Rome", firstDayOfWeek: { dayName: "MONDAY", sortOrder: 1, userProfileId: "fixture-private" },
    timeFormat: { formatKey: "24-hour", groupingUsed: false }, availableTrainingDays: ["MONDAY"],
    hydrationContainers: [{ name: "Fixture bottle", volume: 20, unit: "OZ", privateId: "fixture-private" }],
  }));
  const result = await invoke(getProfileSettings, {});
  expect(result.structuredContent).toEqual({
    data: {
      displayName: "fixture-owner", preferredLocale: "en_US", timeZone: "Europe/Rome",
      firstDayOfWeek: { dayName: "MONDAY", sortOrder: 1 }, timeFormat: { formatKey: "24-hour", groupingUsed: false },
      availableTrainingDays: ["MONDAY"], hydrationContainers: [{ name: "Fixture bottle", volume: 20, unit: "OZ" }],
    },
    units: {},
  });
  expect(JSON.stringify(result)).not.toContain("fixture-private");
  expect(upstream.paths()).toEqual(["/userprofile-service/userprofile/settings"]);
});

it("projects meal nutrition, preserves large meal IDs and timestamps, and disables media", async () => {
  const upstream = fixtureUpstream(new Response(`{
    "mealDate":"2024-02-29",
    "dailyNutritionContent":{"calories":0,"protein":15,"privateNotes":"fixture-private"},
    "mealDetails":[{
      "meal":{"mealId":9223372036854775807,"mealName":"Fixture meal"},
      "loggedFoods":[{"mealId":9223372036854775807,"mealDateTimeWithOffset":"2024-02-29T07:30:00+01:00",
        "nutritionContent":{"numberOfUnits":2,"servingUnit":"g","vitaminA":21,"iron":0},
        "foodMetaData":{"foodName":"Fixture food","foodImageUrl":"fixture-private"},
        "foodImages":[{"imageUrl":"fixture-private"}]}]
    }]
  }`));
  const result = await invoke(getNutritionDay, { date: "2024-02-29", mealId: "9223372036854775807", includeGoals: false });
  expect(result.structuredContent).toMatchObject({
    data: {
      mealDate: "2024-02-29", dailyNutritionContent: { calories: 0, protein: 15 }, mealDetails: [{
        meal: { mealId: "9223372036854775807", mealName: "Fixture meal" },
        loggedFoods: [{ nutritionContent: { numberOfUnits: 2, servingUnit: "g", vitaminA: 21, iron: 0 },
          mealDateTimeWithOffset: "2024-02-29T07:30:00+01:00", foodMetaData: { foodName: "Fixture food" } }],
      }],
    },
    units: { vitaminA: "µg", iron: "mg", calories: "kcal" },
  });
  expect(JSON.stringify(result)).not.toContain("fixture-private");
  expect(upstream.paths()).toEqual(["/nutrition-service/food/logs/2024-02-29?includeGoals=false&includeNutrition=true&includeMedia=false&mealId=9223372036854775807"]);
});

it("preserves menstrual local and UTC date fields and absent tracking data", async () => {
  const upstream = fixtureUpstream(Response.json({
    dayInCycle: 1, predictedCycle: false,
    startDate: { date: "2025-01-01T23:00:00Z", localDate: "2025-01-02", accountId: "fixture-private" },
    dueDate: null, analysis: { perimenopauseDetected: true },
  }));
  const result = await invoke(getMenstrualCycleSummary, { calendarDate: "2025-01-02" });
  expect(result.structuredContent).toMatchObject({
    data: { dayInCycle: 1, predictedCycle: false, startDate: { date: "2025-01-01T23:00:00Z", localDate: "2025-01-02" }, dueDate: null },
  });
  expect(JSON.stringify(result)).not.toContain("fixture-private");
  expect(JSON.stringify(result)).not.toContain("perimenopauseDetected");
  expect(upstream.paths()).toEqual(["/periodichealth-service/menstrualcycle/summary/2025-01-02"]);
});

it("projects day logs, pregnancy weight goals and prediction parameters", async () => {
  const upstream = fixtureUpstream(Response.json({
    dayLog: { userProfilePk: 9, symptoms: ["FIXTURE_SYMPTOM"],
      babyMovements: [{ count: 0, duration: 12, startTimestamp: { date: "2025-01-01T10:00:00Z" } }],
    },
    daySummary: { pregnancyCycle: true, numberOfWeek: 12, analysis: { perimenopauseDetected: false, cycleTypeAnalysis: { hasAmenorrhea: false, userProfilePk: 5 } } },
    weightGoals: { weekNum: 12, highWeightGoalInGrams: 70_000, lowWeightGoalInGrams: 65_000, internalId: 123 },
  }));
  const result = await invoke(getMenstrualCycleDay, { calendarDate: "2025-01-01", todayDate: "2025-01-04", includeAnalysis: true });
  expect(result.structuredContent).toMatchObject({
    data: { dayLog: { babyMovements: [{ count: 0, duration: 12, startTimestamp: { date: "2025-01-01T10:00:00Z" } }] },
      daySummary: { pregnancyCycle: true, numberOfWeek: 12, analysis: { perimenopauseDetected: false, cycleTypeAnalysis: { hasAmenorrhea: false } } },
      weightGoals: { highWeightGoalInGrams: 70_000, weekNum: 12 } },
    units: { highWeightGoalInGrams: "g" },
  });
  expect(JSON.stringify(result)).not.toMatch(/userProfilePk|internalId/);
  expect(upstream.paths()).toEqual(["/periodichealth-service/menstrualcycle/dayview/2025-01-01?todayDate=2025-01-04&reducedResponse=false&skipbm=false&includeAnalysis=true"]);
});

it("omits cycle analysis when Garmin includes it despite a default day read", async () => {
  const upstream = fixtureUpstream(Response.json({ daySummary: {
    currentPhase: 1, analysis: { perimenopauseDetected: true },
  } }));
  const result = await invoke(getMenstrualCycleDay, { calendarDate: "2025-01-01" });
  expect(result.structuredContent).toMatchObject({ data: { daySummary: { currentPhase: 1 } } });
  expect(JSON.stringify(result)).not.toContain("perimenopauseDetected");
  expect(upstream.paths()).toEqual(["/periodichealth-service/menstrualcycle/dayview/2025-01-01?reducedResponse=false&skipbm=false&includeAnalysis=false"]);
});

it("keeps sleep window timestamp labels, absent metrics, and zero nap durations", async () => {
  const upstream = fixtureUpstream(Response.json({
    id: 91, userProfilePK: 123, calendarDate: "2025-02-10", deepSleepSeconds: null, sleepTimeSeconds: 5400,
    sleepStartTimestampGMT: 1_739_141_000_000, sleepStartTimestampLocal: "1739144600000",
    sleepScores: { overall: { value: 84, qualifierKey: "GOOD", deviceId: 10 } },
    dailyNapDTOS: [{ deviceId: 42, napTimeSec: 0, napStartTimeOffset: 60 }],
  }), Response.json([]));
  const result = await invoke(getSleepDay, { date: "2025-02-10" });
  expect(result.structuredContent).toMatchObject({
    data: {
      calendarDate: "2025-02-10", deepSleepSeconds: null, sleepTimeSeconds: 5400,
      sleepStartTimestampGMT: 1_739_141_000_000, sleepStartTimestampLocal: "1739144600000",
      sleepScores: { overall: { value: 84, qualifierKey: "GOOD" } },
      dailyNapDTOS: [{ napTimeSec: 0, napStartTimeOffset: 60 }],
    },
    units: { sleepStartTimestampGMT: "ms", deepSleepSeconds: "s", napTimeSec: "s" },
  });
  expect(JSON.stringify(result)).not.toMatch(/deviceId|userProfilePK|remSleepSeconds":null/);
  await expect(invoke(getSleepRange, { startDate: "2025-02-10", endDate: "2025-03-12" })).resolves.toMatchObject({
    structuredContent: { data: [] },
  });
  expect(upstream.paths()).toEqual([
    "/sleep-service/sleep/dailySleep?date=2025-02-10",
    "/sleep-service/sleep/dailySleepSummariesByDate?startDate=2025-02-10&endDate=2025-03-12",
  ]);
});

it("rejects invalid dates, range sizes, and attempts to opt into nutrition media", async () => {
  const upstream = fixtureUpstream();
  for (const [tool, input] of [
    [getNutritionDay, { date: "2025-02-01", includeMedia: true }],
    [getNutritionDay, { date: "2025-02-30" }],
    [getMenstrualCycleDay, { calendarDate: "2025-02-10", todayDate: "2025-02-29" }],
    [getSleepDay, {}],
    [getSleepRange, { startDate: "2025-02-10", endDate: "2025-03-13" }],
  ] as const) {
    await expect(invoke(tool, input)).resolves.toMatchObject({ isError: true, structuredContent: { code: "invalid_input" } });
  }
  expect(upstream.paths()).toEqual([]);
});
