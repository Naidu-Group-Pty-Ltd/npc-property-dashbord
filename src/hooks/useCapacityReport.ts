/**
 * Generating a Commercial & Industrial Capacity Report, from anywhere.
 *
 * Two surfaces offer this — the results step inside an assessment, and the row
 * action on the assessments list — and they must behave identically. One hook,
 * so the pending state, the error wording and the brand-gap warning cannot
 * differ between them.
 *
 * The `generating` state is keyed by assessment id rather than being a boolean,
 * because on the list there are many rows and only the one that was clicked
 * should show a spinner.
 */
import { useCallback, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import {
  saveTemplateDocument,
  tryTemplateDocument,
} from '@/lib/reportTemplate/templateDocument';
import {
  downloadCapacityReport,
  requestCapacityReport,
} from '@/lib/reports/commercialCapacity/requestCapacityReport';

export interface UseCapacityReport {
  /** Which assessment is currently rendering, or null. */
  generatingId: string | null;
  generate: (assessmentId: string, options?: { refreshAnalysis?: boolean }) => Promise<void>;
}

export function useCapacityReport(): UseCapacityReport {
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const generate = useCallback(async (
    assessmentId: string,
    options?: { refreshAnalysis?: boolean },
  ) => {
    // Guarded rather than queued. A render is a model call, a WeasyPrint job
    // and a stored file; a double-click should not produce two of each.
    if (generatingId) return;
    setGeneratingId(assessmentId);

    // Said up front because it is not fast: nine sections, an AI analysis and a
    // server-side render. Silence for thirty seconds reads as a broken button.
    toast({
      title: 'Generating the capacity report',
      description: 'Reading the saved calculation, writing the analysis and rendering the document.',
    });

    try {
      // An activated template serves the plain "give me the report" case.
      // Never when the caller asked to refresh the analysis: that is a request
      // to re-run the model and persist a new analysis against the run, and a
      // template renders what is stored — answering it with the previous
      // analysis would be answering a different question.
      const templated = options?.refreshAnalysis === true
        ? null
        : await tryTemplateDocument('commercial_capacity', assessmentId);
      if (templated) {
        saveTemplateDocument(templated);
        toast({ title: 'Capacity report ready', description: templated.fileName });
        return;
      }

      const result = await requestCapacityReport({
        assessmentId,
        refreshAnalysis: options?.refreshAnalysis === true,
      });
      await downloadCapacityReport(result);

      // Three separate facts, and each is worth telling. The document arrived;
      // it may be missing its analysis; it may be missing the firm's own
      // details — and the moment to learn the second and third is now, before
      // it is sent, not after.
      const notes = [
        result.pageCount ? `${result.pageCount} pages` : null,
        result.hasAnalysis ? null : result.analysisNote,
        result.brandGaps.length ? `Branding incomplete: ${result.brandGaps.join(', ')}.` : null,
      ].filter(Boolean);

      toast({
        title: 'Capacity report ready',
        description: [result.fileName, ...notes].join(' · '),
      });
    } catch (error) {
      toast({
        title: 'Could not generate the report',
        description: error instanceof Error ? error.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setGeneratingId(null);
    }
  }, [generatingId]);

  return { generatingId, generate };
}
