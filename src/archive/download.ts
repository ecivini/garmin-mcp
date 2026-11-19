import { GarminError, garminClient, type GarminRequestContext } from "../garmin/client";

const archiveLimit = 100 * 1024 * 1024;
const signatureSize = 4;

function isZipSignature(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  await reader.cancel().catch(() => {});
  reader.releaseLock();
}

function safeError(error: unknown): GarminError {
  return error instanceof GarminError ? error : new GarminError("garmin_unavailable");
}

function relayArchive(reader: ReadableStreamDefaultReader<Uint8Array>, prefixChunks: Uint8Array[]) {
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const prefix = prefixChunks.shift();
      if (prefix) {
        controller.enqueue(prefix);
        return;
      }
      try {
        const next = await reader.read();
        if (cancelled) return;
        if (next.done) {
          reader.releaseLock();
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        if (cancelled) return;
        reader.releaseLock();
        controller.error(safeError(error));
      }
    },
    async cancel() {
      cancelled = true;
      await cancelReader(reader);
    },
  }, { highWaterMark: 0 });
}

export async function deliverActivityArchive({ activityId, signal, deadline }: GarminRequestContext & {
  activityId: string;
}): Promise<Response> {
  try {
    const archive = await garminClient.readActivityArchive(activityId, { signal, deadline }, archiveLimit);
    const reader = archive.body.getReader();
    const prefix = new Uint8Array(signatureSize);
    const prefixChunks: Uint8Array[] = [];
    let inspected = 0;
    try {
      while (inspected < signatureSize) {
        const next = await reader.read();
        if (next.done) break;
        if (!next.value.byteLength) continue;
        prefixChunks.push(next.value);
        const bytes = next.value.subarray(0, signatureSize - inspected);
        prefix.set(bytes, inspected);
        inspected += bytes.byteLength;
      }
    } catch (error) {
      await cancelReader(reader);
      throw error;
    }

    if (inspected !== signatureSize || !isZipSignature(prefix)) {
      await cancelReader(reader);
      return Response.json({ error: "unsupported_archive" }, { status: 415 });
    }

    return new Response(relayArchive(reader, prefixChunks), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="activity.zip"',
      },
    });
  } catch (error) {
    return downloadFailure(safeError(error));
  }
}

const failureStatuses: Partial<Record<GarminError["code"], number>> = {
  not_found: 404,
  rate_limited: 429,
  timeout: 504,
  payload_too_large: 413,
};

function downloadFailure(error: GarminError): Response {
  const status = failureStatuses[error.code] ?? 502;
  const headers = new Headers();
  if (error.retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  return Response.json({ error: error.code }, { status, headers });
}
