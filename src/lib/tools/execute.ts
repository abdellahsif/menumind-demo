import { z } from "zod";
import type { AuditSink, ToolStore } from "@/lib/orders/store";
import type { Json } from "@/lib/supabase/database.types";
import { toolDefinitions, type ToolName, type ToolResult } from "./definitions";

export type ToolDeps = { store: ToolStore; audit: AuditSink };

/** Model input is JSON already; this guards against anything that is not. */
function asJson(value: unknown): Json {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as Json;
  } catch {
    return String(value);
  }
}

function orderIdOf(input: unknown, output: ToolResult): string | null {
  const candidates = [
    (input as { order_id?: unknown } | null)?.order_id,
    (output as { order_id?: unknown }).order_id,
    (output as { order?: { order_id?: unknown } }).order?.order_id,
  ];
  const id = candidates.find((c): c is string => typeof c === "string");
  return id && z.uuid().safeParse(id).success ? id : null;
}

/**
 * The single entry point for running a tool. It validates the input with Zod,
 * runs the tool, and writes the call to the audit log, including calls that were
 * rejected as invalid or that failed. It never throws to the model.
 */
export async function executeTool(name: ToolName, rawInput: unknown, deps: ToolDeps): Promise<ToolResult> {
  const definition = toolDefinitions[name];
  let output: ToolResult;

  const parsed = definition.schema.safeParse(rawInput);
  if (!parsed.success) {
    output = { ok: false, error: "invalid_input", message: z.prettifyError(parsed.error) };
  } else {
    try {
      // Each schema is paired with its own `run`, so this input matches.
      output = await (definition.run as (input: unknown, store: ToolStore) => Promise<ToolResult>)(
        parsed.data,
        deps.store,
      );
    } catch (error) {
      console.error(`[tool:${name}] failed`, error);
      output = { ok: false, error: "internal_error", message: "The tool failed. Nothing was changed or confirmed." };
    }
  }

  try {
    await deps.audit.record({
      tool_name: name,
      order_id: orderIdOf(parsed.success ? parsed.data : rawInput, output),
      input: asJson(rawInput),
      output: asJson(output),
    });
  } catch (error) {
    // The action already happened. Throwing here would make the model retry
    // (e.g. create a duplicate order), so report loudly instead.
    console.error(`[audit] FAILED to record ${name} call`, error);
  }

  return output;
}
