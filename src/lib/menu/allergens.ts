import { z } from "zod";
import type { Json } from "@/lib/supabase/database.types";

export const EU_14_ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "tree_nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;
export type AllergenCode = (typeof EU_14_ALLERGENS)[number];

/** A record is only complete when all three keys are present and valid. */
const completeRecordSchema = z.object({
  contains: z.array(z.enum(EU_14_ALLERGENS)),
  may_contain: z.array(z.enum(EU_14_ALLERGENS)),
  last_reviewed: z.iso.date(),
});

export const KITCHEN_REFERRAL =
  "Allergen information for this item is incomplete. Do not say it is safe or unsafe. " +
  "Tell the guest you cannot confirm and that they should check with the kitchen.";

export type AllergenResult =
  | {
      status: "known";
      item_id: string;
      contains: AllergenCode[];
      may_contain: AllergenCode[];
      last_reviewed: string;
    }
  | {
      status: "unknown";
      item_id: string;
      reason: "no_allergen_data" | "incomplete_allergen_data";
      /** The raw stored value, returned as is so nothing is hidden or invented. */
      stored: Json | null;
      instruction: string;
    };

/**
 * Turns the stored `allergens` column into an answer. Never infers: NULL, a
 * missing key, or any unexpected shape is reported as "unknown".
 */
export function interpretAllergens(itemId: string, stored: Json | null): AllergenResult {
  if (stored === null) {
    return { status: "unknown", item_id: itemId, reason: "no_allergen_data", stored: null, instruction: KITCHEN_REFERRAL };
  }
  const parsed = completeRecordSchema.safeParse(stored);
  if (!parsed.success) {
    return {
      status: "unknown",
      item_id: itemId,
      reason: "incomplete_allergen_data",
      stored,
      instruction: KITCHEN_REFERRAL,
    };
  }
  return { status: "known", item_id: itemId, ...parsed.data };
}
