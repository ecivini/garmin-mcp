import { z } from "zod";
import { GarminError, garminClient } from "../garmin/client";
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
    // Zod strips fields outside the projection before they can reach the MCP result.
    const parsed = activityTypes.safeParse(data);
    if (!parsed.success) throw new GarminError("garmin_unavailable");
    return {
      data: parsed.data.sort((a, b) => compare(a.parent ?? "", b.parent ?? "") || compare(a.key, b.key)),
      units: {},
    };
  },
});
