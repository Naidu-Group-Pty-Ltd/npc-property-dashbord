/**
 * The last mile between a loaded sanctions list and a screening that runs.
 *
 * ── The dead end ──────────────────────────────────────────────────────
 * Loading the DFAT Consolidated List was necessary to screen anybody and it
 * was never sufficient. `aml.provider_configs` carries a `mode` for
 * `pep_sanctions/local_lists`, and production refuses to run a provider in
 * `simulator` mode — correctly, because the screening simulator returns
 * **"clear" for everyone** who does not match a hardcoded keyword list.
 *
 * So an MLRO could load the legally operative register in full and Stage 5
 * would still refuse, with nothing on the page to press. The only way to
 * finish the job was an undocumented UPDATE against `provider_configs`, and
 * no surface in the product performed it.
 *
 * ── Why the ingest owns this ──────────────────────────────────────────
 * `local_lists` calls no vendor. It queries `aml.sanctions_entries` behind its
 * own freshness gate, so whether it can answer is decided by the data. A
 * separate `mode` flag is a second source of truth about that same fact, and
 * it can only ever disagree in one of two ways — claiming a readiness it does
 * not have, or refusing when it could answer. Promoting on a real load makes
 * the flag a consequence of the data instead of a parallel assertion.
 *
 * ── The line this must never cross ────────────────────────────────────
 * "Do not simply flip mode = live to make the error disappear." That is the
 * standing instruction, and it is why the second describe block below is
 * longer than the first: every refusal is asserted, and each one is a way the
 * platform could otherwise come to claim it screens people when it does not.
 */
import { describe, expect, it } from "vitest";

import {
  PROMOTING_LIST,
  decideProviderPromotion,
} from "../../../supabase/functions/_shared/aml/sanctionsIngest.pure";

const load = (over: Partial<Parameters<typeof decideProviderPromotion>[0]> = {}) =>
  decideProviderPromotion({
    listCode: "dfat", entriesWritten: 7_412, currentMode: "simulator", active: true, ...over,
  });

/* ═════════ The one case that promotes ═════════ */

describe("a real load of the legally operative list makes screening live", () => {
  it("promotes out of simulator", () => {
    const d = load();
    expect(d.promote).toBe(true);
    expect(d.reason).toMatch(/screening is now live/i);
  });

  it("says why the list alone was not enough", () => {
    // The operator has just done the work and needs to know what it bought
    // them. "Loaded 7,412 entries" was true before and screened nobody.
    expect(load().reason).toMatch(/production refuses to run|simulator mode/i);
  });

  it("promotes on any non-zero write, however small", () => {
    // A short list is a compliance question, not a promotion question — the
    // provider's freshness gate and the ingest's shrink floor own that.
    expect(load({ entriesWritten: 1 }).promote).toBe(true);
  });

  it("is keyed to DFAT, the source the provider actually requires", () => {
    expect(PROMOTING_LIST).toBe("dfat");
  });

  it("accepts the list code however it was cased", () => {
    for (const listCode of ["DFAT", "Dfat", "dfat"]) {
      expect(load({ listCode }).promote, listCode).toBe(true);
    }
  });
});

/* ═════════ Every way it must refuse ═════════ */

describe("it never flips the mode to make an error disappear", () => {
  it("refuses on a list that is not the operative one", () => {
    // UN and OFAC corroborate. Neither is the Australian TFS source, and
    // loading one must not license screening that DFAT has not backed.
    for (const listCode of ["un", "ofac", "eu", ""]) {
      const d = load({ listCode });
      expect(d.promote, listCode).toBe(false);
      expect(d.reason).toMatch(/DFAT Consolidated List/i);
    }
  });

  it("refuses when nothing was written", () => {
    // The decisive case. A zero-entry load that promoted would publish a
    // provider claiming to screen against an empty register — which returns
    // clear for everybody and looks exactly like screening that worked.
    for (const entriesWritten of [0, -1, Number.NaN]) {
      const d = load({ entriesWritten });
      expect(d.promote, String(entriesWritten)).toBe(false);
      expect(d.reason).toMatch(/no entries were written/i);
    }
  });

  it("never reactivates a deactivated provider", () => {
    // Deactivation is a deliberate act by a person — often the response to a
    // provider that is misbehaving. Loading data must not reverse it.
    for (const active of [false, null, undefined]) {
      const d = load({ active });
      expect(d.promote, String(active)).toBe(false);
      expect(d.reason).toMatch(/deactivated/i);
      expect(d.reason).toMatch(/deliberate decision/i);
    }
  });

  it("does not re-promote a provider that is already live", () => {
    // A weekly refresh is not a change of posture, and recording it as one
    // would bury the entry that matters in a log of identical ones.
    const d = load({ currentMode: "live" });
    expect(d.promote).toBe(false);
    expect(d.reason).toMatch(/already live/i);
    expect(d.reason).toMatch(/refreshed/i);
  });

  it("checks the list before the count, so the message names the real reason", () => {
    // An operator loading UN with an empty file should be told this is not
    // the promoting list, not sent looking for missing rows.
    expect(load({ listCode: "un", entriesWritten: 0 }).reason).toMatch(/DFAT/i);
  });

  it("checks activation before the current mode", () => {
    // A deactivated, already-live provider is a deactivated provider.
    expect(load({ active: false, currentMode: "live" }).reason).toMatch(/deactivated/i);
  });

  it("has no input that produces a demotion", () => {
    // Nothing here may take a live provider down. Staleness is the provider's
    // own gate and fails closed as a technical condition; turning it into a
    // mode change would let a stale list read as a settled posture.
    for (const listCode of ["dfat", "un", "ofac"]) {
      for (const entriesWritten of [0, 1, 9_999]) {
        for (const active of [true, false]) {
          const d = decideProviderPromotion({
            listCode, entriesWritten, currentMode: "live", active,
          });
          expect(d.promote, `${listCode}/${entriesWritten}/${active}`).toBe(false);
          expect(d.reason).not.toMatch(/simulator mode now|demot|disabl/i);
        }
      }
    }
  });

  it("always explains itself", () => {
    // Every outcome reaches an operator as a sentence in a toast. A silent
    // refusal is the dead end this whole change exists to close.
    for (const over of [
      {}, { listCode: "un" }, { entriesWritten: 0 }, { active: false },
      { currentMode: "live" }, { currentMode: null }, { active: undefined },
    ] as Array<Partial<Parameters<typeof decideProviderPromotion>[0]>>) {
      const d = load(over);
      expect(d.reason.length, JSON.stringify(over)).toBeGreaterThan(20);
      // It must never read as a screening outcome.
      expect(d.reason).not.toMatch(/\bclear\b|no match|screened clean/i);
    }
  });
});

/* ═════════ It decides permission to run, never an outcome ═════════ */

describe("promotion is not a result", () => {
  it("produces no screening verdict in any branch", () => {
    for (const over of [
      {}, { listCode: "un" }, { entriesWritten: 0 }, { active: false }, { currentMode: "live" },
    ] as Array<Partial<Parameters<typeof decideProviderPromotion>[0]>>) {
      const d = load(over);
      expect(Object.keys(d).sort()).toEqual(["promote", "reason"]);
      expect(typeof d.promote).toBe("boolean");
    }
  });

  it("is pure — the same facts give the same answer", () => {
    expect(load()).toEqual(load());
    expect(load({ active: false })).toEqual(load({ active: false }));
  });
});
