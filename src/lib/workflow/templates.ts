/**
 * Starter workflows.
 *
 * These exist to answer "what would I even build with this?" — each one is a
 * real job this business does, wired end to end so it can be opened, read and
 * adapted rather than assembled from a blank canvas.
 *
 * Every node id here must exist in the catalog; `templates.spec.ts` fails the
 * build if one drifts.
 */

import type { WorkflowGraph } from './types';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  /** Integrations the template needs, so the card can warn before it is opened. */
  requires: string[];
  graph: WorkflowGraph;
}

/** Laid out left to right on the same row unless a branch needs a second row. */
const at = (column: number, row = 0) => ({ x: 80 + column * 368, y: 120 + row * 200 });

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'new-client-compliance',
    name: 'Screen every new client',
    description:
      'Runs sanctions and PEP screening the moment a client is added, escalates a hit to the team, and quietly records a clean result.',
    requires: ['comply_advantage'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'platform.client_created', position: at(0), config: { source: 'any' } },
        {
          id: 'screen',
          type: 'comply_advantage.screen',
          position: at(1),
          config: {
            name: '{{trigger.firstName}} {{trigger.lastName}}',
            lists: ['sanction', 'pep'],
            fuzziness: 0.6,
          },
        },
        {
          id: 'decide',
          type: 'core.branch',
          position: at(2),
          config: { left: '{{screen.outcome}}', operator: 'eq', right: 'match' },
        },
        {
          id: 'escalate',
          type: 'core.notify_team',
          position: at(3, -1),
          config: {
            recipient: 'Compliance',
            title: 'Screening hit: {{trigger.firstName}} {{trigger.lastName}}',
            body: 'Risk level {{screen.riskLevel}}. Review before proceeding.',
            priority: 'urgent',
          },
        },
        {
          id: 'record',
          type: 'core.set',
          position: at(3, 1),
          config: { values: [{ key: 'screeningOutcome', value: '{{screen.outcome}}' }] },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'screen' },
        { id: 'e2', source: 'screen', target: 'decide' },
        { id: 'e3', source: 'decide', target: 'escalate', sourceBranch: 'true' },
        { id: 'e4', source: 'decide', target: 'record', sourceBranch: 'false' },
      ],
    },
  },

  {
    id: 'report-delivery',
    name: 'Deliver a finished report',
    description:
      'When an investment report finishes, emails it to the client, logs the delivery against their CRM record, and tells the team it went out.',
    requires: ['resend', 'gohighlevel'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'platform.report_generated', position: at(0), config: { reportType: 'investment' } },
        {
          id: 'compose',
          type: 'core.template',
          position: at(1),
          config: {
            template:
              'Hi {{trigger.clientId}},\n\nYour investment report for {{trigger.propertyAddress}} is ready.\n\nIt covers the numbers we discussed, the comparable sales, and what we think the next step should be.',
          },
        },
        {
          id: 'email',
          type: 'resend.send_email',
          position: at(2),
          config: {
            to: '{{trigger.clientId}}',
            subject: 'Your report for {{trigger.propertyAddress}}',
            html: '{{compose.text}}',
            attachmentUrl: '{{trigger.pdfUrl}}',
          },
        },
        {
          id: 'log',
          type: 'gohighlevel.upsert_contact',
          position: at(3),
          config: { email: '{{trigger.clientId}}', tags: ['client'] },
        },
        {
          id: 'notify',
          type: 'core.notify_team',
          position: at(4),
          config: { recipient: 'Advisors', title: 'Report sent for {{trigger.propertyAddress}}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'compose' },
        { id: 'e2', source: 'compose', target: 'email' },
        { id: 'e3', source: 'email', target: 'log' },
        { id: 'e4', source: 'log', target: 'notify' },
      ],
    },
  },

  {
    id: 'listing-watch',
    name: 'Value a new listing the day it appears',
    description:
      'Watches a suburb, values anything that lands, checks the zoning, and only bothers you when the estimate beats the asking price.',
    requires: ['domain', 'cotality', 'landchecker'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'domain.new_listing', position: at(0), config: { suburb: '', minBedrooms: 3 } },
        {
          id: 'value',
          type: 'cotality.valuation',
          position: at(1),
          config: { address: '{{trigger.address}}', propertyType: 'house' },
        },
        {
          id: 'planning',
          type: 'landchecker.planning_overlays',
          position: at(2),
          config: { address: '{{trigger.address}}' },
        },
        {
          id: 'worthwhile',
          type: 'core.filter',
          position: at(3),
          config: { left: '{{value.estimate}}', operator: 'gt', right: '{{trigger.price}}' },
        },
        {
          id: 'alert',
          type: 'core.notify_team',
          position: at(4),
          config: {
            recipient: 'Buyers agents',
            title: 'Under-priced: {{trigger.address}}',
            body: 'Asking {{trigger.price}}, valued at {{value.estimate}}. Zone {{planning.zone}}.',
            priority: 'high',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'value' },
        { id: 'e2', source: 'value', target: 'planning' },
        { id: 'e3', source: 'planning', target: 'worthwhile' },
        { id: 'e4', source: 'worthwhile', target: 'alert' },
      ],
    },
  },

  {
    id: 'call-follow-up',
    name: 'Turn a call into a follow-up',
    description:
      'Summarises a finished call, drafts the follow-up email, and holds it for approval before anything reaches the client.',
    requires: ['anthropic', 'resend'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'platform.call_completed',
          position: at(0),
          config: { direction: 'any', minDurationSeconds: 60 },
        },
        {
          id: 'draft',
          type: 'anthropic.messages',
          position: at(1),
          config: {
            model: 'claude-sonnet-4',
            system: 'You write brief, warm follow-up emails for an Australian property advisory. No fluff.',
            prompt:
              'Write a follow-up email based on this call transcript. Summarise what was agreed and state the next step.\n\n{{trigger.transcript}}',
            maxTokens: 700,
            temperature: 0.3,
          },
        },
        {
          id: 'approve',
          type: 'core.approval',
          position: at(2),
          config: {
            approver: 'Advisors',
            question: 'Send this follow-up to the client?',
            expiresAfter: '2d',
          },
        },
        {
          id: 'send',
          type: 'resend.send_email',
          position: at(3, -1),
          config: {
            to: '{{trigger.phoneNumber}}',
            subject: 'Following up on our call',
            html: '{{draft.text}}',
          },
        },
        {
          id: 'shelve',
          type: 'core.stop',
          position: at(3, 1),
          config: { outcome: 'skipped', reason: 'Follow-up rejected by {{approve.decidedBy}}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'draft' },
        { id: 'e2', source: 'draft', target: 'approve' },
        { id: 'e3', source: 'approve', target: 'send', sourceBranch: 'approved' },
        { id: 'e4', source: 'approve', target: 'shelve', sourceBranch: 'rejected' },
      ],
    },
  },

  {
    id: 'rate-change-briefing',
    name: 'Brief clients when the cash rate moves',
    description:
      'Picks up an RBA decision, researches what it means for borrowers, and posts a briefing to the team channel for sign-off.',
    requires: ['rba', 'perplexity', 'slack'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'rba.rate_changed', position: at(0), config: {} },
        {
          id: 'research',
          type: 'perplexity.search',
          position: at(1),
          config: {
            model: 'sonar',
            query:
              'The RBA moved the cash rate to {{trigger.cashRate}}%. What does this mean for Australian mortgage holders and property buyers this quarter?',
            recency: 'week',
          },
        },
        {
          id: 'brief',
          type: 'core.template',
          position: at(2),
          config: {
            template:
              'Cash rate is now {{trigger.cashRate}}% ({{trigger.direction}} {{trigger.changeBps}}bps).\n\n{{research.answer}}',
          },
        },
        {
          id: 'post',
          type: 'slack.post_message',
          position: at(3),
          config: { channel: '#market', text: '{{brief.text}}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'research' },
        { id: 'e2', source: 'research', target: 'brief' },
        { id: 'e3', source: 'brief', target: 'post' },
      ],
    },
  },
];
