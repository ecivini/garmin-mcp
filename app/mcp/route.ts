import { dispatchMcp } from "../../src/mcp/transport";
import { authorizeMcpRequest } from "../../src/security/mcp-auth";

export const runtime = "nodejs";

function handle(request: Request) {
  const deadline = Date.now() + 15_000;

  return authorizeMcpRequest(request, (authorizedRequest, identity) => {
    if (authorizedRequest.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    return dispatchMcp(authorizedRequest, identity, deadline);
  });
}

export { handle as DELETE, handle as GET, handle as HEAD, handle as OPTIONS, handle as PATCH, handle as POST, handle as PUT };
