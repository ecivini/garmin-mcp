import { crc32, deflateRawSync } from "node:zlib";
import { Encoder, Profile, type ActivityMesg, type FileIdMesg, type LapMesg, type Mesg, type RecordMesg, type SessionMesg } from "@garmin/fitsdk";
import { afterEach, expect, it, vi } from "vitest";
import { analyzeActivityFit } from "../mcp/archive-tools";
import { fixtureUpstream, invoke } from "../mcp/tool-test-fixtures";
import { summarizeFitArchive } from "./fit";

const activityId = "9223372036854775807";
const start = new Date("2025-01-02T03:04:05.000Z");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function makeFit(type: NonNullable<FileIdMesg["type"]> = "activity", sessionCount = 2, secondSport: SessionMesg["sport"] = "cycling") {
  const encoder = new Encoder();
  const numbers = Profile.MesgNum;
  const write = <Message extends Mesg>(number: number, message: Message) => encoder.onMesg(number, message);
  write<FileIdMesg>(numbers.FILE_ID, { type, manufacturer: "development", timeCreated: start });
  if (type === "activity") {
    write<RecordMesg>(numbers.RECORD, { timestamp: start, positionLat: 123456, positionLong: 234567 });
    write<LapMesg>(numbers.LAP, { startTime: start, totalDistance: 1500, totalTimerTime: 300, avgCadence: 83 });
    write<LapMesg>(numbers.LAP, { totalDistance: 2500, totalElapsedTime: 400, avgSpeed: 6.25, avgPower: 0 });
    for (let index = 0; index < sessionCount; index++) {
      write<SessionMesg>(numbers.SESSION, index === 0 ? {
        sport: "running", startTime: start, totalDistance: 1500, totalElapsedTime: 310, totalTimerTime: 300,
        firstLapIndex: 0, numLaps: 1, enhancedAvgSpeed: 5, avgHeartRate: 142, maxHeartRate: 169, avgCadence: 83,
      } : {
        sport: secondSport, firstLapIndex: 1, numLaps: 1, avgCadence: 92, avgPower: 175, maxPower: 350,
      });
    }
    write<ActivityMesg>(numbers.ACTIVITY, { timestamp: start, numSessions: sessionCount });
  }
  return Buffer.from(encoder.close());
}

type FixtureMember = {
  name: string;
  bytes: Buffer;
  compress?: boolean;
  zipCrc?: number;
  flags?: number;
  method?: number;
};

function zipArchive(members: FixtureMember[]) {
  const data: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const member of members) {
    const name = Buffer.from(member.name);
    const payload = member.compress ? deflateRawSync(member.bytes) : member.bytes;
    const checksum = member.zipCrc ?? crc32(member.bytes);
    const method = member.method ?? (member.compress ? 8 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(member.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(member.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    data.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(member.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(member.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + payload.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.reduce((total, part) => total + part.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...data, ...directory, end]);
}

function callFixture(zip: Buffer, pagination: Record<string, number> = {}) {
  const upstream = fixtureUpstream(new Response(new Uint8Array(zip)));
  const result = invoke(analyzeActivityFit, { activityId, ...pagination });
  return { upstream, result };
}

it("projects multisport sessions and paginates laps without emitting route records", async () => {
  const zip = zipArchive([
    { name: "directory/", bytes: Buffer.alloc(0) },
    { name: "course.fit", bytes: makeFit("course") },
    { name: "activity.bin", bytes: makeFit(), compress: true },
  ]);
  const first = callFixture(zip, { lapLimit: 1 });
  const result = await first.result;
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toMatchObject({
    activityId,
    sessions: [
      { sessionIndex: 0, sport: "running", startTime: start.toISOString(), distance: 1500, timerTime: 300,
        elapsedTime: 310, averageSpeed: 5, averageHeartRate: 142, maxHeartRate: 169,
        averageCadence: 83, cadenceUnit: "cycles/min", runningPace: 200 },
      { sessionIndex: 1, sport: "cycling", averagePower: 175, maxPower: 350,
        averageCadence: 92, cadenceUnit: "rpm" },
    ],
    laps: [{ lapIndex: 0, sessionIndex: 0, runningPace: 200 }],
    totalLaps: 2,
    nextLapOffset: 1,
    units: { distance: "m", runningPace: "s/km" },
  });
  expect(JSON.stringify(result)).not.toMatch(/positionLat|positionLong|123456|234567/);
  expect(first.upstream.paths()).toEqual([`/download-service/files/activity/${activityId}`]);

  const second = await callFixture(zip, { lapOffset: 1 }).result;
  expect(second.structuredContent).toMatchObject({
    laps: [{ lapIndex: 1, sessionIndex: 1, averageSpeed: 6.25, averagePower: 0 }],
    nextLapOffset: null,
    totalLaps: 2,
  });
  const pastEnd = await callFixture(zip, { lapOffset: 10 }).result;
  expect(pastEnd.structuredContent).toMatchObject({ laps: [], totalLaps: 2, nextLapOffset: null });
});

it("keeps session and lap indexes stable across multiple activity members", async () => {
  const zip = zipArchive([
    { name: "b.fit", bytes: makeFit() },
    { name: "a.fit", bytes: makeFit(), compress: true },
  ]);
  const result = await callFixture(zip, { lapOffset: 2, lapLimit: 1 }).result;
  expect(result.structuredContent).toMatchObject({
    sessions: [{ sessionIndex: 0 }, { sessionIndex: 1 }, { sessionIndex: 2 }, { sessionIndex: 3 }],
    laps: [{ lapIndex: 2, sessionIndex: 2 }],
    totalLaps: 4,
    nextLapOffset: 3,
  });
});

it("retains cadence without guessing a unit for a sport without a verified mapping", async () => {
  const zip = zipArchive([{ name: "activity.fit", bytes: makeFit("activity", 2, "rowing") }]);
  const result = await callFixture(zip).result;
  const { sessions } = result.structuredContent as { sessions: Array<Record<string, unknown>> };
  expect(sessions[1]).toMatchObject({ sport: "rowing", averageCadence: 92 });
  expect(sessions[1]).not.toHaveProperty("cadenceUnit");
});

it.each([
  { name: "malformed ZIP", make: () => Buffer.from("not an archive") },
  { name: "bad ZIP CRC", make: () => zipArchive([{ name: "activity.fit", bytes: makeFit(), zipCrc: 0 }]) },
  { name: "bad FIT CRC", make: () => {
    const bytes = makeFit();
    bytes[bytes.length - 1] ^= 1;
    return zipArchive([{ name: "activity.fit", bytes }]);
  } },
  { name: "wrong FIT size", make: () => zipArchive([{ name: "activity.fit", bytes: Buffer.concat([makeFit(), Buffer.from([0])]) }]) },
])("sanitizes integrity failures for $name", async ({ make }) => {
  const result = await callFixture(make()).result;
  expect(result).toMatchObject({ isError: true, structuredContent: { code: "corrupt_archive" } });
});

it.each([
  { name: "no activity FIT", make: () => zipArchive([{ name: "course.fit", bytes: makeFit("course") }]) },
  { name: "unsupported ZIP compression", make: () => zipArchive([{ name: "activity.fit", bytes: makeFit(), method: 99 }]) },
  { name: "encrypted ZIP", make: () => zipArchive([{ name: "activity.fit", bytes: makeFit(), compress: true, flags: 1 }]) },
])("rejects $name without exposing archive contents", async ({ make }) => {
  const result = await callFixture(make()).result;
  expect(result).toMatchObject({ isError: true, structuredContent: { code: "unsupported_archive" } });
});

it.each([
  { name: "33 ZIP members", make: () => zipArchive(Array.from({ length: 33 }, (_entry, index) => ({
    name: String(index), bytes: Buffer.alloc(0),
  }))) },
  { name: "33 activity sessions", make: () => zipArchive([{ name: "activity.fit", bytes: makeFit("activity", 33) }]) },
  { name: "an oversized inflated FIT member", make: () => {
    const bytes = Buffer.alloc(16 * 1024 * 1024 + 1);
    makeFit().copy(bytes);
    return zipArchive([{ name: "activity.fit", bytes, compress: true }]);
  } },
  { name: "an oversized cumulative inflation", make: () => {
    const bytes = Buffer.alloc(17 * 1024 * 1024);
    return zipArchive([{ name: "one", bytes, compress: true }, { name: "two", bytes, compress: true }]);
  } },
  { name: "an oversized compressed archive", make: () => Buffer.alloc(16 * 1024 * 1024 + 1) },
])("enforces the FIT limit on $name", async ({ make }) => {
  const result = await callFixture(make()).result;
  expect(result).toMatchObject({ isError: true, structuredContent: { code: "payload_too_large" } });
});

it("rejects a lap limit above 50 before requesting any archive", async () => {
  const upstream = fixtureUpstream();
  const result = await invoke(analyzeActivityFit, { activityId, lapLimit: 51 });
  expect(result).toMatchObject({ isError: true, structuredContent: { code: "invalid_input" } });
  expect(upstream.paths()).toEqual([]);
});

it("terminates an active worker when the request deadline expires", async () => {
  const zip = zipArchive([{ name: "activity.fit", bytes: makeFit() }]);
  const signal = new AbortController().signal;
  await expect(summarizeFitArchive(Uint8Array.from(zip).buffer, {
    lapOffset: 0, lapLimit: 1,
  }, { signal, deadline: Date.now() + 5 })).rejects.toMatchObject({ code: "timeout" });
});
