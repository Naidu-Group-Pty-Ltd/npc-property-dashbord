import { describe, expect, it } from "vitest";
import {
  normalizeServiceName,
  resolveServiceBinding,
  knownBillableSecrets,
  toReportableEvent,
  type UsageLogRow,
} from "../../../supabase/functions/_shared/apiUsageBilling.pure";

/**
 * These rules decide which tenant gets billed for a vendor call, so they are
 * pinned here rather than discovered in production. The module is pure and has
 * no Deno globals precisely so this suite can run it.
 */

function row(over: Partial<UsageLogRow> = {}): UsageLogRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    service_name: "openai",
    endpoint: "/v1/chat/completions",
    tokens_used: 1500,
    request_count: 1,
    model_used: "gpt-4o-mini",
    status: "success",
    created_at: "2026-08-07T10:00:00.000Z",
    metadata: {},
    ...over,
  };
}

describe("normalizeServiceName", () => {
  it("collapses the naming variants already in the wild", () => {
    // 'lovable-ai' and 'lovable-ai-gateway' both appear across the edge
    // functions; they are the same credential and must not bill separately.
    expect(normalizeServiceName("lovable-ai")).toBe("lovableai");
    expect(normalizeServiceName("Lovable_AI")).toBe("lovableai");
    expect(normalizeServiceName("microsoft-graph")).toBe("microsoftgraph");
    expect(normalizeServiceName("meta_ads")).toBe("metaads");
  });
});

describe("resolveServiceBinding", () => {
  it("maps every service name the edge functions currently log", () => {
    // Taken from a scan of `service_name:` literals across supabase/functions.
    const observed = [
      "openai",
      "perplexity",
      "microsoft-graph",
      "meta_ads",
      "meta_ads_analysis",
      "lovable-ai-gateway",
      "lovable-ai",
      "vapi",
      "manychat",
      "ghl",
      "gemini",
      "bc-segment-engine",
      "airtable",
    ];
    for (const service of observed) {
      expect(resolveServiceBinding(service), `unmapped service: ${service}`).not.toBeNull();
    }
  });

  it("routes both Lovable spellings and the segment engine to one key", () => {
    const secret = "LOVABLE_API_KEY";
    for (const s of ["lovable-ai", "lovable-ai-gateway", "bc-segment-engine"]) {
      expect(resolveServiceBinding(s)?.secretName).toBe(secret);
    }
  });

  it("keeps the two Google credentials apart", () => {
    // Same vendor, separate bills — Maps is per-request, the AI key is per-token.
    expect(resolveServiceBinding("google-maps")?.secretName).toBe("GOOGLE_MAPS_API_KEY");
    expect(resolveServiceBinding("google-ai")?.secretName).toBe("GOOGLE_API_KEY");
    expect(resolveServiceBinding("google-maps")?.unit).toBe("request");
    expect(resolveServiceBinding("google-ai")?.unit).toBe("token");
  });

  it("returns null rather than guessing at an unknown service", () => {
    // Guessing bills the wrong tenant, which is worse than not billing.
    expect(resolveServiceBinding("some-new-vendor")).toBeNull();
    expect(resolveServiceBinding("")).toBeNull();
  });

  it("prices AI on tokens and everything else per call", () => {
    expect(resolveServiceBinding("openai")?.quantityFrom).toBe("tokens");
    expect(resolveServiceBinding("anthropic")?.quantityFrom).toBe("tokens");
    expect(resolveServiceBinding("resend")?.quantityFrom).toBe("requests");
    expect(resolveServiceBinding("cotality")?.quantityFrom).toBe("requests");
  });

  it("names secrets the way Deno.env does, so Mission Control can match them", () => {
    for (const secret of knownBillableSecrets()) {
      expect(secret, `not an env-var name: ${secret}`).toMatch(/^[A-Z_][A-Z0-9_]*$/);
    }
  });
});

describe("toReportableEvent", () => {
  it("bills a token-priced call on its token count", () => {
    const e = toReportableEvent(row({ tokens_used: 1500 }));
    expect(e).not.toBeNull();
    expect(e!.secret_name).toBe("OPENAI_API_KEY");
    expect(e!.quantity).toBe(1500);
    expect(e!.model).toBe("gpt-4o-mini");
  });

  it("bills a per-call service once per row", () => {
    const e = toReportableEvent(
      row({ service_name: "cotality", tokens_used: 0, request_count: 1 }),
    );
    expect(e!.secret_name).toBe("COTALITY_API_KEY");
    expect(e!.quantity).toBe(1);
  });

  it("uses the row id as the idempotency key", () => {
    // The forwarder retries. Without a stable key a re-sent batch would meter
    // the same calls a second time.
    const e = toReportableEvent(row({ id: "abc-123" }));
    expect(e!.idempotency_key).toBe("abc-123");
  });

  it("drops a token-priced call that consumed nothing", () => {
    expect(toReportableEvent(row({ tokens_used: 0 }))).toBeNull();
    expect(toReportableEvent(row({ tokens_used: null }))).toBeNull();
  });

  it("drops a service it cannot attribute to a credential", () => {
    expect(toReportableEvent(row({ service_name: "mystery-api" }))).toBeNull();
  });

  it("lets a call site name its own credential", () => {
    // How a newly-added vendor gets metered before this map learns about it.
    const e = toReportableEvent(
      row({ service_name: "openai", metadata: { secret_name: "OPENROUTER_API_KEY" } }),
    );
    expect(e!.secret_name).toBe("OPENROUTER_API_KEY");
  });

  it("ignores a metadata secret name that is not an env-var name", () => {
    const e = toReportableEvent(row({ metadata: { secret_name: "drop table users" } }));
    expect(e!.secret_name).toBe("OPENAI_API_KEY");
  });

  it("carries the failure through so Mission Control can decline to charge it", () => {
    const e = toReportableEvent(row({ status: "error" }));
    expect(e!.status).toBe("error");
  });

  it("reports when the call happened, not when it was drained", () => {
    const e = toReportableEvent(row({ created_at: "2026-07-31T23:59:00.000Z" }));
    expect(e!.occurred_at).toBe("2026-07-31T23:59:00.000Z");
  });
});
