import { supabase } from '@/integrations/supabase/client';
import type {
  BrandContext, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';
import {
  buildReportQaDocument,
} from '../../../../supabase/functions/_shared/reports/reportQa/normalise.pure';
import type {
  ReportQaSubject,
} from '../../../../supabase/functions/_shared/reports/reportQa/payload.pure';
import { applyReportQaProjection } from '../../../../supabase/functions/_shared/reportQaProjection.pure';
import { applyOrganisationProjection } from '../../../../supabase/functions/_shared/organisationProjection.pure';
import { loadOrganisation } from './organisation';

/**
 * Report Q&A, through the normaliser the format's own render route uses.
 *
 * `buildReportQaDocument` is the same function `render-report-qa-pdf` calls, so
 * a template and the flowing route describe one conversation the same way. The
 * projection then restates that document; neither re-reads
 * `report_qa_messages`.
 *
 * ## The variant picks the subject
 *
 * This format is three documents, not one: the whole `transcript`, a single
 * `answer`, and the conversation's `structured` report. The Cash Flow adapter
 * already establishes that `variant` is what the caller asked for rather than
 * what the row says, and this reads it the same way. `transcript` is the
 * default because it is the only subject that is well-defined without also
 * being told *which* answer.
 *
 * The `structured` subject is accepted but not published by the projection —
 * see `reportQaProjection.pure.ts` for why binding a separately-generated
 * report beside the turns would put two answers to one question on a page.
 */

const CONVERSATION_COLUMNS = 'id, title, report_names, structured_report, created_at';
const MESSAGE_COLUMNS =
  'id, role, content, edited_content, created_at, model_provider, model_version, citations';

function subjectFor(variant: string | null | undefined): ReportQaSubject {
  return variant === 'answer' || variant === 'structured' ? variant : 'transcript';
}

async function loadConversation(id: string) {
  const { data, error } = await supabase
    .from('report_qa_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, any>;
}

async function loadMessages(conversationId: string) {
  const { data, error } = await supabase
    .from('report_qa_messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error || !data) return null;
  return data as Record<string, any>[];
}

export const qaAdapter: ReportTemplateAdapter = {
  reportType: 'qa',
  label: 'Report Q&A',
  supportsProduction: true,
  legacyFallback: {
    label: 'Report Q&A flowing export',
    route: 'render-report-qa-pdf',
    reason:
      'The flowing route paginates a conversation of any length. A template is a '
      + 'fixed page sequence and carries the first exchanges, so it stays the '
      + 'default for a long transcript.',
  },

  async resolveRoutingContext({ reportId, variant }): Promise<RoutingContext | null> {
    const conversation = await loadConversation(reportId);
    if (!conversation) return null;
    const subject = subjectFor(variant);
    return {
      reportId,
      reportType: 'qa',
      variant: subject,
      tier: null,
      title: (conversation.title as string) || 'Report Q&A',
      fileLabel: 'report-qa',
      sourceTable: 'report_qa_conversations',
      legacyFallback: qaAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, variant, brand }:
    { reportId: string; variant?: string | null; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const conversation = await loadConversation(reportId);
    if (!conversation) return null;
    const messages = await loadMessages(reportId);
    if (!messages || messages.length === 0) return null;

    const subject = subjectFor(variant);
    const built = buildReportQaDocument({
      conversation,
      messages,
      subject,
      // The `answer` subject needs a message id and this adapter is not told
      // one, so it takes the first exchange. A caller that wants a particular
      // answer asks the flowing route, which is addressed by message.
      messageId: subject === 'answer' ? (messages.find((m) => m.role === 'assistant')?.id ?? null) : null,
      preparedOn: new Date().toISOString(),
    });
    // A conversation with no assistant turn is not a document. Returning null
    // rather than an empty one is what makes the library card say so.
    if (!built.ok) return null;

    const data: Record<string, any> = {
      report: {
        id: conversation.id,
        type: 'qa',
        generated_at: conversation.created_at,
      },
      conversation,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyReportQaProjection(data, built.document);
    applyOrganisationProjection(data, await loadOrganisation());

    return {
      data,
      meta: { reportId, reportType: 'qa', variant: subject, tier: null },
    };
  },
};
