import { deliverActivityArchive } from "../../../src/archive/download";
import { createDownloadActivityRoute, downloadMethodNotAllowed } from "../../../src/security/download-auth";

export const runtime = "nodejs";
export const maxDuration = 75;

export const GET = createDownloadActivityRoute(deliverActivityArchive);
export { downloadMethodNotAllowed as HEAD };
