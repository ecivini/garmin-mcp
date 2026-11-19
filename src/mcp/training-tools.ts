import { z } from "zod";
import { garminClient } from "../garmin/client";
import { calendarDate, optionalFlag as flag, optionalNumber as number, optionalText as text, project, withinInclusiveDays } from "./garmin-schemas";
import { defineTool } from "./tools";

const zones = z.array(z.object({
  sport: text, trainingMethod: text, restingHeartRateUsed: number, lactateThresholdHeartRateUsed: number,
  zone1Floor: number, zone2Floor: number, zone3Floor: number, zone4Floor: number, zone5Floor: number,
  maxHeartRateUsed: number, restingHrAutoUpdateUsed: flag,
}));

export const getHeartRateZones = defineTool({
  name: "get_heart_rate_zones",
  title: "Get heart rate zones",
  description: "Read Garmin's heart rate training zones by sport.",
  input: z.strictObject({ generateDefaults: z.boolean().default(true) }),
  async execute(input, context) {
    const json = await garminClient.readJson("get_heart_rate_zones", context, { query: input });
    return {
      data: project(zones, json),
      units: { restingHeartRateUsed: "bpm", lactateThresholdHeartRateUsed: "bpm", maxHeartRateUsed: "bpm" },
    };
  },
});

const fitnessAge = z.array(z.object({
  chronologicalAge: number, fitnessAge: number, achievableFitnessAge: number, previousFitnessAge: number,
  components: z.record(z.string(), z.unknown()).nullish(), lastUpdated: text, invalidReason: text,
}));
const component = z.object({
  value: number, targetValue: number, improvementValue: number, potentialAge: number,
  priority: number, stale: flag, staleInputs: z.array(z.string()).nullish(), lastMeasurementDate: text, numOfWeeksForIm: number,
});
const componentUnits = new Map([
  ["VIGOROUSDAYS", "days"], ["VIGOROUSMINUTES", "min"], ["VIGOROUSWEEKS", "weeks"],
  ["RESTINGHEARTRATE", "bpm"], ["RESTINGHR", "bpm"], ["RHR", "bpm"],
  ["BMI", "kg/m²"], ["BODYFAT", "%"], ["BODYFATPERCENT", "%"], ["BODYFATPERCENTAGE", "%"],
]);

export const getFitnessAge = defineTool({
  name: "get_fitness_age",
  title: "Get fitness age",
  description: "Read the latest Garmin fitness age available as of a calendar date.",
  input: z.strictObject({ calendarDate, fullHistoryScan: z.boolean().default(true) }),
  async execute({ calendarDate, fullHistoryScan }, context) {
    const json = await garminClient.readJson("get_fitness_age", context, {
      path: { calendarDate }, query: { fullHistoryScan },
    });
    const units: Record<string, string> = {
      chronologicalAge: "years", fitnessAge: "years", achievableFitnessAge: "years", previousFitnessAge: "years",
    };
    const data = project(fitnessAge, json).map(({ components, ...age }) => {
      if (components === undefined) return age;
      if (components === null) return { ...age, components };
      const contributors = Object.entries(components).flatMap(([key, value]) => {
        const unit = componentUnits.get(key.replaceAll("_", "").toUpperCase());
        if (!unit) return [];
        for (const field of ["value", "targetValue", "improvementValue"]) units[`components.${key}.${field}`] = unit;
        units[`components.${key}.potentialAge`] = "years";
        units[`components.${key}.numOfWeeksForIm`] = "weeks";
        return [[key, project(component, value)] as const];
      });
      return { ...age, components: Object.fromEntries(contributors) };
    });
    return { data, units };
  },
});

const vo2Reading = z.object({ calendarDate: text, vo2MaxValue: number, vo2MaxPreciseValue: number });
const vo2Data = z.array(z.object({
  generic: vo2Reading.nullish(), cycling: vo2Reading.nullish(), rowing: vo2Reading.nullish(),
}));

// Uppercase FIT sport keys mirror the official Garmin FIT C++ profile.
const sport = z.enum([
  "GENERIC", "RUNNING", "CYCLING", "TRANSITION", "FITNESS_EQUIPMENT", "SWIMMING", "BASKETBALL",
  "SOCCER", "TENNIS", "AMERICAN_FOOTBALL", "TRAINING", "WALKING", "CROSS_COUNTRY_SKIING", "ALPINE_SKIING",
  "SNOWBOARDING", "ROWING", "MOUNTAINEERING", "HIKING", "MULTISPORT", "PADDLING", "FLYING", "E_BIKING",
  "MOTORCYCLING", "BOATING", "DRIVING", "GOLF", "HANG_GLIDING", "HORSEBACK_RIDING", "HUNTING", "FISHING",
  "INLINE_SKATING", "ROCK_CLIMBING", "SAILING", "ICE_SKATING", "SKY_DIVING", "SNOWSHOEING", "SNOWMOBILING",
  "STAND_UP_PADDLEBOARDING", "SURFING", "WAKEBOARDING", "WATER_SKIING", "KAYAKING", "RAFTING", "WINDSURFING",
  "KITESURFING", "TACTICAL", "JUMPMASTER", "BOXING", "FLOOR_CLIMBING", "BASEBALL", "DIVING", "SHOOTING",
  "WINTER_SPORT", "GRINDING", "HIIT", "VIDEO_GAMING", "RACKET", "WHEELCHAIR_PUSH_WALK", "WHEELCHAIR_PUSH_RUN",
  "MEDITATION", "PARA_SPORT", "DISC_GOLF", "TEAM_SPORT", "CRICKET", "RUGBY", "HOCKEY", "LACROSSE",
  "VOLLEYBALL", "WATER_TUBING", "WAKESURFING", "WATER_SPORT", "ARCHERY", "MIXED_MARTIAL_ARTS", "MOTOR_SPORTS",
  "SNORKELING", "DANCE", "JUMP_ROPE", "POOL_APNEA", "MOBILITY", "GEOCACHING", "CANOEING",
]);

export const getVo2Max = defineTool({
  name: "get_vo2_max",
  title: "Get VO₂ max",
  description: "Read Garmin VO₂ max estimates for an inclusive date range of up to 31 days.",
  input: z.strictObject({ startDate: calendarDate, endDate: calendarDate, sport: z.array(sport).max(sport.options.length).optional() })
    .refine(({ startDate, endDate }) => withinInclusiveDays(startDate, endDate, 31)),
  sizeHint: "Try a smaller date range.",
  async execute({ startDate, endDate, sport }, context) {
    const json = await garminClient.readJson("get_vo2_max", context, { path: { startDate, endDate }, query: { sport } });
    return { data: project(vo2Data, json), units: { vo2MaxValue: "mL/kg/min", vo2MaxPreciseValue: "mL/kg/min" } };
  },
});

const hrvSummary = z.object({
  calendarDate: text, weeklyAvg: number, lastNightAvg: number, lastNight5MinHigh: number,
  status: text, feedbackPhrase: text, createTimeStamp: text,
  baseline: z.object({ lowUpper: number, balancedLow: number, balancedUpper: number, markerValue: number }).nullish(),
});
const hrvDay = z.object({
  hrvSummary: hrvSummary.nullish(),
  hrvReadings: z.array(z.object({ hrvValue: number, readingTimeGMT: text, readingTimeLocal: text })).nullish(),
  startTimestampGMT: text, endTimestampGMT: text, startTimestampLocal: text, endTimestampLocal: text,
  sleepStartTimestampGMT: text, sleepEndTimestampGMT: text, sleepStartTimestampLocal: text, sleepEndTimestampLocal: text,
});
const hrvRange = z.object({ hrvSummaries: z.array(hrvSummary) });
const hrvUnits = {
  weeklyAvg: "ms", lastNightAvg: "ms", lastNight5MinHigh: "ms",
  "baseline.lowUpper": "ms", "baseline.balancedLow": "ms", "baseline.balancedUpper": "ms",
};

export const getHrvDay = defineTool({
  name: "get_hrv_day",
  title: "Get daily HRV",
  description: "Read Garmin overnight heart rate variability, baseline and readings on a calendar date.",
  input: z.strictObject({ calendarDate }),
  async execute(path, context) {
    const json = await garminClient.readJson("get_hrv_day", context, { path });
    return { data: json === undefined ? null : project(hrvDay, json), units: { ...hrvUnits, hrvValue: "ms" } };
  },
});

export const getHrvRange = defineTool({
  name: "get_hrv_range",
  title: "Get HRV range",
  description: "Read Garmin daily heart rate variability summaries for an inclusive range of up to 31 days.",
  input: z.strictObject({ fromDate: calendarDate, toDate: calendarDate })
    .refine(({ fromDate, toDate }) => withinInclusiveDays(fromDate, toDate, 31)),
  sizeHint: "Try a smaller date range.",
  async execute(path, context) {
    const json = await garminClient.readJson("get_hrv_range", context, { path });
    return { data: json === undefined ? null : project(hrvRange, json), units: hrvUnits };
  },
});

export const trainingTools = [getHeartRateZones, getFitnessAge, getVo2Max, getHrvDay, getHrvRange];
