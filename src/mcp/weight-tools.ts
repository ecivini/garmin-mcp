import { z } from "zod";
import { garminClient } from "../garmin/client";
import { calendarDate, connectDateTime, optionalNumber as number, optionalText as text, project, withinInclusiveDays } from "./garmin-schemas";
import { defineTool } from "./tools";

const period = z.strictObject({ startDate: calendarDate, endDate: calendarDate });
const validPeriod = ({ startDate, endDate }: z.output<typeof period>) => withinInclusiveDays(startDate, endDate, 31);
const boundedPeriod = period.refine(validPeriod);
const rangeHint = "Try a smaller date range.";

const goal = {
  userGoalCategory: text, userGoalType: text, startDate: connectDateTime, endDate: connectDateTime, trackingPeriodType: text,
};
const weightGoals = z.object({
  userGoals: z.array(z.object({
    ...goal, goalName: text, goalValue: number, updateDate: connectDateTime, createDate: connectDateTime,
  })).nullish(),
  userGoalRanges: z.array(z.object({
    ...goal, lowWeightGoalInGrams: number, highWeightGoalInGrams: number, weekNum: number,
  })).nullish(),
});

export const getWeightGoals = defineTool({
  name: "get_weight_goals",
  title: "Get weight goals",
  description: "Read Garmin weight goals and effective target ranges across an inclusive range of up to 31 days.",
  input: boundedPeriod,
  sizeHint: rangeHint,
  async execute(path, context) {
    const json = await garminClient.readJson("get_weight_goals", context, { path });
    return {
      data: project(weightGoals, json),
      units: { goalValue: "g", lowWeightGoalInGrams: "g", highWeightGoalInGrams: "g", weekNum: "weeks" },
    };
  },
});

const bodyComposition = {
  weight: number, bmi: number, bodyFat: number, bodyWater: number, boneMass: number, muscleMass: number,
  physiqueRating: number, visceralFat: number, metabolicAge: number,
};
const weightEntry = z.object({
  ...bodyComposition, date: number, calendarDate: text, timestampGMT: number, weightDelta: number,
});
const weightEntries = z.array(weightEntry);
const weightUnits = { weight: "kg", bmi: "kg/m²", bodyFat: "%", bodyWater: "%", date: "ms", timestampGMT: "ms" };

export const getWeightEntries = defineTool({
  name: "get_weight_entries",
  title: "Get weight entries",
  description: "Read every Garmin weight and body composition entry across an inclusive local date range of up to 31 days.",
  input: boundedPeriod,
  sizeHint: rangeHint,
  async execute(path, context) {
    const json = await garminClient.readJson("get_weight_entries", context, { path });
    return { data: project(weightEntries, json), units: weightUnits };
  },
});

const dailySummary = z.object({
  summaryDate: text, numOfWeightEntries: number, minWeight: number, maxWeight: number, latestWeight: weightEntry.nullish(),
});
const dailySummaryWithEntries = dailySummary.extend({ allWeightMetrics: weightEntries.nullish() });
const weightRange = z.object({
  dailyWeightSummaries: z.array(dailySummary).nullish(),
  totalAverage: z.object({ ...bodyComposition, from: number, until: number }).nullish(),
  previousDateWeight: weightEntry.nullish(), nextDateWeight: weightEntry.nullish(),
});
const weightRangeWithEntries = weightRange.extend({ dailyWeightSummaries: z.array(dailySummaryWithEntries).nullish() });

export const getWeightRange = defineTool({
  name: "get_weight_range",
  title: "Get weight summaries",
  description: "Read summaries, averages and adjacent Garmin weight readings for an inclusive local date range of up to 31 days.",
  input: period.extend({ includeAll: z.boolean().default(false) }).refine(validPeriod),
  sizeHint: rangeHint,
  async execute({ startDate, endDate, includeAll }, context) {
    const json = await garminClient.readJson("get_weight_range", context, { path: { startDate, endDate }, query: { includeAll } });
    return {
      data: includeAll ? project(weightRangeWithEntries, json) : project(weightRange, json),
      units: { ...weightUnits, minWeight: "kg", maxWeight: "kg", from: "ms", until: "ms" },
    };
  },
});

export const weightTools = [getWeightGoals, getWeightEntries, getWeightRange];
