import { z } from "zod";
import { garminClient } from "../garmin/client";
import { calendarDate, project, withinInclusiveDays } from "./garmin-schemas";
import { bodyBatteryDays, heartRateDay, spo2Day } from "./sensor-projections";
import { defineTool } from "./tools";
import {
  hydrationDays, stepDays, stressDays, wellnessActivities, wellnessActivityUnits,
  wellnessDay, wellnessDayUnits, wellnessRange, wellnessV2Units,
} from "./wellness-projections";

const rangeDates = z.strictObject({ startDate: calendarDate, endDate: calendarDate });
const days31 = rangeDates.refine(({ startDate, endDate }) => withinInclusiveDays(startDate, endDate, 31));
const days28 = rangeDates.refine(({ startDate, endDate }) => withinInclusiveDays(startDate, endDate, 28));
const rangeHint = "Try a smaller date range.";

export const getHydrationRange = defineTool({
  name: "get_hydration_range",
  title: "Get hydration range",
  description: "Read daily Garmin hydration, goals and activity intake for an inclusive range of up to 31 days.",
  input: days31,
  sizeHint: rangeHint,
  async execute(path, context) {
    const json = await garminClient.readJson("get_hydration_range", context, { path });
    return { data: project(hydrationDays, json), units: { valueInML: "mL", goalInML: "mL", sweatLossInML: "mL", activityIntakeInML: "mL" } };
  },
});

export const getStepsRange = defineTool({
  name: "get_steps_range",
  title: "Get steps range",
  description: "Read daily Garmin step counts, distance and goals for an inclusive range of up to 28 days.",
  input: days28,
  sizeHint: rangeHint,
  async execute(path, context) {
    const json = await garminClient.readJson("get_steps_range", context, { path });
    return { data: project(stepDays, json), units: { totalDistance: "m" } };
  },
});

export const getStressRange = defineTool({
  name: "get_stress_range",
  title: "Get stress range",
  description: "Read daily Garmin stress scores and durations for an inclusive range of up to 28 days.",
  input: days28,
  sizeHint: rangeHint,
  async execute(path, context) {
    const json = await garminClient.readJson("get_stress_range", context, { path });
    return {
      data: project(stressDays, json),
      units: { overallStressLevel: "Garmin score", restStressDuration: "s", highStressDuration: "s", mediumStressDuration: "s", lowStressDuration: "s" },
    };
  },
});

export const getWellnessDay = defineTool({
  name: "get_wellness_day",
  title: "Get daily wellness summary",
  description: "Read Garmin's wellness and activity totals for one calendar date.",
  input: z.strictObject({ calendarDate }),
  async execute(query, context) {
    const json = await garminClient.readJson("get_wellness_day", context, { query });
    return { data: project(wellnessDay, json), units: wellnessDayUnits };
  },
});

export const getWellnessRange = defineTool({
  name: "get_wellness_range",
  title: "Get wellness summaries",
  description: "Read Garmin's grouped daily wellness metrics for an inclusive range of up to 31 days.",
  input: days31,
  sizeHint: rangeHint,
  async execute(query, context) {
    const json = await garminClient.readJson("get_wellness_range", context, { query });
    return { data: project(wellnessRange, json), units: wellnessV2Units };
  },
});

const bodyBatteryInput = rangeDates.extend({ chunks: z.int32().positive().optional() })
  .refine(({ startDate, endDate }) => withinInclusiveDays(startDate, endDate, 31));
export const getBodyBatteryRange = defineTool({
  name: "get_body_battery_range",
  title: "Get Body Battery range",
  description: "Read Garmin Body Battery history and events for an inclusive range of up to 31 days.",
  input: bodyBatteryInput,
  sizeHint: "Try a smaller date range or fewer chunks.",
  async execute(query, context) {
    const json = await garminClient.readJson("get_body_battery_range", context, { query });
    return {
      data: project(bodyBatteryDays, json),
      units: { charged: "points", drained: "points", bodyBatteryLevel: "0–100", durationInMilliseconds: "ms" },
    };
  },
});

export const getSpo2Day = defineTool({
  name: "get_spo2_day",
  title: "Get daily SpO₂",
  description: "Read Garmin Pulse Ox readings and monitoring environment metrics for one calendar date.",
  input: z.strictObject({ calendarDate }),
  async execute(path, context) {
    const json = await garminClient.readJson("get_spo2_day", context, { path });
    return {
      data: project(spo2Day, json),
      units: {
        averageSpO2: "%", lowestSpO2: "%", lastSevenDaysAvgSpO2: "%", latestSpO2: "%",
        avgSleepSpO2: "%", avgTomorrowSleepSpO2: "%", spo2Level: "%", spo2Value: "%",
      },
    };
  },
});

export const getHeartRateDay = defineTool({
  name: "get_heart_rate_day",
  title: "Get daily heart rate",
  description: "Read Garmin heart rate summaries, thresholds and timed samples for one calendar date.",
  input: z.strictObject({ date: calendarDate }),
  async execute(query, context) {
    const json = await garminClient.readJson("get_heart_rate_day", context, { query });
    return {
      data: project(heartRateDay, json),
      units: {
        minHeartRate: "bpm", maxHeartRate: "bpm", restingHeartRate: "bpm", lastSevenDaysAvgRestingHeartRate: "bpm",
        abnormalHrThresholdValue: "bpm", lowAbnormalHrThresholdValue: "bpm", heartRate: "bpm", heartRateValue: "bpm",
      },
    };
  },
});

export const getWellnessActivities = defineTool({
  name: "get_wellness_activities",
  title: "Get wellness activities",
  description: "Read Garmin wellness activity summaries and time in zone for an inclusive range of up to 31 days.",
  input: z.strictObject({ fromDate: calendarDate, untilDate: calendarDate })
    .refine(({ fromDate, untilDate }) => withinInclusiveDays(fromDate, untilDate, 31)),
  sizeHint: rangeHint,
  async execute(path, context) {
    const json = await garminClient.readJson("get_wellness_activities", context, { path });
    return { data: project(wellnessActivities, json), units: wellnessActivityUnits };
  },
});

export const wellnessTools = [
  getHydrationRange, getStepsRange, getStressRange, getWellnessDay, getWellnessRange,
  getBodyBatteryRange, getSpo2Day, getHeartRateDay, getWellnessActivities,
];
