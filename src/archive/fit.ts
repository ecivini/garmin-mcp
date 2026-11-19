import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { GarminError, garminClient, type GarminRequestContext } from "../garmin/client";

const compressedLimit = 16 * 1024 * 1024;
type LapPage = Readonly<{ lapOffset: number; lapLimit: number }>;
type Summary = {
  sessions: Record<string, unknown>[];
  laps: Record<string, unknown>[];
  totalLaps: number;
  nextLapOffset: number | null;
};
type WorkerReply =
  | { ok: true; result: Summary }
  | { ok: false; code: "corrupt_archive" | "unsupported_archive" | "payload_too_large" };

export async function summarizeFitArchive(
  archive: ArrayBuffer, page: LapPage, context: GarminRequestContext,
): Promise<Summary> {
  const remaining = context.deadline - Date.now();
  if (context.signal.aborted || remaining <= 0) throw new GarminError("timeout");
  if (archive.byteLength > compressedLimit) throw new GarminError("payload_too_large");
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(remaining)]);
  const worker = new Worker(join(process.cwd(), "src/archive/fit-worker.mjs"), {
    env: {},
    execArgv: [],
    workerData: { archive, ...page },
    transferList: [archive],
    resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
  });
  let cancel: (() => void) | undefined;
  try {
    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      cancel = () => reject(new GarminError("timeout"));
      worker.once("message", resolve);
      worker.once("error", (error) => {
        const code = "code" in error && error.code === "ERR_WORKER_OUT_OF_MEMORY"
          ? "payload_too_large" : "garmin_unavailable";
        reject(new GarminError(code));
      });
      worker.once("exit", () => reject(new GarminError("garmin_unavailable")));
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
    if (signal.aborted || Date.now() >= context.deadline) throw new GarminError("timeout");
    if (!reply.ok) throw new GarminError(reply.code);
    return reply.result;
  } finally {
    if (cancel) signal.removeEventListener("abort", cancel);
    await worker.terminate().catch(() => {});
  }
}

export async function analyzeFitActivity(activityId: string, page: LapPage, context: GarminRequestContext) {
  const { body } = await garminClient.readActivityArchive(activityId, context, compressedLimit);
  const archive = await new Response(body).arrayBuffer();
  return {
    activityId,
    ...await summarizeFitArchive(archive, page, context),
    units: {
      distance: "m",
      timerTime: "s",
      elapsedTime: "s",
      averageSpeed: "m/s",
      averageHeartRate: "bpm",
      maxHeartRate: "bpm",
      averagePower: "W",
      maxPower: "W",
      runningPace: "s/km",
    },
  };
}
