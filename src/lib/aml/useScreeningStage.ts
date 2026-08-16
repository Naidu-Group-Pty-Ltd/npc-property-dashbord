/**
 * One batched read of everything Stage 5 needs to explain itself.
 *
 * Five existing read operations, fired once, in parallel, and each one
 * individually failure-tolerant: a read that fails (or that this role may not
 * make) resolves to `null`, and `null` reads as "not available" all the way
 * to the screen. It never reads as a reassuring default — an unread sanctions
 * ledger is not an empty one, and an unread questionnaire is not a clean
 * profile.
 *
 * This hook fetches. It decides nothing: the readings come from
 * `deriveAmlScreeningReadiness` and `deriveAmlScreeningScope`, both pure, and
 * the authority for whether screening actually runs is the server, which
 * fails closed on its own freshness gate regardless of anything shown here.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { amlCasesApi } from "./amlCasesApi";
import { amlVerificationApi } from "./amlVerificationApi";
import {
  deriveAmlScreeningReadiness, type AmlScreeningReadinessReading,
} from "./screeningReadiness";
import {
  deriveAmlScreeningScope, describeScreeningStage, readCaseScreeningPosition,
  type AmlCaseScreeningPosition, type AmlScreeningScopeDecision,
} from "./screeningScope";
import {
  sanctionsListFactsFrom, screeningAnswersFrom, screeningEntityTypeFrom,
  screeningProviderFactsFrom, screeningSubjectFactsFrom,
} from "./screeningStageFacts";

export interface AmlScreeningStageReading {
  readiness: AmlScreeningReadinessReading;
  scope: AmlScreeningScopeDecision;
  position: AmlCaseScreeningPosition;
  stage: ReturnType<typeof describeScreeningStage>;
  loading: boolean;
  reload: () => void;
}

/**
 * A read that may fail, be forbidden, or not exist resolves to null — never
 * to a default. The thunk matters: a synchronous throw (an operation this
 * build does not have) must degrade this card, not take the page down with
 * it.
 */
const tolerate = <T,>(read: () => Promise<T>): Promise<T | null> => {
  try { return read().catch(() => null); } catch { return Promise.resolve(null); }
};

export function useScreeningStage(
  caseId: string,
  caseFacts: { riskRating?: string | null; enhancedDueDiligence?: boolean },
): AmlScreeningStageReading {
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [raw, setRaw] = useState<{
    provider: Awaited<ReturnType<typeof amlVerificationApi.providerReadiness>> | null;
    lists: Awaited<ReturnType<typeof amlVerificationApi.sanctionsListStatus>> | null;
    subjects: Awaited<ReturnType<typeof amlCasesApi.listPartyScreening>> | null;
    review: Awaited<ReturnType<typeof amlCasesApi.getSubmissionReview>> | null;
  }>({ provider: null, lists: null, subjects: null, review: null });

  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([
      tolerate(() => amlVerificationApi.providerReadiness()),
      tolerate(() => amlVerificationApi.sanctionsListStatus()),
      tolerate(() => amlCasesApi.listPartyScreening(caseId)),
      tolerate(() => amlCasesApi.getSubmissionReview(caseId)),
    ]).then(([provider, lists, subjects, review]) => {
      if (!live) return;
      setRaw({ provider, lists, subjects, review });
      setLoading(false);
    });
    return () => { live = false; };
  }, [caseId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return useMemo(() => {
    const readiness = deriveAmlScreeningReadiness(
      raw.provider || raw.lists
        ? {
          provider: screeningProviderFactsFrom(raw.provider),
          lists: sanctionsListFactsFrom(raw.lists?.syncs),
        }
        // Neither read answered: the configuration is unread, which is not
        // the same as unconfigured and must not be reported as a fault.
        : null,
    );

    const nowIso = new Date().toISOString();
    const position = readCaseScreeningPosition(
      screeningSubjectFactsFrom(raw.subjects?.subjects), nowIso);

    const scope = deriveAmlScreeningScope({
      answers: screeningAnswersFrom(raw.review),
      entityType: screeningEntityTypeFrom(raw.review),
      riskRating: caseFacts.riskRating ?? null,
      enhancedDueDiligence: Boolean(caseFacts.enhancedDueDiligence),
      now: nowIso,
      ...position.facts,
    }, readiness);

    return {
      readiness, scope, position,
      stage: describeScreeningStage(scope, readiness),
      loading, reload,
    };
  }, [raw, caseFacts.riskRating, caseFacts.enhancedDueDiligence, loading, reload]);
}
