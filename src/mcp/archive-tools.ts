import { z } from "zod";
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
