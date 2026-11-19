import { z } from "zod";
import {
  connectDateTime, optionalFlag as flag, optionalNumber as number, optionalText as text, responseId,
} from "./garmin-schemas";

export const hydrationDays = z.array(z.object({
  calendarDate: text, valueInML: number, goalInML: number, sweatLossInML: number,
  activityIntakeInML: number, lastEntryTimestampLocal: text,
}));
export const stepDays = z.array(z.object({ calendarDate: text, totalSteps: number, totalDistance: number, stepGoal: number }));
export const stressDays = z.array(z.object({
  calendarDate: text,
  values: z.object({
    overallStressLevel: number, highStressDuration: number, mediumStressDuration: number,
    lowStressDuration: number, restStressDuration: number,
  }).nullish(),
}));

export const bodyBatteryFeedback = z.object({
  eventTimestampGmt: text, bodyBatteryLevel: text, feedbackShortType: text, feedbackLongType: text,
}).nullish();
export const bodyBatteryEvent = z.object({
  eventType: text, eventStartTimeGmt: text, timezoneOffset: number, durationInMilliseconds: number,
  bodyBatteryImpact: number, feedbackType: text, shortFeedback: text,
});

export const wellnessDay = z.object({
  calendarDate: text,
  totalKilocalories: number, activeKilocalories: number, bmrKilocalories: number, consumedKilocalories: number,
  remainingKilocalories: number, netCalorieGoal: number,
  totalSteps: number, dailyStepGoal: number, dailyPushesGoal: number, totalPushDistance: number, totalPushes: number,
  totalDistanceMeters: number, wellnessDistanceMeters: number, floorsAscendedInMeters: number,
  floorsDescendedInMeters: number, floorsAscended: number, floorsDescended: number, userFloorsAscendedGoal: number,
  wellnessStartTimeGmt: text, wellnessStartTimeLocal: text, wellnessEndTimeGmt: text, wellnessEndTimeLocal: text,
  durationInMilliseconds: number, highlyActiveSeconds: number, activeSeconds: number, sedentarySeconds: number, sleepingSeconds: number,
  includesWellnessData: flag, includesActivityData: flag, includesCalorieConsumedData: flag,
  moderateIntensityMinutes: number, vigorousIntensityMinutes: number, intensityMinutesGoal: number,
  minHeartRate: number, maxHeartRate: number, restingHeartRate: number, lastSevenDaysAvgRestingHeartRate: number,
  minAvgHeartRate: number, maxAvgHeartRate: number, abnormalHeartRateAlertsCount: number,
  averageStressLevel: number, maxStressLevel: number, stressDuration: number, restStressDuration: number,
  activityStressDuration: number, uncategorizedStressDuration: number, totalStressDuration: number,
  lowStressDuration: number, mediumStressDuration: number, highStressDuration: number,
  stressPercentage: number, restStressPercentage: number, activityStressPercentage: number, uncategorizedStressPercentage: number,
  lowStressPercentage: number, mediumStressPercentage: number, highStressPercentage: number, stressQualifier: text,
  measurableAwakeDuration: number, measurableAsleepDuration: number, lastSyncTimestampGMT: text,
  bodyBatteryChargedValue: number, bodyBatteryDrainedValue: number, bodyBatteryHighestValue: number,
  bodyBatteryLowestValue: number, bodyBatteryMostRecentValue: number, bodyBatteryDuringSleep: number, bodyBatteryAtWakeTime: number,
  bodyBatteryDynamicFeedbackEvent: bodyBatteryFeedback, endOfDayBodyBatteryDynamicFeedbackEvent: bodyBatteryFeedback,
  bodyBatteryActivityEventList: z.array(bodyBatteryEvent).nullish(),
  averageSpo2: number, lowestSpo2: number, latestSpo2: number, latestSpo2ReadingTimeGmt: text, latestSpo2ReadingTimeLocal: text,
  averageMonitoringEnvironmentAltitude: number, hydrationValueInML: number, hydrationGoalInML: number,
});

export const wellnessDayUnits = {
  totalKilocalories: "kcal", activeKilocalories: "kcal", bmrKilocalories: "kcal", consumedKilocalories: "kcal",
  remainingKilocalories: "kcal", netCalorieGoal: "kcal",
  totalDistanceMeters: "m", wellnessDistanceMeters: "m", totalPushDistance: "m", floorsAscendedInMeters: "m", floorsDescendedInMeters: "m",
  durationInMilliseconds: "ms", highlyActiveSeconds: "s", activeSeconds: "s", sedentarySeconds: "s", sleepingSeconds: "s",
  moderateIntensityMinutes: "min", vigorousIntensityMinutes: "min", intensityMinutesGoal: "min",
  minHeartRate: "bpm", maxHeartRate: "bpm", restingHeartRate: "bpm",
  lastSevenDaysAvgRestingHeartRate: "bpm", minAvgHeartRate: "bpm", maxAvgHeartRate: "bpm",
  stressDuration: "s", restStressDuration: "s", activityStressDuration: "s", uncategorizedStressDuration: "s",
  totalStressDuration: "s", lowStressDuration: "s", mediumStressDuration: "s", highStressDuration: "s",
  stressPercentage: "%", restStressPercentage: "%", activityStressPercentage: "%", uncategorizedStressPercentage: "%",
  lowStressPercentage: "%", mediumStressPercentage: "%", highStressPercentage: "%",
  measurableAwakeDuration: "s", measurableAsleepDuration: "s",
  averageSpo2: "%", lowestSpo2: "%", latestSpo2: "%",
  hydrationValueInML: "mL", hydrationGoalInML: "mL",
};

const movementValue = z.object({ goal: number, value: number, distanceInMeters: number }).nullish();
const wellnessV2 = z.object({
  calendarDate: text, includesWellnessData: flag, includesActivityData: flag,
  wellnessChronology: z.object({
    startTimestampGmt: text, startTimestampLocal: text, endTimestampGmt: text, endTimestampLocal: text, totalDurationInMillis: number,
  }).nullish(),
  movement: z.object({ steps: movementValue, pushes: movementValue, floorsAscended: movementValue, floorsDescended: movementValue }).nullish(),
  calories: z.object({
    burnedResting: number, burnedActive: number, burnedTotal: number, consumedGoal: number, consumedValue: number, consumedRemaining: number,
  }).nullish(),
  heartRate: z.object({ minValue: number, maxValue: number, restingValue: number, alertCount: number }).nullish(),
  intensityMinutes: z.object({ goal: number, moderate: number, vigorous: number }).nullish(),
  stress: z.object({
    avgLevel: number, maxLevel: number, restProportion: number, activityProportion: number, uncategorizedProportion: number,
    lowStressProportion: number, mediumStressProportion: number, highStressProportion: number, qualifier: text,
    totalDurationInMillis: number, restDurationInMillis: number, activityDurationInMillis: number, uncategorizedDurationInMillis: number,
    lowStressDurationInMillis: number, mediumStressDurationInMillis: number, highStressDurationInMillis: number,
  }).nullish(),
  bodyBattery: z.object({
    minValue: number, maxValue: number, chargedValue: number, drainedValue: number, latestValue: number, endOfDayValue: number,
    featureVersion: text, dynamicFeedbackEvent: bodyBatteryFeedback, endOfDayDynamicFeedbackEvent: bodyBatteryFeedback,
    activityEvents: z.array(z.object({
      eventType: text, eventStartTimeGmt: text, eventStartTimeLocal: text, bodyBatteryImpact: number, feedbackType: text,
      shortFeedback: text, activityName: text, activityType: text, activityId: responseId.nullish(), durationInMillis: number,
    })).nullish(),
  }).nullish(),
  hydration: z.object({ goalInMl: number, goalInFractionalMl: number, consumedInFractionalMl: number }).nullish(),
  respiration: z.object({ avgValue: number, maxValue: number, minValue: number, latestValue: number, latestTimestampGmt: text }).nullish(),
  pulseOx: z.object({
    avgValue: number, minValue: number, latestValue: number, latestTimestampGmt: text,
    latestTimestampLocal: text, avgAltitudeInMeters: number,
  }).nullish(),
});

export const wellnessRange = z.object({ data: z.array(wellnessV2) });
export const wellnessV2Units = {
  "wellnessChronology.totalDurationInMillis": "ms", "movement.*.distanceInMeters": "m",
  "calories.burnedResting": "kcal", "calories.burnedActive": "kcal", "calories.burnedTotal": "kcal",
  "calories.consumedGoal": "kcal", "calories.consumedValue": "kcal", "calories.consumedRemaining": "kcal",
  "heartRate.minValue": "bpm", "heartRate.maxValue": "bpm", "heartRate.restingValue": "bpm",
  "intensityMinutes.goal": "min", "intensityMinutes.moderate": "min", "intensityMinutes.vigorous": "min",
  "stress.totalDurationInMillis": "ms", "stress.restDurationInMillis": "ms", "stress.activityDurationInMillis": "ms",
  "stress.uncategorizedDurationInMillis": "ms", "stress.lowStressDurationInMillis": "ms",
  "stress.mediumStressDurationInMillis": "ms", "stress.highStressDurationInMillis": "ms",
  "bodyBattery.activityEvents.*.durationInMillis": "ms",
  "hydration.goalInMl": "mL", "hydration.goalInFractionalMl": "mL", "hydration.consumedInFractionalMl": "mL",
  "respiration.avgValue": "breaths/min", "respiration.maxValue": "breaths/min",
  "respiration.minValue": "breaths/min", "respiration.latestValue": "breaths/min",
  "pulseOx.avgValue": "%", "pulseOx.minValue": "%", "pulseOx.latestValue": "%", "pulseOx.avgAltitudeInMeters": "m",
};

const activityMetricUnits = {
  HEART_RATE: "bpm", WRIST_HEART_RATE: "bpm", STRESS: "Garmin score",
  RESPIRATION: "breaths/min", SPO2: "%", RMSSD_HRV: "ms", SDRR_HRV: "ms",
};
const wellnessMetric = z.object({ summaryType: z.string(), minValue: number, maxValue: number, avgValue: number });
const wellnessMetrics = z.array(wellnessMetric)
  .transform((items) => items.filter(({ summaryType }) => Object.hasOwn(activityMetricUnits, summaryType))).nullish();
export const wellnessActivities = z.array(z.object({
  activityName: text, wellnessActivityType: text, calendarDate: connectDateTime,
  startTimestampGMT: connectDateTime, endTimestampGMT: connectDateTime,
  startTimestampLocal: connectDateTime, endTimestampLocal: connectDateTime,
  summaryTypeDataList: wellnessMetrics,
  timeInZoneList: z.array(z.object({ zoneNumber: number, millisInZone: number, zoneLowBoundary: number })).nullish(),
}));

export const wellnessActivityUnits = { ...activityMetricUnits, millisInZone: "ms" };
