import { z } from "zod";
import { optionalFlag as flag, optionalNumber as number, optionalText as text, responseId } from "./garmin-schemas";

const type = z.object({ typeId: number, typeKey: text, parentTypeId: number });
const event = z.object({ typeId: number, typeKey: text });
const detailMetrics = {
  startTimeLocal: text, startTimeGMT: text,
  distance: number, duration: number, movingDuration: number, elapsedDuration: number,
  elevationGain: number, elevationLoss: number, maxElevation: number, minElevation: number, avgElevation: number,
  averageSpeed: number, averageMovingSpeed: number, maxSpeed: number,
  calories: number, bmrCalories: number, totalWork: number, averageHR: number, maxHR: number, minHR: number,
  averageRunCadence: number, maxRunCadence: number, maxLapAvgRunCadence: number,
  averageBikeCadence: number, maxBikeCadence: number, averageSwimCadence: number, maxSwimCadence: number,
  averagePower: number, maxPower: number, minPower: number, normalizedPower: number, functionalThresholdPower: number,
  groundContactTime: number, strideLength: number, verticalOscillation: number,
  trainingEffect: number, anaerobicTrainingEffect: number, trainingStressScore: number, intensityFactor: number,
  trainingEffectLabel: text, aerobicTrainingEffectMessage: text, anaerobicTrainingEffectMessage: text,
  steps: number, floorsClimbed: number, floorsDescended: number,
  totalNumberOfStrokes: number, averageSWOLF: number, minSWOLF: number,
  maxDepth: number, averageDepth: number, bottomTime: number, maxBottomTime: number, isDecoDive: flag,
  avgSpo2: number, minSpo2: number, maxSpo2: number,
};
const split = z.object({
  ...detailMetrics, messageIndex: number, splitType: text, noOfSplits: number,
});

export const activityDetail = z.object({
  activityId: responseId,
  parentId: responseId.nullish(),
  activityName: text,
  isMultiSportParent: flag,
  activityTypeDTO: type.nullish(),
  eventTypeDTO: event.nullish(),
  timeZoneUnitDTO: z.object({ timeZone: text, unitKey: text }).nullish(),
  metadataDTO: z.object({
    isOriginal: flag, fileFormat: z.object({ formatId: number, formatKey: text }).nullish(),
    lapCount: number, favorite: flag, personalRecord: flag, manualActivity: flag,
  }).nullish(),
  summaryDTO: z.object(detailMetrics).nullish(),
  splitSummaries: z.array(split).nullish(),
});

const workoutStep = z.object({
  stepIndex: number, name: text, intensity: text, notes: text,
  durationType: text, durationValue: number, targetType: text,
  targetValue: number, targetValueLow: number, targetValueHigh: number,
  equipmentType: text, exerciseCategory: text, exerciseName: text, exerciseWeightValue: number, weightDisplayUnit: text,
});

export const activityWorkouts = z.array(z.object({
  index: number, workoutName: text, timeCreated: text,
  sport: text, multisportSet: number, workoutPhrase: text, steps: z.array(workoutStep).nullish(),
}));

export const searchResults = z.array(z.object({
  activityId: responseId, parentId: responseId.nullish(), activityName: text,
  startTimeGMT: text, startTimeLocal: text, endTimeGMT: text, beginTimestamp: number,
  activityType: type.nullish(), eventType: event.nullish(), isFavorite: flag, favorite: flag,
  elapsedDuration: number, duration: number, movingDuration: number, distance: number,
  elevationGain: number, elevationLoss: number, averageSpeed: number, maxSpeed: number,
  calories: number, bmrCalories: number, averageHR: number, maxHR: number,
  averageRunningCadenceInStepsPerMinute: number, maxRunningCadenceInStepsPerMinute: number,
  averageBikingCadenceInRevPerMinute: number, maxBikingCadenceInRevPerMinute: number,
  averageSwimCadenceInStrokesPerMinute: number, maxSwimCadenceInStrokesPerMinute: number,
  avgPower: number, maxPower: number, steps: number,
  aerobicTrainingEffect: number, anaerobicTrainingEffect: number, trainingEffectLabel: text,
  splitSummaries: z.array(z.object({
    splitType: text, noOfSplits: number, distance: number, duration: number,
    maxSpeed: number, averageSpeed: number, totalAscent: number, elevationLoss: number,
  })).nullish(),
}));

const commonUnits = {
  distance: "m", elevationGain: "m", elevationLoss: "m",
  duration: "s", elapsedDuration: "s", movingDuration: "s",
  averageSpeed: "m/s", maxSpeed: "m/s",
  calories: "kcal", bmrCalories: "kcal", averageHR: "bpm", maxHR: "bpm", maxPower: "W",
};

export const detailUnits = {
  ...commonUnits,
  averageMovingSpeed: "m/s", maxElevation: "m", minElevation: "m", avgElevation: "m",
  minHR: "bpm", averagePower: "W", minPower: "W", normalizedPower: "W", functionalThresholdPower: "W",
  totalWork: "kcal", averageRunCadence: "steps/min", maxRunCadence: "steps/min", maxLapAvgRunCadence: "steps/min",
  averageBikeCadence: "rev/min", maxBikeCadence: "rev/min",
  averageSwimCadence: "strokes/min", maxSwimCadence: "strokes/min",
  maxDepth: "m", averageDepth: "m", bottomTime: "s", maxBottomTime: "s",
  avgSpo2: "%", minSpo2: "%", maxSpo2: "%",
};

export const searchUnits = {
  ...commonUnits,
  beginTimestamp: "ms", avgPower: "W",
  averageRunningCadenceInStepsPerMinute: "steps/min", maxRunningCadenceInStepsPerMinute: "steps/min",
  averageBikingCadenceInRevPerMinute: "rev/min", maxBikingCadenceInRevPerMinute: "rev/min",
  averageSwimCadenceInStrokesPerMinute: "strokes/min", maxSwimCadenceInStrokesPerMinute: "strokes/min",
};
