import { authorizeMcpRequest } from "../../src/security/mcp-auth";

export const runtime = "nodejs";

function handle(request: Request) {
  return authorizeMcpRequest(request, () =>
    Response.json({ error: "mcp_unavailable" }, { status: 501 }),
  );
}

export { handle as DELETE, handle as GET, handle as HEAD, handle as OPTIONS, handle as PATCH, handle as POST, handle as PUT };
