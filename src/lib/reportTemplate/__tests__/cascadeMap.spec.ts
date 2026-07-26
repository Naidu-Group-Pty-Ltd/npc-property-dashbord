import { describe, expect, it } from 'vitest';
import {
  buildCascadeActivationReadiness,
  buildCascadeAnchorSuggestions,
  buildCascadeDiagnosticsExport,
  buildCascadeMap,
  cascadeDiagnosticsToCsv,
  contractFromStructureTemplate,
  makeFieldAnchor,
  patchCascadeAnchorsQaStatus,
} from '../cascadeMap';
import { renderTemplateToHtml } from '../htmlRenderer';
import type { ReportTemplate } from '../templateSchema';

const baseTemplate = (anchors: any[] = []): ReportTemplate => ({
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  slots: {},
  pages: [{
    id: 'p1',
    name: 'Page 1',
    size: { width: 595, height: 842 },
    background: {},
    blocks: [{
      id: 'b1',
      type: 'free',
      props: {},
      overlays: [{
        id: 'o1',
        type: 'text',
        x: 10,
        y: 10,
        width: 200,
        height: 80,
        rotation: 0,
        opacity: 1,
        content: '{{sections.executive_summary.body}}',
        fontFamily: 'Helvetica',
        fontSize: 12,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#111111',
        align: 'left',
        lineHeight: 1.3,
        letterSpacing: 0,
        anchors,
      } as any],
    }],
  }],
});

describe('report template cascade map', () => {
  it('builds a contract from report-structure headings', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', name: 'Compass', parsed_content: '## Executive Summary\n\n## Risk Register' });
    expect(contract.structureTemplateId).toBe('rst1');
    expect(contract.sections.map((s) => s.id)).toEqual(['executive_summary', 'risk_register']);
    expect(contract.sections[0].fields.map((f) => f.path)).toContain('sections.executive_summary.body');
  });

  it('maps anchored visual targets to required structure sections', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', parsed_content: '## Executive Summary\n\n## Risk Register' });
    const anchor = makeFieldAnchor(contract.sections[0].fields.find((f) => f.path.endsWith('.body'))!);
    const cascade = buildCascadeMap(baseTemplate([anchor]), contract, { data: { sections: { executive_summary: { body: 'Hello' } } } });
    expect(cascade.stats.totalAnchors).toBe(1);
    expect(cascade.sections.find((s) => s.sectionId === 'executive_summary')?.status).toBe('mapped');
    expect(cascade.sections.find((s) => s.sectionId === 'risk_register')?.status).toBe('missing_anchor');
    expect(cascade.issues.some((i) => i.code === 'missing_required_anchor' && i.sectionId === 'risk_register')).toBe(true);
  });

  it('suggests cascade anchors from unanchored section bindings', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', parsed_content: '## Executive Summary' });
    const suggestions = buildCascadeAnchorSuggestions(baseTemplate(), contract);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      pageId: 'p1',
      blockId: 'b1',
      overlayId: 'o1',
      fieldPath: 'sections.executive_summary.body',
      sectionId: 'executive_summary',
      reason: 'exact_binding_match',
    });
    expect(suggestions[0].anchor.bindingPath).toBe('sections.executive_summary.body');
  });

  it('deduplicates auto-map suggestions by field while reporting repeated binding uses', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', parsed_content: '## Executive Summary' });
    const template = baseTemplate();
    template.pages[0].blocks[0].overlays.push({
      ...(template.pages[0].blocks[0].overlays[0] as any),
      id: 'o2',
      y: 120,
    });

    const suggestions = buildCascadeAnchorSuggestions(template, contract);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].duplicateBindingCount).toBe(2);
  });

  it('can include every repeated binding target when requested', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', parsed_content: '## Executive Summary' });
    const template = baseTemplate();
    template.pages[0].blocks[0].overlays.push({
      ...(template.pages[0].blocks[0].overlays[0] as any),
      id: 'o2',
      y: 120,
      anchors: undefined,
    });

    expect(buildCascadeAnchorSuggestions(template, contract)).toHaveLength(1);
    const allSuggestions = buildCascadeAnchorSuggestions(template, contract, { includeDuplicates: true });
    expect(allSuggestions).toHaveLength(2);
    expect(allSuggestions.map((suggestion) => suggestion.overlayId)).toEqual(['o1', 'o2']);
  });

  it('can suggest unanchored repeated targets when the same field is already anchored elsewhere', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', parsed_content: '## Executive Summary' });
    const anchor = makeFieldAnchor(contract.sections[0].fields.find((f) => f.path.endsWith('.body'))!);
    const template = baseTemplate([anchor]);
    template.pages[0].blocks[0].overlays.push({
      ...(template.pages[0].blocks[0].overlays[0] as any),
      id: 'o2',
      y: 120,
      anchors: undefined,
    });

    expect(buildCascadeAnchorSuggestions(template, contract)).toEqual([]);
    const repeated = buildCascadeAnchorSuggestions(template, contract, { includeDuplicates: true });
    expect(repeated).toHaveLength(1);
    expect(repeated[0].overlayId).toBe('o2');
  });

  it('does not suggest anchors for already anchored bindings', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', parsed_content: '## Executive Summary' });
    const anchor = makeFieldAnchor(contract.sections[0].fields.find((f) => f.path.endsWith('.body'))!);
    expect(buildCascadeAnchorSuggestions(baseTemplate([anchor]), contract)).toEqual([]);
  });

  it('summarizes cascade activation readiness with blockers and auto-map actions', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', parsed_content: '## Executive Summary\n\n## Risk Register' });
    const cascade = buildCascadeMap(baseTemplate(), contract, { data: { sections: { executive_summary: { body: 'Hello' } } } });
    const suggestions = buildCascadeAnchorSuggestions(baseTemplate(), contract);
    const readiness = buildCascadeActivationReadiness(cascade, suggestions);

    expect(readiness.status).toBe('blocked');
    expect(readiness.blockerCount).toBe(1);
    expect(readiness.autoMapSuggestionCount).toBe(1);
    expect(readiness.blockers[0]).toMatchObject({ code: 'missing_required_anchor', sectionId: 'risk_register' });
    expect(readiness.nextActions).toContain('Map every required report-structure section before activation.');
    expect(readiness.nextActions).toContain('Review and apply Cascade auto-map suggestions for existing bindings.');
  });

  it('bulk patches cascade anchor QA status with filters', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', parsed_content: '## Executive Summary' });
    const anchor = makeFieldAnchor(contract.sections[0].fields.find((f) => f.path.endsWith('.body'))!);
    const template = baseTemplate([{ ...anchor, qaStatus: 'needs_changes' as const }]);

    const { next, updated } = patchCascadeAnchorsQaStatus(
      template,
      { qaStatus: 'approved', qaOwner: 'QA Lead', qaNote: 'Verified final PDF placement', qaReviewedAt: '2026-06-11T00:00:00.000Z' },
      { currentStatuses: ['needs_changes'], requiredOnly: true },
    );

    expect(updated).toBe(1);
    const patchedAnchor = (next.pages[0].blocks[0].overlays[0] as any).anchors[0];
    expect(patchedAnchor).toMatchObject({
      qaStatus: 'approved',
      qaOwner: 'QA Lead',
      qaNote: 'Verified final PDF placement',
      qaReviewedAt: '2026-06-11T00:00:00.000Z',
    });
  });

  it('can require QA-approved anchors for required mapped sections', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', parsed_content: '## Executive Summary' });
    const unapprovedAnchor = makeFieldAnchor(contract.sections[0].fields.find((f) => f.path.endsWith('.body'))!);
    const unapproved = buildCascadeActivationReadiness(
      buildCascadeMap(baseTemplate([unapprovedAnchor]), contract),
      [],
      { requireQaApproved: true },
    );
    expect(unapproved.status).toBe('blocked');
    expect(unapproved.qaApprovalRequiredCount).toBe(1);
    expect(unapproved.blockers[0]).toMatchObject({ code: 'qa_approval_required', sectionId: 'executive_summary' });

    const approvedAnchor = { ...unapprovedAnchor, qaStatus: 'approved' as const };
    const approved = buildCascadeActivationReadiness(
      buildCascadeMap(baseTemplate([approvedAnchor]), contract),
      [],
      { requireQaApproved: true },
    );
    expect(approved.status).toBe('ready');
    expect(approved.qaApprovedRequiredSections).toBe(1);
    expect(approved.nextActions).toContain('Cascade coverage and QA approvals are ready for activation.');
  });

  it('exports cascade diagnostics as stable JSON and CSV manifest data', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', name: 'Compass', parsed_content: '## Executive Summary\n\n## Risk Register' });
    const anchor = {
      ...makeFieldAnchor(contract.sections[0].fields.find((f) => f.path.endsWith('.body'))!),
      qaStatus: 'needs_changes' as const,
      qaOwner: 'Reviewer A',
      qaNote: 'Needs a stronger visual landing point.',
    };
    const cascade = buildCascadeMap(baseTemplate([anchor]), contract, {
      data: { sections: { executive_summary: { body: 'Hello' } } },
      templateId: 'tpl1',
    } as any);

    const diagnostics = buildCascadeDiagnosticsExport(cascade, contract, { generatedAt: '2026-06-11T00:00:00.000Z' });
    expect(diagnostics.generatedAt).toBe('2026-06-11T00:00:00.000Z');
    expect(diagnostics.templateId).toBe('tpl1');
    expect(diagnostics.structure.templateId).toBe('rst1');
    expect(diagnostics.sections.find((s) => s.sectionId === 'executive_summary')?.fields.find((f) => f.path === 'sections.executive_summary.body')?.mapped).toBe(true);
    expect(diagnostics.sections.find((s) => s.sectionId === 'risk_register')?.status).toBe('missing_anchor');
    expect(diagnostics.issues.some((issue) => issue.code === 'missing_required_anchor' && issue.sectionId === 'risk_register')).toBe(true);
    expect(diagnostics.sections[0].targets[0]).toMatchObject({ qaStatus: 'needs_changes', qaOwner: 'Reviewer A' });

    const csv = cascadeDiagnosticsToCsv(diagnostics);
    expect(csv).toContain('section_id,section_label,section_status');
    expect(csv).toContain('sections.executive_summary.body');
    expect(csv).toContain('missing_required_anchor');
    expect(csv).toContain('Reviewer A');
    expect(csv).toContain('Needs a stronger visual landing point.');
  });

  it('neutralizes spreadsheet formulas in cascade diagnostics CSV cells', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', parsed_content: '## =Malicious section' });
    const anchor = makeFieldAnchor(contract.sections[0].fields.find((field) => field.path.endsWith('.body'))!);
    const template = baseTemplate([anchor]);
    template.pages[0].name = '+Malicious page';
    template.pages[0].blocks[0].id = '-malicious-block';
    (template.pages[0].blocks[0].overlays[0] as any).id = '@malicious-overlay';
    (template.pages[0].blocks[0].overlays[0] as any).anchors[0].qaOwner = '\tmalicious-owner';
    (template.pages[0].blocks[0].overlays[0] as any).anchors[0].qaNote = '\rmalicious-note';

    const cascade = buildCascadeMap(template, contract);
    const csv = cascadeDiagnosticsToCsv(buildCascadeDiagnosticsExport(cascade, contract));

    expect(csv).toContain("'=Malicious section");
    expect(csv).toContain('1:+Malicious page');
    expect(csv).toContain("'-malicious-block");
    expect(csv).toContain("'@malicious-overlay");
    expect(csv).toContain("'\tmalicious-owner");
    expect(csv).toContain("\"'\rmalicious-note\"");
    expect(csv).not.toMatch(/(?:^|,)"?[=+\-@\t\r]/m);
  });

  it('can emit cascade metadata and debug tags in HTML render mode', () => {
    const contract = contractFromStructureTemplate({ id: 'rst1', parsed_content: '## Executive Summary' });
    const anchor = {
      ...makeFieldAnchor(contract.sections[0].fields.find((f) => f.path.endsWith('.body'))!),
      qaStatus: 'approved' as const,
      qaOwner: 'QA Lead',
      qaNote: 'Approved repeated executive summary placement.',
    };
    const { html } = renderTemplateToHtml(baseTemplate([anchor]), {
      data: { sections: { executive_summary: { body: 'Hello' } } },
      cascadeMetadata: true,
      cascadeDebug: true,
    });
    expect(html).toContain('data-cascade-field-path="sections.executive_summary.body"');
    expect(html).toContain('data-cascade-qa-status="approved"');
    expect(html).toContain('§ Executive Summary Body');
    expect(html).toContain('Cascade anchor index');
    expect(html).toContain('block b1 / overlay o1');
    expect(html).toContain('QA Lead');
    expect(html).toContain('Approved repeated executive summary placement.');
  });
});
