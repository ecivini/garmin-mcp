import type { CallToolResult, Tool } from "@modelcontextprotocol/server";
import { z } from "zod";
import { GarminError, type GarminRequestContext } from "../garmin/client";
import type { OwnerIdentity } from "../security/mcp-auth";

export type ToolContext = GarminRequestContext & Readonly<{ identity: OwnerIdentity }>;

type ToolSpec<Input extends z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: Input;
  output?: z.ZodObject;
  sizeHint?: string;
  execute(input: z.output<Input>, context: ToolContext): Promise<Record<string, unknown>>;
};

export type RegisteredTool = {
  descriptor: Tool;
  sizeHint?: string;
  invoke(args: unknown, context: ToolContext): Promise<CallToolResult>;
};

function objectSchema(schema: z.ZodObject, direction: "input" | "output"): Tool["inputSchema"] {
  // Both SDK schema types describe the same JSON object, with different recursive type definitions.
  return { ...z.toJSONSchema(schema, { io: direction }), type: "object" } as Tool["inputSchema"];
}

function failure(error: GarminError, sizeHint?: string): CallToolResult {
  const info = {
    code: error.code,
    message: sizeHint ? `${error.message} ${sizeHint}` : error.message,
    ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
  };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(info) }], structuredContent: info };
}

function success(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

const resultByteLimit = 128 * 1024;

export function limitToolResult(result: CallToolResult, sizeHint?: string): CallToolResult {
  if (Buffer.byteLength(JSON.stringify(result)) > resultByteLimit) {
    return failure(new GarminError("payload_too_large"), sizeHint);
  }
  return result;
}

export function defineTool<Input extends z.ZodObject>({
  name, title, description, input, output, execute, sizeHint,
}: ToolSpec<Input>): RegisteredTool {
  return {
    sizeHint,
    descriptor: {
      name,
      title,
      description,
      inputSchema: objectSchema(input, "input"),
      ...(output ? { outputSchema: objectSchema(output, "output") } : {}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async invoke(args, context) {
      const parsed = input.safeParse(args ?? {});
      if (!parsed.success) return failure(new GarminError("invalid_input"));

      try {
        if (context.signal.aborted) throw new GarminError("timeout");
        return success(await execute(parsed.data, context));
      } catch (error) {
        const safe = error instanceof GarminError ? error : new GarminError("garmin_unavailable");
        return failure(safe, safe.code === "payload_too_large" ? sizeHint : undefined);
      }
    },
  };
}

export function unknownTool(): CallToolResult {
  return failure(new GarminError("invalid_input"));
}
