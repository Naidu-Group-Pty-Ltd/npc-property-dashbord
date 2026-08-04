import { describe, expect, it } from "vitest";
import {
  CLIENT_SEARCH_SELECT,
  buildClientSearchOrFilter,
  matchesAllTerms,
  sanitizeClientSearchQuery,
  selectActivationMatches,
  toActivationClientResult,
  tokenizeClientSearch,
  type ClientSearchRow,
} from "../../../supabase/functions/_shared/aml/clientSearchMatch.pure";

const rugesh: ClientSearchRow = {
  id: "11111111-1111-4111-8111-111111111111",
  is_active: false,
  primary_first_name: "Rugesh",
  primary_surname: "Naidu",
  primary_email: "rugesh@example.test",
  primary_mobile: "0400 111 222",
};

const activeAlex: ClientSearchRow = {
  id: "22222222-2222-4222-8222-222222222222",
  is_active: true,
  primary_first_name: "Alex",
  primary_middle_name: "P",
  primary_surname: "Naidu",
  primary_email: "alex@example.test",
  primary_mobile: null,
};

const unrelated: ClientSearchRow = {
  id: "33333333-3333-4333-8333-333333333333",
  is_active: true,
  primary_first_name: "Morgan",
  primary_surname: "Smith",
};

const secondaryOnly: ClientSearchRow = {
  id: "44444444-4444-4444-8444-444444444444",
  is_active: false,
  primary_first_name: null,
  primary_surname: null,
  secondary_first_name: "Priya",
  secondary_surname: "Naidu",
};

const rows = [rugesh, activeAlex, unrelated, secondaryOnly];

describe("AML activation client search — tokenised full-name matching", () => {
  it("finds a client by full first name", () => {
    const result = selectActivationMatches(rows, "Rugesh");
    expect(result.map((r) => r.id)).toContain(rugesh.id);
    expect(result.map((r) => r.id)).not.toContain(unrelated.id);
  });

  it("finds a client by full surname", () => {
    const result = selectActivationMatches(rows, "Naidu");
    const ids = result.map((r) => r.id);
    expect(ids).toContain(rugesh.id);
    expect(ids).toContain(activeAlex.id);
    expect(ids).not.toContain(unrelated.id);
  });

  it("finds a client by full name split across first name and surname columns", () => {
    // primary_first_name = Rugesh, primary_surname = Naidu — the full phrase
    // exists in no single column, but tokenised matching must still find it.
    const result = selectActivationMatches(rows, "Rugesh Naidu");
    expect(result.map((r) => r.id)).toEqual([rugesh.id]);
  });

  it("is case-insensitive", () => {
    expect(selectActivationMatches(rows, "rugesh naidu").map((r) => r.id))
      .toEqual([rugesh.id]);
    expect(selectActivationMatches(rows, "RUGESH NAIDU").map((r) => r.id))
      .toEqual([rugesh.id]);
  });

  it("matches partial first names and partial surnames", () => {
    expect(selectActivationMatches(rows, "Ruge").map((r) => r.id)).toContain(rugesh.id);
    expect(selectActivationMatches(rows, "Naid").map((r) => r.id)).toContain(rugesh.id);
    expect(selectActivationMatches(rows, "Ruge Naid").map((r) => r.id)).toEqual([rugesh.id]);
  });

  it("requires all tokens to appear in the same applicant's name", () => {
    // "Rugesh Smith" mixes two different clients — must match neither.
    expect(selectActivationMatches(rows, "Rugesh Smith")).toEqual([]);
    expect(matchesAllTerms(rugesh, ["rugesh", "smith"])).toBe(false);
  });

  it("matches on the secondary applicant's name too", () => {
    expect(selectActivationMatches(rows, "Priya Naidu").map((r) => r.id))
      .toEqual([secondaryOnly.id]);
  });

  it("includes inactive clients in the results (selectable)", () => {
    const result = selectActivationMatches(rows, "Naidu");
    const inactive = result.filter((r) => r.is_active !== true);
    expect(inactive.map((r) => r.id)).toContain(rugesh.id);
  });

  it("orders active matches before inactive ones and reports statuses accurately", () => {
    const result = selectActivationMatches(rows, "Naidu");
    const projected = result.map((r) => toActivationClientResult(r, false));
    expect(projected[0]).toMatchObject({ id: activeAlex.id, is_active: true });
    const rugeshResult = projected.find((p) => p.id === rugesh.id);
    expect(rugeshResult).toMatchObject({
      is_active: false,
      label: "Rugesh Naidu",
      email: "rugesh@example.test",
      mobile: "0400 111 222",
    });
  });

  it("trims repeated spaces and safely strips filter metacharacters", () => {
    expect(sanitizeClientSearchQuery("  Rugesh    Naidu  ")).toBe("Rugesh Naidu");
    expect(sanitizeClientSearchQuery("Rugesh%,()\\Naidu")).toBe("Rugesh Naidu");
    expect(selectActivationMatches(rows, "  rugesh    naidu  ").map((r) => r.id))
      .toEqual([rugesh.id]);
  });

  it("builds a PostgREST or-filter covering every name column per token", () => {
    const filter = buildClientSearchOrFilter(tokenizeClientSearch("Rugesh Naidu"));
    for (const col of [
      "primary_first_name", "primary_surname", "secondary_first_name", "secondary_surname",
    ]) {
      expect(filter).toContain(`${col}.ilike.%Rugesh%`);
      expect(filter).toContain(`${col}.ilike.%Naidu%`);
    }
    // Stripped metacharacters can never reach the filter tokens.
    const tokens = tokenizeClientSearch(sanitizeClientSearchQuery("a(),%b cd"));
    expect(tokens.join("")).not.toMatch(/[(),%\\]/);
  });

  it("projects identification data only — no financial fields", () => {
    expect(CLIENT_SEARCH_SELECT).not.toMatch(/portfolio|debt|cash_flow|income/);
    const projected = toActivationClientResult(rugesh, true);
    expect(Object.keys(projected).sort()).toEqual(
      ["email", "has_open_case", "id", "is_active", "label", "mobile"],
    );
    expect(projected.has_open_case).toBe(true);
  });

  it("caps the result set", () => {
    const many: ClientSearchRow[] = Array.from({ length: 60 }, (_, i) => ({
      id: `55555555-5555-4555-8555-${String(i).padStart(12, "0")}`,
      is_active: i % 2 === 0,
      primary_first_name: "Rugesh",
      primary_surname: "Naidu",
    }));
    expect(selectActivationMatches(many, "Naidu").length).toBe(20);
  });
});
