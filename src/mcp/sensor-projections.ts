import { z } from "zod";
import { GarminError } from "../garmin/client";
import { connectDateTime, optionalNumber as number, optionalText as text, project } from "./garmin-schemas";
import { bodyBatteryEvent, bodyBatteryFeedback } from "./wellness-projections";

const rawRows = z.array(z.array(z.unknown())).nullish();
const sampleIndex = z.int32().nonnegative();
const sampleKey = z.string();
const numericCell = z.number().nullable();
const textCell = z.union([z.number(), z.string(), z.null()]);
type Cell = z.output<typeof textCell>;
type Columns = Readonly<Record<string, z.ZodType<Cell>>>;

/** Preserve Garmin's native column indexes while masking columns outside the tool's projection. */
function projectSeries<Descriptor>(
  rows: unknown[][] | null | undefined,
  descriptors: Descriptor[] | null | undefined,
  column: (descriptor: Descriptor) => readonly [index: number, key: string],
  allowed: Columns,
) {
  const seen = new Set<number>();
  const columns = new Map<number, z.ZodType<Cell>>();
  const retained = descriptors?.filter((descriptor) => {
    const [index, key] = column(descriptor);
    if (seen.has(index)) throw new GarminError("garmin_unavailable");
    seen.add(index);
    if (!Object.hasOwn(allowed, key)) return false;
    columns.set(index, allowed[key]);
    return true;
  }) ?? descriptors;

  if (!rows?.length) return { rows, descriptors: retained };
  if (!columns.size) return { rows: undefined, descriptors: retained };
  return {
    rows: rows.map((row) => row.map((value, index) => {
      const schema = columns.get(index);
      return schema ? project(schema, value) : null;
    })),
    descriptors: retained,
  };
}

const bodyBatteryRaw = z.object({
  date: text, charged: number, drained: number,
  startTimestampGMT: text, endTimestampGMT: text, startTimestampLocal: text, endTimestampLocal: text,
  bodyBatteryDynamicFeedbackEvent: bodyBatteryFeedback, endOfDayBodyBatteryDynamicFeedbackEvent: bodyBatteryFeedback,
  bodyBatteryActivityEvent: z.array(bodyBatteryEvent).nullish(),
  bodyBatteryValuesArray: rawRows,
  bodyBatteryValueDescriptorDTOList: z.array(z.object({
    bodyBatteryValueDescriptorIndex: sampleIndex, bodyBatteryValueDescriptorKey: sampleKey,
  })).nullish(),
});
const batteryColumns = {
  timestamp: textCell, bodyBatteryLevel: numericCell, bodyBatteryStatus: textCell, bodyBatteryVersion: textCell,
};
export const bodyBatteryDays = z.array(bodyBatteryRaw).transform((reports) => reports.map((report) => {
  const series = projectSeries(report.bodyBatteryValuesArray, report.bodyBatteryValueDescriptorDTOList,
    (item) => [item.bodyBatteryValueDescriptorIndex, item.bodyBatteryValueDescriptorKey], batteryColumns);
  return { ...report, bodyBatteryValuesArray: series.rows, bodyBatteryValueDescriptorDTOList: series.descriptors };
}));

const spo2Raw = z.object({
  calendarDate: text, startTimestampGMT: text, endTimestampGMT: text, startTimestampLocal: text, endTimestampLocal: text,
  sleepStartTimestampGMT: text, sleepEndTimestampGMT: text, sleepStartTimestampLocal: text, sleepEndTimestampLocal: text,
  tomorrowSleepStartTimestampGMT: text, tomorrowSleepEndTimestampGMT: text,
  tomorrowSleepStartTimestampLocal: text, tomorrowSleepEndTimestampLocal: text,
  averageSpO2: number, lowestSpO2: number, lastSevenDaysAvgSpO2: number, latestSpO2: number,
  latestSpO2TimestampGMT: text, latestSpO2TimestampLocal: text, avgSleepSpO2: number, avgTomorrowSleepSpO2: number,
  spO2SingleValues: rawRows, spO2HourlyAverages: rawRows, monitoringEnvironmentValues: rawRows,
  spO2SingleValuesDescriptorList: z.array(z.object({
    spo2ValueDescriptorIndex: sampleIndex, spo2ValueDescriptorKey: sampleKey,
  })).nullish(),
  spO2HourlyAveragesDescriptorList: z.array(z.object({
    spo2ValueDescIndex: sampleIndex, spo2ValueDescKey: sampleKey,
  })).nullish(),
  monitoringEnvironmentValuesDescriptorList: z.array(z.object({
    monEnvValueDescIndex: sampleIndex, monEnvValueDescKey: sampleKey,
  })).nullish(),
});
const spo2Columns = { timestamp: textCell, spo2Level: numericCell, spo2Value: numericCell };
const monitoringColumns = { timestamp: textCell, monitoringEnvironmentLevel: textCell };
export const spo2Day = spo2Raw.transform((report) => {
  const single = projectSeries(report.spO2SingleValues, report.spO2SingleValuesDescriptorList,
    (item) => [item.spo2ValueDescriptorIndex, item.spo2ValueDescriptorKey], spo2Columns);
  const hourly = projectSeries(report.spO2HourlyAverages, report.spO2HourlyAveragesDescriptorList,
    (item) => [item.spo2ValueDescIndex, item.spo2ValueDescKey], { ...spo2Columns, ...monitoringColumns });
  const environment = projectSeries(report.monitoringEnvironmentValues, report.monitoringEnvironmentValuesDescriptorList,
    (item) => [item.monEnvValueDescIndex, item.monEnvValueDescKey], monitoringColumns);
  return {
    ...report,
    spO2SingleValues: single.rows, spO2SingleValuesDescriptorList: single.descriptors,
    spO2HourlyAverages: hourly.rows, spO2HourlyAveragesDescriptorList: hourly.descriptors,
    monitoringEnvironmentValues: environment.rows, monitoringEnvironmentValuesDescriptorList: environment.descriptors,
  };
});

const heartRateRaw = z.object({
  calendarDate: connectDateTime, startTimestampGMT: connectDateTime, endTimestampGMT: connectDateTime,
  startTimestampLocal: connectDateTime, endTimestampLocal: connectDateTime,
  maxHeartRate: number, minHeartRate: number, restingHeartRate: number, lastSevenDaysAvgRestingHeartRate: number,
  abnormalHrThresholdValue: number, lowAbnormalHrThresholdValue: number,
  heartRateValues: rawRows,
  heartRateValueDescriptors: z.array(z.object({ index: sampleIndex, key: sampleKey })).nullish(),
});
const heartRateColumns = { timestamp: textCell, heartRate: numericCell, heartRateValue: numericCell };
export const heartRateDay = heartRateRaw.transform((report) => {
  const pullColumn = (item: { index: number; key: string }) => [item.index, item.key] as const;
  const series = projectSeries(report.heartRateValues, report.heartRateValueDescriptors, pullColumn, heartRateColumns);
  return { ...report, heartRateValues: series.rows, heartRateValueDescriptors: series.descriptors };
});
