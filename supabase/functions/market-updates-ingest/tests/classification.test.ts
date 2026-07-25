import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { categoryForSegment, normaliseClassification } from "../classification.ts";

Deno.test("segment categories use persisted database values", () => {
  assertEquals(categoryForSegment("property"), "property_market");
  assertEquals(categoryForSegment("economic"), "economy");
  assertEquals(categoryForSegment("rental"), "rental_market");
  assertEquals(categoryForSegment("social"), "other");
});

Deno.test("classification removes incompatible audience tags", () => {
  const result = normaliseClassification({
    category: "property",
    segments: ["property", "social", "invalid"],
    audience_tags: ["buyers", "investors", "mortgage_brokers", "policy"],
    confidence_score: 120,
  });
  assertEquals(result.category, "property_market");
  assertEquals(result.segments, ["property", "social"]);
  assertEquals(result.audience_tags, ["investors", "mortgage_brokers"]);
  assertEquals(result.confidence_score, 100);
});
