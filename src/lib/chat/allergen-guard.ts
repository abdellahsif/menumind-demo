/**
 * Server-side check that allergen statements are grounded in a get_allergens
 * call made earlier in the same assistant turn. The system prompt asks for this;
 * this check verifies it and flags any message that breaks the rule.
 *
 * Deliberately over-inclusive: a false flag costs a log line, a missed one could
 * hurt a guest.
 */

const ALLERGEN_TERMS = [
  String.raw`allergen\w*`,
  String.raw`allerg(?:y|ies|ic)`,
  String.raw`intoleran\w*`,
  String.raw`anaphyla\w*`,
  String.raw`gluten(?:-free)?`,
  String.raw`c(?:o)?eliac`,
  "wheat",
  "dairy(?:-free)?",
  "lactose",
  "milk",
  "eggs?",
  "nuts?",
  "nut-free",
  "peanuts?",
  "tree[ _]nuts?",
  "almonds?",
  "walnuts?",
  "hazelnuts?",
  "cashews?",
  "pistachios?",
  "pine nuts?",
  "soy(?:a|beans?)?",
  "sesame",
  "fish",
  "shellfish",
  "crustaceans?",
  "shrimps?",
  "prawns?",
  "crabs?",
  "lobsters?",
  "molluscs?",
  "mollusks?",
  "mussels?",
  "oysters?",
  "squid",
  "celery",
  "mustard",
  "sulph?ites?",
  "sulfites?",
  "lupin",
  "may contain",
  "traces? of",
];

const ALLERGEN_PATTERN = new RegExp(String.raw`\b(?:${ALLERGEN_TERMS.join("|")})\b`, "i");

export const ALLERGEN_TOOL_NAME = "get_allergens";

export function mentionsAllergens(text: string): boolean {
  return ALLERGEN_PATTERN.test(text);
}

/** Structural subset of the AI SDK's content parts, in generation order. */
export type TurnPart = { type: string; text?: string; toolName?: string };

export type GroundingCheck = { flagged: false } | { flagged: true; excerpts: string[] };

/**
 * Walks one assistant turn in order. Any text that mentions allergens before a
 * get_allergens call has been made in that turn is flagged.
 */
export function checkAllergenGrounding(parts: readonly TurnPart[]): GroundingCheck {
  let grounded = false;
  const excerpts: string[] = [];

  for (const part of parts) {
    if (part.type === "tool-call" && part.toolName === ALLERGEN_TOOL_NAME) {
      grounded = true;
    } else if (part.type === "text" && part.text && !grounded) {
      const sentences = part.text.split(/(?<=[.!?\n])\s+/);
      excerpts.push(...sentences.filter(mentionsAllergens).map((s) => s.trim().slice(0, 200)));
    }
  }

  return excerpts.length > 0 ? { flagged: true, excerpts } : { flagged: false };
}
