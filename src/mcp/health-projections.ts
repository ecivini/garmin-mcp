import { z } from "zod";
import { optionalFlag as flag, optionalNumber as number, optionalText as text, responseId } from "./garmin-schemas";

const format = z.object({
  formatId: number, formatKey: text, minFraction: number, maxFraction: number, groupingUsed: flag, displayFormat: text,
}).nullish();
const strings = z.array(z.string()).nullish();

export const profileSettings = z.object({
  displayName: text, preferredLocale: text, measurementSystem: text, timeZone: text, numberFormat: text,
  firstDayOfWeek: z.object({ dayId: number, dayName: text, sortOrder: number, isPossibleFirstDay: flag }).nullish(),
  timeFormat: format, dateFormat: format, powerFormat: format, heartRateFormat: format,
  hydrationMeasurementUnit: text, hydrationContainers: z.array(z.object({ name: text, volume: number, unit: text })).nullish(),
  glucoseMeasurementUnit: text, golfDistanceUnit: text, golfElevationUnit: text, golfSpeedUnit: text, wheelchairModeEnabled: flag,
  availableTrainingDays: strings, preferredLongTrainingDays: strings,
});

const localTime = z.object({ hour: number, minute: number, second: number, nano: number }).nullish();
const macros = { calories: number, carbs: number, protein: number, fat: number };
const thinNutrition = z.object({ ...macros, caloriesPercentage: number }).nullish();
const nutritionGoals = z.object({
  ...macros, adjustedCalories: number, adjustedCarbs: number, adjustedProtein: number, adjustedFat: number,
}).nullish();
const nutritionContent = z.object({
  ...macros, addedSugars: number, calcium: number, cholesterol: number, fiber: number, iron: number,
  monounsaturatedFat: number, polyunsaturatedFat: number, saturatedFat: number, transFat: number,
  potassium: number, sodium: number, sugar: number, vitaminA: number, vitaminC: number, vitaminD: number,
  numberOfUnits: number, servingId: text, servingUnit: text, unitHasServing: flag,
});
const foodMetadata = z.object({
  foodId: text, foodName: text, brandName: text, customFoodType: text, foodType: text,
  languageCode: text, regionCode: text, source: text,
}).nullish();
const meal = z.object({
  mealId: responseId.nullish(), mealName: text, defaultMealName: text, displayOrder: number, mealIndex: number,
  translated: flag, startTime: localTime, endTime: localTime, goals: nutritionGoals,
});

export const dailyNutrition = z.object({
  mealDate: text, dayStartTime: localTime, dayEndTime: localTime,
  dailyNutritionContent: thinNutrition, dailyNutritionGoals: nutritionGoals,
  loggedFoodsWithServingSizes: z.array(z.object({
    foodMetaData: foodMetadata, isFavorite: flag, nutritionContents: z.array(nutritionContent).nullish(),
  })).nullish(),
  mealDetails: z.array(z.object({
    meal: meal.nullish(), mealNutritionContent: thinNutrition, mealNutritionGoals: nutritionGoals,
    loggedFoods: z.array(z.object({
      customMealId: responseId.nullish(), mealId: responseId.nullish(), foodInactive: flag, isFavorite: flag,
      logCategory: text, logSource: text, logTimestamp: text, mealDateTimeWithOffset: text, mealTime: text,
      foodMetaData: foodMetadata, nutritionContent: nutritionContent.nullish(), servingQty: number, type: text,
    })).nullish(),
  })).nullish(),
});

export const nutritionUnits = {
  calories: "kcal", adjustedCalories: "kcal",
  carbs: "g", protein: "g", fat: "g", adjustedCarbs: "g", adjustedProtein: "g", adjustedFat: "g",
  fiber: "g", sugar: "g", addedSugars: "g",
  monounsaturatedFat: "g", polyunsaturatedFat: "g", saturatedFat: "g", transFat: "g",
  calcium: "mg", cholesterol: "mg", iron: "mg", potassium: "mg", sodium: "mg",
  vitaminA: "µg", vitaminC: "mg", vitaminD: "µg",
};

const connectDateTime = z.object({ date: text, localDate: text }).nullish();
const cycleAnalysis = z.object({
  perimenopauseDetected: flag,
  cycleTypeAnalysis: z.object({
    cycleLengthDeviationDays: number, cycleStartDate: connectDateTime, cycleType: text,
    cycleVariability: number, cycleVariabilityClassifier: text, follicularLengthDeviationDays: number,
    hasAmenorrhea: flag, isAtypical: flag, lutealLengthDeviationDays: number, medianCycleLength: number,
    medianCycleLengthClassifier: text, periodLengthDeviationDays: number,
    prolongedPeriods: number, prolongedPeriodsClassifier: text,
  }).nullish(),
});

export const menstrualCycleSummary = z.object({
  currentPhase: number, cycleType: text, dayInCycle: number,
  daysUntilNextPhase: number, deliveryDate: connectDateTime, dueDate: connectDateTime,
  endDate: connectDateTime, feedbackPhrase: text, fertileWindowStart: number,
  isSkinTempMct: flag, lengthOfCurrentPhase: number, lengthOfFertileWindow: number,
  lutealPhaseStart: number, numberOfWeek: number, periodLength: number,
  predictedCycle: flag, predictedCycleLength: number, predictedOvulationDate: connectDateTime,
  pregnancyCycle: flag, startDate: connectDateTime,
  overlapCycleList: z.array(z.object({ periodLength: number, startDate: connectDateTime })).nullish(),
});

export const menstrualCycleDay = z.object({
  daySummary: menstrualCycleSummary.nullish(),
  dayLog: z.object({
    calendarDate: connectDateTime, reportTimestamp: connectDateTime,
    discharge: strings, flow: text, moods: strings, symptoms: strings, hasBabyMovement: flag,
    hasGlucoseLog: flag, ovulationDay: flag, sexDrive: text, sexualActivity: text,
    babyMovements: z.array(z.object({
      count: number, duration: number, movementType: text, startTimestamp: connectDateTime,
    })).nullish(),
  }).nullish(),
  weightGoals: z.object({ highWeightGoalInGrams: number, lowWeightGoalInGrams: number, weekNum: number }).nullish(),
});

export const menstrualCycleDayWithAnalysis = menstrualCycleDay.extend({
  daySummary: menstrualCycleSummary.extend({ analysis: cycleAnalysis.nullish() }).nullish(),
});

export const cycleUnits = {
  dayInCycle: "days", daysUntilNextPhase: "days", lengthOfCurrentPhase: "days", lengthOfFertileWindow: "days",
  numberOfWeek: "weeks", periodLength: "days", predictedCycleLength: "days", cycleLengthDeviationDays: "days",
  follicularLengthDeviationDays: "days", lutealLengthDeviationDays: "days", medianCycleLength: "days", periodLengthDeviationDays: "days",
};

const timestamp = z.union([z.number(), z.string()]).nullish();
const sleepScore = z.object({
  value: number, qualifierKey: text, optimalStart: number, optimalEnd: number,
  idealStartInSeconds: number, idealEndInSeconds: number,
}).nullish();
const sleepScores = z.object({
  overall: sleepScore, totalDuration: sleepScore, stress: sleepScore, awakeCount: sleepScore,
  remPercentage: sleepScore, lightPercentage: sleepScore, deepPercentage: sleepScore, restlessness: sleepScore,
  rem: sleepScore, light: sleepScore, deep: sleepScore, awakenings: sleepScore,
});
const nap = z.object({
  calendarDate: text, napTimeSec: number, napStartTimestampGMT: timestamp, napEndTimestampGMT: timestamp,
  napFeedback: text, napSource: number, napStartTimeOffset: number, napEndTimeOffset: number,
  createTimestampGMT: timestamp, updateTimestampGMT: timestamp,
});
const sleepNeed = z.object({
  calendarDate: text, baseline: number, actual: number, feedback: text, trainingFeedback: text, sleepHistoryAdjustment: text,
  hrvAdjustment: text, napAdjustment: text, displayedForTheDay: flag,
  recommendedBedtimeStartMins: number, recommendedBedtimeEndMins: number,
}).nullish();

export const dailySleep = z.object({
  calendarDate: text, sleepTimeSeconds: number, napTimeSeconds: number,
  sleepWindowConfirmed: flag, sleepWindowConfirmationType: text,
  sleepStartTimestampGMT: timestamp, sleepEndTimestampGMT: timestamp,
  sleepStartTimestampLocal: timestamp, sleepEndTimestampLocal: timestamp,
  autoSleepStartTimestampGMT: timestamp, autoSleepEndTimestampGMT: timestamp,
  sleepQualityTypePK: text, sleepResultTypePK: text, unmeasurableSleepSeconds: number,
  deepSleepSeconds: number, lightSleepSeconds: number, remSleepSeconds: number, awakeSleepSeconds: number,
  deviceRemCapable: flag, sleepFromDevice: flag, averageSpO2Value: number, lowestSpO2Value: number,
  highestSpO2Value: number, numberOfEventsBelowThreshold: number, averageSpO2HRSleep: number, spo2Threshold: number,
  averageRespirationValue: number, lowestRespirationValue: number, highestRespirationValue: number,
  awakeCount: number, avgSleepStress: number, avgHeartRate: number, sleepScoreFeedback: text, sleepScoreInsight: text,
  sleepScorePersonalizedInsight: text, sleepScores: sleepScores.nullish(),
  sleepNeed, nextSleepNeed: sleepNeed, dailyNapDTOS: z.array(nap).nullish(), breathingDisruptionSeverity: text,
  sleepAlignment: z.object({
    calendarDate: text, sleepNeedBaselineMins: number, optimalSleepWindowStartMins: number,
    optimalSleepWindowEndMins: number, status: text, optimalSleepWindowMidpointMins: number, lastSleepMidpointMins: number,
  }).nullish(),
});

export const sleepUnits = {
  sleepTimeSeconds: "s", napTimeSeconds: "s", napTimeSec: "s", unmeasurableSleepSeconds: "s",
  deepSleepSeconds: "s", lightSleepSeconds: "s", remSleepSeconds: "s", awakeSleepSeconds: "s",
  sleepStartTimestampGMT: "ms", sleepEndTimestampGMT: "ms", sleepStartTimestampLocal: "ms", sleepEndTimestampLocal: "ms",
  averageSpO2Value: "%", lowestSpO2Value: "%", highestSpO2Value: "%", spo2Threshold: "%",
  avgHeartRate: "bpm", averageSpO2HRSleep: "bpm", "sleepScores.*.value": "0–100",
  idealStartInSeconds: "s", idealEndInSeconds: "s", napStartTimeOffset: "min", napEndTimeOffset: "min",
  recommendedBedtimeStartMins: "min", recommendedBedtimeEndMins: "min",
  sleepNeedBaselineMins: "min", optimalSleepWindowStartMins: "min", optimalSleepWindowEndMins: "min",
  optimalSleepWindowMidpointMins: "min", lastSleepMidpointMins: "min",
};
