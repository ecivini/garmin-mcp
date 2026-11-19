import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { OwnerIdentity } from "../security/mcp-auth";

type ToolContext = Readonly<{
  identity: OwnerIdentity;
  signal: AbortSignal;
  deadline: number;
}>;

const activityTypesOutput = z.strictObject({
  data: z.array(z.strictObject({
    key: z.string(),
    parent: z.string().nullable(),
  })),
  units: z.strictObject({}),
});

function listActivityTypes({ signal }: ToolContext): z.infer<typeof activityTypesOutput> {
  signal.throwIfAborted();
  return {
    data: [
      { key: "fixture_activity", parent: null },
      { key: "fixture_activity_variant", parent: "fixture_activity" },
    ],
    units: {},
  };
}

export function dispatchMcp(request: Request, identity: OwnerIdentity, deadline: number): Promise<Response> {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "garmin-mcp", version: "0.1.0" });

    server.registerTool("list_activity_types", {
      title: "List activity types",
      description: "Return synthetic activity types for the OAuth connection check.",
      inputSchema: z.strictObject({}),
      outputSchema: activityTypesOutput,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    }, (_args, { mcpReq }) => {
      const remaining = deadline - Date.now();
      const deadlineSignal = remaining > 0 ? AbortSignal.timeout(remaining) : AbortSignal.abort();
      const result = listActivityTypes({
        identity,
        deadline,
        signal: AbortSignal.any([request.signal, mcpReq.signal, deadlineSignal]),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
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
