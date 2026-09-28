"use client";

import { getToolName, isToolUIPart } from "ai";
import type { ChatMessage } from "@/lib/chat/types";

const TOOL_LABELS: Record<string, [running: string, done: string]> = {
  search_menu: ["Searching the menu", "Searched the menu"],
  get_item_price: ["Checking the price", "Checked the price"],
  get_allergens: ["Looking up allergens", "Looked up allergens"],
  create_pending_order: ["Creating a pending order", "Created a pending order"],
  edit_pending_order: ["Editing the order", "Edited the order"],
  apply_discount: ["Applying the discount", "Applied the discount"],
  cancel_pending_order: ["Cancelling the order", "Cancelled the order"],
};

type ToolPart = { state: string; output?: unknown; errorText?: string };

function ToolChip({ name, part }: { name: string; part: ToolPart }) {
  const [running, done] = TOOL_LABELS[name] ?? [name, name];
  const output = part.output as { ok?: boolean; message?: string } | undefined;
  const finished = part.state === "output-available" || part.state === "output-error";
  const failed = part.state === "output-error" || output?.ok === false;

  return (
    <li
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        failed
          ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"
          : "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
      }`}
      title={failed ? (output?.message ?? part.errorText) : undefined}
    >
      <span aria-hidden className={finished ? "" : "animate-pulse"}>
        {failed ? "✕" : finished ? "✓" : "…"}
      </span>
      <span className="truncate">{finished ? (failed ? `${running}: not done` : done) : running}</span>
    </li>
  );
}

export function ChatMessageView({ message, isLast, busy }: { message: ChatMessage; isLast: boolean; busy: boolean }) {
  if (message.role === "user") {
    const text = message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-stone-900 px-4 py-2 text-white dark:bg-stone-100 dark:text-stone-900">
          {text}
        </p>
      </div>
    );
  }

  const tools = message.parts.filter(isToolUIPart);
  const texts = message.parts.flatMap((p) => (p.type === "text" ? [p.text] : []));
  const guard = message.parts.findLast((p) => p.type === "data-guard")?.data.status;
  // Text is released only after the allergen check, so until then show progress.
  const checking = isLast && busy && texts.length === 0;

  return (
    <div className="space-y-2">
      {tools.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Assistant actions">
          {tools.map((part) => (
            <ToolChip key={part.toolCallId} name={getToolName(part)} part={part} />
          ))}
        </ul>
      )}

      {checking && (
        <p className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400" role="status">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-stone-400" />
          {guard === "checking" ? "Checking the reply…" : "Working…"}
        </p>
      )}

      {texts.map((text, i) => (
        <p key={i} className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-white px-4 py-2 shadow-sm dark:bg-stone-900">
          {text}
        </p>
      ))}

      {guard === "replaced" && (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          The allergen safety check replaced this reply because it was not based on the stored allergen data.
        </p>
      )}
    </div>
  );
}
