export const MARKET_SEGMENTS = [
  "finance", "property", "construction", "political", "economic", "social",
  "policy_regulation", "rental",
] as const;

export const MARKET_AUDIENCES = [
  "investors", "owner_occupiers", "first_home_buyers", "buyers_agents",
  "mortgage_brokers", "finance_brokers", "developers", "builders",
  "property_managers", "smsf",
] as const;

export const SEGMENT_CATEGORY = {
  finance: "finance",
  property: "property_market",
  construction: "construction",
  political: "political",
  economic: "economy",
  social: "other",
  policy_regulation: "policy_regulation",
  rental: "rental_market",
} as const;

export type MarketSegment = keyof typeof SEGMENT_CATEGORY;

export function categoryForSegment(value: unknown): string {
  return SEGMENT_CATEGORY[value as MarketSegment] ?? "other";
}

export function normaliseClassification<T extends Record<string, unknown>>(value: T): T & {
  category: string;
  segments: MarketSegment[];
  audience_tags: string[];
  confidence_score: number;
} {
  const requestedSegments = Array.isArray(value.segments) ? value.segments : [value.category];
  const segments = [...new Set(requestedSegments.filter((item): item is MarketSegment =>
    typeof item === "string" && MARKET_SEGMENTS.includes(item as MarketSegment)
  ))];
  if (!segments.length) segments.push("property");
  const audienceTags = Array.isArray(value.audience_tags)
    ? [...new Set(value.audience_tags.filter((item): item is string =>
      typeof item === "string" && MARKET_AUDIENCES.includes(item as typeof MARKET_AUDIENCES[number])
    ))]
    : [];
  let confidence = Number(value.confidence_score);
  if (!Number.isFinite(confidence)) confidence = 0;
  // Some models return 0-1 fractions instead of the requested 0-100 scale.
  if (confidence > 0 && confidence <= 1) confidence = confidence * 100;
  confidence = Math.max(0, Math.min(100, confidence));
  return {
    ...value,
    category: categoryForSegment(segments[0]),
    segments,
    audience_tags: audienceTags,
    confidence_score: confidence,
  };
}
