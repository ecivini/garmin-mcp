import { z } from "zod";
import { garminClient } from "../garmin/client";
import { calendarDate, garminId, project, withinInclusiveDays } from "./garmin-schemas";
import {
  cycleUnits, dailyNutrition, dailySleep, menstrualCycleDay, menstrualCycleDayWithAnalysis,
  menstrualCycleSummary, nutritionUnits, profileSettings, sleepUnits,
} from "./health-projections";
import { defineTool } from "./tools";

export const getProfileSettings = defineTool({
  name: "get_profile_settings",
  title: "Get profile settings",
  description: "Read the Garmin owner's display name and locale, format, hydration and training preferences.",
  input: z.strictObject({}),
  async execute(_input, context) {
    const json = await garminClient.readJson("get_profile_settings", context);
    return { data: project(profileSettings, json), units: {} };
  },
});

export const getNutritionDay = defineTool({
  name: "get_nutrition_day",
  title: "Get daily nutrition",
  description: "Read logged meals, foods and nutrition for a local calendar date.",
  input: z.strictObject({
    date: calendarDate, includeGoals: z.boolean().default(true), includeNutrition: z.boolean().default(true), mealId: garminId.optional(),
  }),
  sizeHint: "Try specifying a meal ID.",
  async execute({ date, includeGoals, includeNutrition, mealId }, context) {
    const json = await garminClient.readJson("get_nutrition_day", context, {
      path: { date }, query: { includeGoals, includeNutrition, includeMedia: false, mealId },
    });
    return { data: project(dailyNutrition, json), units: nutritionUnits };
  },
});

export const getMenstrualCycleSummary = defineTool({
  name: "get_menstrual_cycle_summary",
  title: "Get menstrual cycle summary",
  description: "Read Garmin's menstrual or pregnancy cycle summary for a local calendar date.",
  input: z.strictObject({ calendarDate }),
  async execute(path, context) {
    const json = await garminClient.readJson("get_menstrual_cycle_summary", context, { path });
    return { data: project(menstrualCycleSummary, json), units: cycleUnits };
  },
});

export const getMenstrualCycleDay = defineTool({
  name: "get_menstrual_cycle_day",
  title: "Get menstrual cycle day",
  description: "Read a day of Garmin menstrual cycle tracking and optional pregnancy weight goals.",
  input: z.strictObject({
    calendarDate, todayDate: calendarDate.optional(), reducedResponse: z.boolean().default(false),
    skipbm: z.boolean().default(false), includeAnalysis: z.boolean().default(false),
  }),
  async execute({ calendarDate, ...query }, context) {
    const json = await garminClient.readJson("get_menstrual_cycle_day", context, { path: { calendarDate }, query });
    return {
      data: query.includeAnalysis ? project(menstrualCycleDayWithAnalysis, json) : project(menstrualCycleDay, json),
      units: { ...cycleUnits, duration: "s", highWeightGoalInGrams: "g", lowWeightGoalInGrams: "g", weekNum: "weeks" },
    };
  },
});

export const getSleepDay = defineTool({
  name: "get_sleep_day",
  title: "Get daily sleep",
  description: "Read Garmin sleep, nap and overnight sensor measurements for one calendar date.",
  input: z.strictObject({ date: calendarDate }),
  async execute(query, context) {
    const json = await garminClient.readJson("get_sleep_day", context, { query });
    return { data: project(dailySleep, json), units: sleepUnits };
  },
});

const sleepRange = z.array(dailySleep);

export const getSleepRange = defineTool({
  name: "get_sleep_range",
  title: "Get sleep range",
  description: "Read Garmin's daily sleep summaries across an inclusive range of up to 31 days.",
  input: z.strictObject({ startDate: calendarDate, endDate: calendarDate })
    .refine(({ startDate, endDate }) => withinInclusiveDays(startDate, endDate, 31)),
  sizeHint: "Try a smaller date range.",
  async execute(query, context) {
    const json = await garminClient.readJson("get_sleep_range", context, { query });
    return { data: project(sleepRange, json), units: sleepUnits };
  },
});

export const healthTools = [getProfileSettings, getNutritionDay, getMenstrualCycleSummary, getMenstrualCycleDay, getSleepDay, getSleepRange];
