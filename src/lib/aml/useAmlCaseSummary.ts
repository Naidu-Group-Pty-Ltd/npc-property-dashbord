/**
 * One batched read of the evidence the case Overview summarises.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * The old Overview mounted five self-fetching cards. Rendering it cost
 * thirteen requests: the case, its client requests, three reliance reads
 * for the journey map, a consent read, and seven more from the passport
 * section — each fired from its own `useEffect`, several of them for data
 * the operator had not asked to see.
 *
 * This hook replaces that with a single parallel wave, fired once per
 * case and shared by every Overview component. The passport section and
 * the full journey map moved to Records, so they now load only when
 * somebody opens Records.
 *
 * ── Rules ─────────────────────────────────────────────────────────────
 *  • Every call is an EXISTING read operation. No new server operation,
 *    no direct table access, no widened projection.
 *  • Every call is individually failure-tolerant. A read that fails (or
 *    that this role may not make) resolves to `null`, and `null` reads as
 *    "not available" all the way through to the screen — never as a
 *    reassuring default.
 *  • Nothing here decides anything. It fetches facts; the pure helpers in
 *    `workspaceViewModel.ts` read them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { amlCasesApi } from "./amlCasesApi";
import { amlEntitiesApi } from "./amlEntitiesApi";
import { amlMonitoringApi } from "./amlMonitoringApi";
import { amlRelianceApi, type IndependentAssessment, type RelianceGrant } from "./amlRelianceApi";
import { amlRiskApi } from "./amlRiskApi";
import { amlTransactionsApi } from "./amlTransactionsApi";
import { amlVerificationApi } from "./amlVerificationApi";
import {
  deriveAmlWorkspaceSummary,
  type AmlDocumentFacts,
  type AmlFundingFacts,
  type AmlGateFacts,
  type AmlIdentityFacts,
  type AmlMonitoringFacts,
  type AmlOwnershipFacts,
  type AmlScreeningFacts,
  type AmlWorkspaceCaseFacts,
  type AmlWorkspaceFacts,
  type AmlWorkspaceSummary,
} from "./workspaceViewModel";

export interface AmlCaseEvidence {
  identity: AmlIdentityFacts | null;
  screening: AmlScreeningFacts | null;
  monitoring: AmlMonitoringFacts | null;
  gate: AmlGateFacts | null;
  documents: AmlDocumentFacts | null;
  ownership: AmlOwnershipFacts | null;
  funding: AmlFundingFacts | null;
  grants: RelianceGrant[] | null;
  assessments: IndependentAssessment[] | null;
  /**
   * The matter line for the case header. Only read for roles that could
   * already open Purchase & counterparty — the visibility boundary is
   * exactly the one the section has today.
   */
  matterLabel: string | null;
}

const EMPTY_EVIDENCE: AmlCaseEvidence = {
  identity: null,
  screening: null,
  monitoring: null,
  gate: null,
  documents: null,
  ownership: null,
  funding: null,
  grants: null,
  assessments: null,
  matterLabel: null,
};

export interface AmlCaseSummaryResult {
  /** True until the first wave settles. Cards render their own skeletons. */
  loading: boolean;
  evidence: AmlCaseEvidence;
  facts: AmlWorkspaceFacts;
  summary: AmlWorkspaceSummary;
  refresh: () => Promise<void>;
}

/**
 * Resolve to `null` instead of throwing, so one bad read cannot blank the
 * page. Takes a thunk rather than a promise so a *synchronous* throw — a
 * missing client, a bad argument — is caught too, not just a rejection.
 */
const soft = <T>(run: () => Promise<T>): Promise<T | null> => {
  try {
    return run().then((v) => v, () => null);
  } catch {
    return Promise.resolve(null);
  }
};

export function useAmlCaseSummary(
  caseRow: AmlWorkspaceCaseFacts | null,
  openClientRequests: number | undefined,
  options: { enabled?: boolean; canReadMatter?: boolean } = {},
): AmlCaseSummaryResult {
  const enabled = options.enabled !== false;
  const canReadMatter = options.canReadMatter === true;
  const caseId = caseRow?.id ?? "";
  const [evidence, setEvidence] = useState<AmlCaseEvidence>(EMPTY_EVIDENCE);
  const [loading, setLoading] = useState(false);
  // Guards against a stale wave landing after a newer one.
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!caseId) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const [
        checks,
        screening,
        monitoring,
        gate,
        requirements,
        entities,
        sof,
        grants,
        assessments,
        transactions,
      ] = await Promise.all([
        soft(() => amlVerificationApi.listVerificationChecks(caseId)),
        soft(() => amlCasesApi.listPartyScreening(caseId)),
        soft(() => amlMonitoringApi.caseMonitoringSummary(caseId)),
        soft(() => amlRiskApi.gateContract(caseId)),
        soft(() => amlCasesApi.listRequirements(caseId)),
        soft(() => amlEntitiesApi.listEntitiesForCase(caseId)),
        soft(() => amlMonitoringApi.listSof({ case_id: caseId })),
        soft(() => amlRelianceApi.listGrants(caseId)),
        soft(() => amlRelianceApi.listAssessments(caseId)),
        canReadMatter
          ? soft(() => amlTransactionsApi.listTransactions(caseId))
          : Promise.resolve(null),
      ]);
      if (mine !== seq.current) return;

      const matter = (transactions?.transactions ?? []).find(
        (t) => t.property_address || t.reference,
      );

      setEvidence({
        identity: checks ? { checks: checks.checks ?? [] } : null,
        screening: screening ? { subjects: screening.subjects ?? [] } : null,
        monitoring: monitoring?.monitoring ?? null,
        gate: gate?.gate ?? null,
        documents: requirements ? { requirements: requirements.requirements ?? [] } : null,
        ownership: entities ? { links: entities.links ?? [] } : null,
        funding: sof ? { sources: sof.items ?? [] } : null,
        grants: grants?.grants ?? null,
        assessments: assessments?.assessments ?? null,
        matterLabel: matter?.property_address ?? matter?.reference ?? null,
      });
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [caseId, canReadMatter]);

  useEffect(() => {
    if (!enabled || !caseId) return;
    void load();
  }, [enabled, caseId, load]);

  // A case that has not loaded yet still gets a coherent (empty) reading, so
  // nothing downstream has to special-case `null`.
  const fallbackCase: AmlWorkspaceCaseFacts = { status: "draft" };

  const facts = useMemo<AmlWorkspaceFacts>(
    () => ({
      caseRow: caseRow ?? fallbackCase,
      openClientRequests,
      identity: evidence.identity,
      screening: evidence.screening,
      monitoring: evidence.monitoring,
      gate: evidence.gate,
      documents: evidence.documents,
      ownership: evidence.ownership,
      funding: evidence.funding,
    }),
    // `fallbackCase` is a constant literal, so it is intentionally not a dep.
    [caseRow, openClientRequests, evidence],
  );

  const summary = useMemo(() => deriveAmlWorkspaceSummary(facts), [facts]);

  return { loading, evidence, facts, summary, refresh: load };
}
