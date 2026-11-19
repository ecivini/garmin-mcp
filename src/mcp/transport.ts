import { createMcpHandler, Server } from "@modelcontextprotocol/server";
import type { OwnerIdentity } from "../security/mcp-auth";
import { getActivity, getActivityWorkouts, listActivityTypes, searchActivities } from "./activity-tools";
import { limitToolResult, unknownTool } from "./tools";
import { trainingTools } from "./training-tools";

const tools = [listActivityTypes, getActivity, getActivityWorkouts, searchActivities, ...trainingTools];
const toolByName = new Map(tools.map((tool) => [tool.descriptor.name, tool]));

export function dispatchMcp(request: Request, identity: OwnerIdentity, deadline: number): Promise<Response> {
  const handler = createMcpHandler(() => {
    const server = new Server({ name: "garmin-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });

    server.setRequestHandler("tools/list", () => ({ tools: tools.map((tool) => tool.descriptor) }));
    server.setRequestHandler("tools/call", async ({ params }, { mcpReq }) => {
      const tool = toolByName.get(params.name);
      if (!tool) return unknownTool();

      const remaining = deadline - Date.now();
      const deadlineSignal = remaining > 0 ? AbortSignal.timeout(remaining) : AbortSignal.abort();
      const result = await tool.invoke(params.arguments, {
        identity,
        deadline,
        signal: AbortSignal.any([request.signal, mcpReq.signal, deadlineSignal]),
      });
      return limitToolResult(server.projectCallToolResult(result, tool.descriptor.outputSchema), tool.sizeHint);
    });

    return server;
  }, {
    legacy: "stateless",
    maxRequestBodySize: 64 * 1024,
    maxSubscriptions: 0,
  });

  const headers = new Headers(request.headers);
  headers.delete("Authorization");
  return handler.fetch(new Request(request, { headers }));
}
