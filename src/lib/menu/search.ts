import type { MenuItem } from "@/lib/orders/store";

const MAX_RESULTS = 10;

/** Lowercase words, with a naive plural strip so "pizzas" matches "pizza". */
function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));
}

/**
 * Items whose id, name, description or ingredients contain every query term.
 * Results are ranked so that name matches come first.
 */
export function searchMenuItems(menu: MenuItem[], query: string): MenuItem[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];

  return menu
    .map((item) => {
      const nameTerms = terms(`${item.id} ${item.name}`);
      const allTerms = [...nameTerms, ...terms(item.description), ...item.ingredients.flatMap(terms)];
      const matches = wanted.every((w) => allTerms.some((t) => t.startsWith(w)));
      const nameHits = wanted.filter((w) => nameTerms.some((t) => t.startsWith(w))).length;
      return { item, matches, nameHits };
    })
    .filter((r) => r.matches)
    .sort((a, b) => b.nameHits - a.nameHits || a.item.name.localeCompare(b.item.name))
    .slice(0, MAX_RESULTS)
    .map((r) => r.item);
}
