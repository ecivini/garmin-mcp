import { createDownloadActivityRoute, downloadMethodNotAllowed } from "../../../src/security/download-auth";

export const runtime = "nodejs";

export const GET = createDownloadActivityRoute(() => new Response(null, { status: 501 }));
export { downloadMethodNotAllowed as HEAD };
