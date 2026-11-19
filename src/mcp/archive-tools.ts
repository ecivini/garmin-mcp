import { z } from "zod";
import { analyzeFitActivity } from "../archive/fit";
import { issueDownloadTicket } from "../security/download-auth";
import { activityIdInput, garminId } from "./garmin-schemas";
import { defineTool } from "./tools";

export const downloadActivity = defineTool({
  name: "download_activity",
  title: "Download original activity",
  description: "Create a short-lived link to download the original activity ZIP after signing in in a browser.",
  input: activityIdInput,
  output: z.strictObject({ activityId: garminId, url: z.url(), expiresAt: z.iso.datetime() }),
  async execute({ activityId }, context) {
    const ticket = await issueDownloadTicket(context.identity, activityId);
    return { activityId, ...ticket };
  },
});

export const analyzeActivityFit = defineTool({
  name: "analyze_activity_fit",
  title: "Analyze activity FIT data",
  description: "Summarize sessions and a page of laps from the original Garmin activity ZIP.",
  input: activityIdInput.extend({
    lapOffset: z.int().nonnegative().default(0),
    lapLimit: z.int().min(1).max(50).default(25),
  }),
  timeoutMs: 30_000,
  sizeHint: "Try a smaller lap page.",
  async execute({ activityId, ...pagination }, context) {
    return analyzeFitActivity(activityId, pagination, context);
  },
});
