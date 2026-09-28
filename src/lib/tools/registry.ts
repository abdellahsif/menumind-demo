import { jsonSchema, tool, type JSONSchema7, type ToolSet } from "ai";
import { z } from "zod";
import { TOOL_NAMES, toolDefinitions } from "./definitions";
import { executeTool, type ToolDeps } from "./execute";

/**
 * Names that must never appear in the assistant's tool set. Confirmation and
 * the kitchen statuses are human-only actions.
 */
const FORBIDDEN_TOOL_NAME = /confirm|approve|prepar|ready|status|kitchen|finali[sz]e|submit|send/i;

/**
 * Advertises the Zod schema to the model as JSON Schema, but accepts any input at
 * the SDK layer. Validation happens in `executeTool`, so that invalid calls are
 * still written to the audit log instead of being dropped by the SDK.
 */
function auditedInputSchema(schema: z.ZodType) {
  return jsonSchema(z.toJSONSchema(schema, { io: "input" }) as JSONSchema7, {
    validate: (value) => ({ success: true, value }),
  });
}

export function createAssistantTools(deps: ToolDeps): ToolSet {
  const tools: ToolSet = Object.fromEntries(
    TOOL_NAMES.map((name) => [
      name,
      tool({
        description: toolDefinitions[name].description,
        inputSchema: auditedInputSchema(toolDefinitions[name].schema),
        execute: (input: unknown) => executeTool(name, input, deps),
      }),
    ]),
  );
  assertSafeToolSet(tools);
  return tools;
}

/** Throws if a tool set contains anything outside the allowlist or a lifecycle-sounding tool. */
export function assertSafeToolSet(tools: ToolSet): void {
  const allowed = new Set<string>(TOOL_NAMES);
  for (const name of Object.keys(tools)) {
    if (!allowed.has(name) || FORBIDDEN_TOOL_NAME.test(name)) {
      throw new Error(`Refusing to expose tool "${name}" to the assistant`);
    }
  }
}
