import { describe, expect, it } from "vitest";
import { checkAllergenGrounding, mentionsAllergens, type TurnPart } from "@/lib/chat/allergen-guard";

const text = (t: string): TurnPart => ({ type: "text", text: t });
const call = (toolName: string): TurnPart => ({ type: "tool-call", toolName });
const result = (toolName: string): TurnPart => ({ type: "tool-result", toolName });

describe("mentionsAllergens", () => {
  it.each([
    "The pad thai contains peanuts.",
    "It is gluten-free.",
    "No dairy in that one.",
    "Is she allergic to anything?",
    "It may contain traces of sesame.",
    "Carbonara has egg yolk.",
    "Suitable for coeliacs? Coeliac guests should ask.",
    "Contains sulphites from the wine.",
  ])("detects: %s", (sentence) => {
    expect(mentionsAllergens(sentence)).toBe(true);
  });

  it.each(["Added 2 Margherita pizzas to table 4.", "Your total is 28.50.", "The eggplant is off today."])(
    "ignores: %s",
    (sentence) => {
      expect(mentionsAllergens(sentence)).toBe(false);
    },
  );
});

describe("checkAllergenGrounding", () => {
  it("passes when get_allergens was called before the allergen statement", () => {
    expect(
      checkAllergenGrounding([call("get_allergens"), result("get_allergens"), text("It contains peanuts and eggs.")]),
    ).toEqual({ flagged: false });
  });

  it("flags an allergen statement with no get_allergens call in the turn", () => {
    const check = checkAllergenGrounding([text("The Greek salad is nut-free.")]);
    expect(check).toEqual({ flagged: true, excerpts: ["The Greek salad is nut-free."] });
  });

  it("flags a statement made BEFORE the get_allergens call, even if one follows", () => {
    const check = checkAllergenGrounding([
      text("Tiramisu has no nuts. Let me double-check."),
      call("get_allergens"),
      text("It may contain tree nuts."),
    ]);
    expect(check).toEqual({ flagged: true, excerpts: ["Tiramisu has no nuts."] });
  });

  it("does not count other tools as grounding", () => {
    expect(checkAllergenGrounding([call("search_menu"), text("That dish contains milk.")]).flagged).toBe(true);
  });

  it("ignores ordinary order chatter", () => {
    expect(checkAllergenGrounding([call("create_pending_order"), text("Order created for table 4.")])).toEqual({
      flagged: false,
    });
  });
});
