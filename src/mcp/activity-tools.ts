import { z } from "zod";
import { garminClient } from "../garmin/client";
import { activityDetail, activityWorkouts, detailUnits, searchResults, searchUnits } from "./activity-projections";
import { activityIdInput, calendarDate, project, withinInclusiveDays } from "./garmin-schemas";
import { defineTool } from "./tools";

const activityType = z.object({
  key: z.string(),
  parent: z.string().nullable(),
});
const activityTypes = z.array(activityType);

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export const listActivityTypes = defineTool({
  name: "list_activity_types",
  title: "List activity types",
  description: "List the activity types supported by Garmin Connect.",
  input: z.strictObject({}),
  output: z.strictObject({ data: z.array(activityType.strict()), units: z.strictObject({}) }),
  async execute(_input, context) {
    const data = await garminClient.readJson("list_activity_types", context);
    return {
      data: project(activityTypes, data).sort((a, b) => compare(a.parent ?? "", b.parent ?? "") || compare(a.key, b.key)),
      units: {},
    };
  },
});

export const getActivity = defineTool({
  name: "get_activity",
  title: "Get activity details",
  description: "Read a Garmin activity by its decimal activity ID, including summary and split measurements.",
  input: activityIdInput,
  async execute(input, context) {
    const data = await garminClient.readJson("get_activity", context, { path: input });
    return { data: project(activityDetail, data), units: detailUnits };
  },
});

export const getActivityWorkouts = defineTool({
  name: "get_activity_workouts",
  title: "Get activity workouts",
  description: "Read the recorded workouts and their ordered steps for a Garmin activity.",
  input: activityIdInput,
  async execute(input, context) {
    const data = await garminClient.readJson("get_activity_workouts", context, { path: input });
    return { data: project(activityWorkouts, data), units: {} };
  },
});

const queryKey = z.string().min(1).max(127).regex(/^[A-Za-z0-9_]+$/);
const filterNumber = z.int().nonnegative().optional();
const latitude = z.number().min(-90).max(90).optional();
const longitude = z.number().min(-180).max(180).optional();
const searchArguments = z.strictObject({
  start: z.int32().nonnegative().default(0),
  limit: z.int().min(1).max(99).default(25),
  favorite: z.literal([-1, 0, 1]).default(-1),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  sortBy: queryKey.default("startLocal"),
  excludeChildren: z.boolean().default(true),
  search: z.string().min(1).max(512).optional(),
  activityType: queryKey.optional(),
  activitySubType: queryKey.optional(),
  eventType: queryKey.optional(),
  excludedActivitySubType: z.array(queryKey).max(100).optional(),
  requiredField: z.array(queryKey).max(100).optional(),
  startDate: calendarDate.optional(),
  endDate: calendarDate.optional(),
  minDistance: filterNumber, maxDistance: filterNumber,
  minDuration: filterNumber, maxDuration: filterNumber,
  minElapsedDuration: filterNumber, maxElapsedDuration: filterNumber,
  minElevation: filterNumber, maxElevation: filterNumber,
  lowerMaxDepth: filterNumber, upperMaxDepth: filterNumber,
  minBottomTime: filterNumber, maxBottomTime: filterNumber,
  minAvgPower: filterNumber,
  decoDive: z.boolean().optional(),
  upperLatitude: latitude, lowerLatitude: latitude, rightLongitude: longitude, leftLongitude: longitude,
});
const searchInput = searchArguments.refine(validSearchBounds, "The selected filters have invalid bounds.");

function validSearchBounds(input: z.output<typeof searchArguments>): boolean {
  const { startDate, endDate, activityType, activitySubType, upperLatitude, lowerLatitude, rightLongitude, leftLongitude } = input;
  if (startDate !== undefined && endDate !== undefined && !withinInclusiveDays(startDate, endDate, 366)) return false;
  if (activityType !== undefined && activityType === activitySubType) return false;

  const limits = [
    [input.minDistance, input.maxDistance], [input.minDuration, input.maxDuration],
    [input.minElapsedDuration, input.maxElapsedDuration], [input.minElevation, input.maxElevation],
    [input.lowerMaxDepth, input.upperMaxDepth], [input.minBottomTime, input.maxBottomTime],
  ];
  if (limits.some(([min, max]) => min !== undefined && max !== undefined && min > max)) return false;

  const box = [upperLatitude, lowerLatitude, rightLongitude, leftLongitude];
  if (box.every((side) => side === undefined)) return true;
  return upperLatitude !== undefined && lowerLatitude !== undefined && rightLongitude !== undefined && leftLongitude !== undefined
    && upperLatitude > lowerLatitude && rightLongitude > leftLongitude;
}

export const searchActivities = defineTool({
  name: "search_activities",
  title: "Search activities",
  description: "Search Garmin activities with optional filters, date bounds and offset pagination.",
  input: searchInput,
  sizeHint: "Try a smaller page size or date range.",
  async execute(input, context) {
    const json = await garminClient.readJson("search_activities", context, { query: input });
    const data = project(searchResults, json);
    return { data, units: searchUnits, nextStart: data.length === input.limit ? input.start + data.length : null };
  },
});
