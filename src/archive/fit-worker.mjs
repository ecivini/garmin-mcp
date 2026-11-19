import { parentPort, workerData } from "node:worker_threads";
import { crc32 } from "node:zlib";
import { Decoder, Stream } from "@garmin/fitsdk";
import yauzl from "yauzl";

const maxZipMembers = 32;
const maxSessions = 32;
const maxInflatedBytes = 32 * 1024 * 1024;
const maxFitMemberBytes = 16 * 1024 * 1024;

class ArchiveError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function readMember(zip, entry) {
  const input = await zip.openReadStreamPromise(entry);
  const prefix = Buffer.alloc(12);
  let received = 0;
  let checksum = 0;
  let fit;

  for await (const chunk of input) {
    const end = received + chunk.length;
    if (end > entry.uncompressedSize) throw new ArchiveError("corrupt_archive");

    if (received < prefix.length) {
      chunk.copy(prefix, received, 0, prefix.length - received);
      if (end >= prefix.length && prefix.toString("ascii", 8, 12) === ".FIT") {
        if (entry.uncompressedSize > maxFitMemberBytes) throw new ArchiveError("payload_too_large");
        fit = Buffer.allocUnsafe(entry.uncompressedSize);
        prefix.copy(fit, 0, 0, received);
      }
    }
    fit?.set(chunk, received);
    checksum = crc32(chunk, checksum);
    received = end;
  }

  if (received !== entry.uncompressedSize || checksum !== entry.crc32) {
    throw new ArchiveError("corrupt_archive");
  }
  return fit;
}

function decodeFit(bytes) {
  const headerSize = bytes[0];
  // Garmin's integrity check can accept trailing data. Analyse one declared FIT file per ZIP member.
  if ((headerSize !== 12 && headerSize !== 14) || headerSize + bytes.readUInt32LE(4) + 2 !== bytes.length) {
    throw new ArchiveError("corrupt_archive");
  }
  const decoder = new Decoder(Stream.fromBuffer(bytes));
  if (!decoder.checkIntegrity()) throw new ArchiveError("corrupt_archive");

  const { messages, errors } = decoder.read({ mergeHeartRates: false });
  if (errors.length) throw new ArchiveError("corrupt_archive");
  if (messages.fileIdMesgs?.[0]?.type !== "activity") return undefined;
  if (!messages.sessionMesgs?.length) throw new ArchiveError("corrupt_archive");
  return { sessions: messages.sessionMesgs, laps: messages.lapMesgs ?? [] };
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function cadenceUnitFor(sport) {
  switch (sport) {
    case "running": return "cycles/min";
    case "cycling": return "rpm";
    case "swimming": return "strokes/min";
    default: return undefined;
  }
}

function measurement(message, sport) {
  const averageSpeed = message.enhancedAvgSpeed ?? message.avgSpeed;
  let runningPace;
  if (sport === "running") {
    if (positive(averageSpeed)) runningPace = 1000 / averageSpeed;
    else if (positive(message.totalDistance) && positive(message.totalTimerTime)) {
      runningPace = 1000 * message.totalTimerTime / message.totalDistance;
    }
  }
  const startTime = message.startTime instanceof Date && Number.isFinite(message.startTime.getTime())
    ? message.startTime.toISOString() : undefined;
  const averageCadence = message.avgCadence === undefined
    ? undefined : message.avgCadence + (message.avgFractionalCadence ?? 0);
  const maxCadence = message.maxCadence === undefined
    ? undefined : message.maxCadence + (message.maxFractionalCadence ?? 0);
  const cadenceUnit = Number.isFinite(averageCadence) || Number.isFinite(maxCadence)
    ? cadenceUnitFor(sport) : undefined;
  return {
    ...(typeof sport === "string" ? { sport } : {}),
    ...(startTime === undefined ? {} : { startTime }),
    ...Object.fromEntries(Object.entries({
      distance: message.totalDistance,
      timerTime: message.totalTimerTime,
      elapsedTime: message.totalElapsedTime,
      averageSpeed,
      averageHeartRate: message.avgHeartRate,
      maxHeartRate: message.maxHeartRate,
      averageCadence,
      maxCadence,
      averagePower: message.avgPower,
      maxPower: message.maxPower,
      runningPace,
    }).filter(([, value]) => Number.isFinite(value))),
    ...(cadenceUnit === undefined ? {} : { cadenceUnit }),
  };
}

function containsLap(session, lap, index, sessionCount) {
  // FIT defines First Lap Index and Lap Count as a slice of the file's ordered lap messages.
  if (Number.isSafeInteger(session.firstLapIndex) && Number.isSafeInteger(session.numLaps)) {
    return index >= session.firstLapIndex && index - session.firstLapIndex < session.numLaps;
  }
  if (sessionCount === 1) return true;

  const start = session.startTime?.getTime();
  const lapStart = lap.startTime?.getTime();
  const end = session.timestamp?.getTime() ?? start + session.totalElapsedTime * 1000;
  const lapEnd = lap.timestamp?.getTime() ?? lapStart + lap.totalElapsedTime * 1000;
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(lapStart) && Number.isFinite(lapEnd)
    && start <= lapStart && lapStart < end && lapStart <= lapEnd && lapEnd <= end;
}

async function summarize({ archive, lapOffset, lapLimit }) {
  const zip = await yauzl.fromBufferPromise(Buffer.from(archive), {
    validateEntrySizes: true,
    strictFileNames: true,
  });
  const sessions = [];
  const laps = [];
  let totalLaps = 0;
  let inflated = 0;

  try {
    if (zip.entryCount > maxZipMembers) throw new ArchiveError("payload_too_large");
    for await (const entry of zip.eachEntry()) {
      if (entry.isEncrypted() || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)) {
        throw new ArchiveError("unsupported_archive");
      }
      if (entry.fileName.endsWith("/")) continue;
      inflated += entry.uncompressedSize;
      if (inflated > maxInflatedBytes) throw new ArchiveError("payload_too_large");
      const bytes = await readMember(zip, entry);
      if (!bytes) continue;
      const activity = decodeFit(bytes);
      if (!activity) continue;
      const base = sessions.length;
      if (base + activity.sessions.length > maxSessions) throw new ArchiveError("payload_too_large");
      for (const session of activity.sessions) {
        sessions.push({ sessionIndex: sessions.length, ...measurement(session, session.sport) });
      }
      for (const [index, lap] of activity.laps.entries()) {
        const lapIndex = totalLaps++;
        if (lapIndex < lapOffset || laps.length === lapLimit) continue;
        const matches = activity.sessions.map((session, sessionIndex) => ({ session, sessionIndex }))
          .filter(({ session }) => containsLap(session, lap, index, activity.sessions.length));
        const link = matches.length === 1 ? matches[0] : undefined;
        laps.push({
          lapIndex,
          ...(link === undefined ? {} : { sessionIndex: base + link.sessionIndex }),
          ...measurement(lap, lap.sport ?? link?.session.sport),
        });
      }
    }
  } finally {
    zip.close();
  }

  if (!sessions.length) throw new ArchiveError("unsupported_archive");
  const consumed = lapOffset + laps.length;
  return { sessions, laps, totalLaps, nextLapOffset: consumed < totalLaps ? consumed : null };
}

try {
  parentPort.postMessage({ ok: true, result: await summarize(workerData) });
} catch (error) {
  parentPort.postMessage({ ok: false, code: error instanceof ArchiveError ? error.code : "corrupt_archive" });
}
