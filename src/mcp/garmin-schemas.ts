import { z } from "zod";
import { GarminError, isGarminId } from "../garmin/client";

export const garminId = z.string().max(19).regex(/^[1-9]\d*$/).refine(isGarminId);
export const activityIdInput = z.strictObject({ activityId: garminId });

export const responseId = z.union([garminId, z.int().positive()]).transform(String);
export const calendarDate = z.iso.date().refine((value) => !value.startsWith("0000-"));
const dayMs = 86_400_000;

export function withinInclusiveDays(start: string, end: string, limit: number): boolean {
  const interval = Date.parse(end) - Date.parse(start);
  return interval >= 0 && interval < limit * dayMs;
}

export const optionalNumber = z.number().nullish();
export const optionalText = z.string().nullish();
export const optionalFlag = z.boolean().nullish();
export const connectDateTime = z.object({ date: optionalText, localDate: optionalText }).nullish();

export function project<Schema extends z.ZodType>(schema: Schema, data: unknown): z.output<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) throw new GarminError("garmin_unavailable");
  return result.data;
}
