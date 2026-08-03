import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const source = readFileSync(join(
  root,
  'src/components/admin/builder-portal/ui/BuilderOrganisationFormDialog.tsx',
), 'utf8');

const headerStart = source.indexOf('<DialogHeader');
const headerEnd = source.indexOf('</DialogHeader>');
const bodyStart = source.indexOf('data-testid="builder-organisation-form-body"');
const bodyEnd = source.indexOf('</div>', source.indexOf('builder-org-notes'));
const footerStart = source.indexOf('<DialogFooter');

test('organisation dialog uses a viewport-constrained flex shell', () => {
  assert.match(source, /<DialogContent\s+bareLayout\s+className="[^"]*flex[^"]*max-h-\[calc\(100dvh-2rem\)\][^"]*w-\[calc\(100vw-2rem\)\][^"]*overflow-hidden/);
  assert.match(source, /className="[^"]*sm:max-w-2xl/);
  assert.doesNotMatch(source, /max-h-\[90vh\] overflow-y-auto/);
});

test('header, scrolling body, and footer are three ordered sibling sections', () => {
  assert.ok(headerStart !== -1 && headerStart < headerEnd);
  assert.ok(headerEnd < bodyStart, 'header must end before the scrolling body');
  assert.ok(bodyStart < bodyEnd, 'form fields must be inside the scrolling body');
  assert.ok(bodyEnd < footerStart, 'footer must follow the scrolling body');
  assert.match(source.slice(headerStart, headerEnd), /shrink-0/);
  assert.match(source.slice(footerStart), /shrink-0/);
});

test('dedicated form body is keyboard-focusable and vertically scrollable', () => {
  const bodyOpeningTag = source.slice(source.lastIndexOf('<div', bodyStart), source.indexOf('>', bodyStart) + 1);
  for (const utility of [
    'min-h-0', 'flex-1', 'overflow-x-hidden', 'overflow-y-auto', 'overscroll-contain',
    'touch-pan-y', '[scrollbar-gutter:stable]', '[scrollbar-width:thin]',
  ]) {
    assert.ok(bodyOpeningTag.includes(utility), `scrolling body is missing ${utility}`);
  }
  assert.match(bodyOpeningTag, /tabIndex=\{0\}/);
  assert.match(bodyOpeningTag, /aria-label="Organisation details"/);
  assert.match(bodyOpeningTag, /webkit-scrollbar-thumb/);
});

test('every organisation field remains present and in its original order', () => {
  const fields = [
    'legal-name', 'trading-name', 'type', 'abn', 'acn', 'email', 'phone', 'website',
    'address1', 'address2', 'suburb', 'state', 'postcode', 'notes',
  ];
  let previous = bodyStart;
  for (const field of fields) {
    const position = source.indexOf(`builder-org-${field}`, previous);
    assert.ok(position > previous, `${field} is missing or out of order`);
    previous = position;
  }
  assert.ok(previous < footerStart, 'all fields must remain above the fixed footer');
});

test('add and edit state population and submission contracts are unchanged', () => {
  assert.match(source, /const editing = !!initial/);
  assert.match(source, /if \(!initial\) \{ setForm\(EMPTY\); return; \}/);
  assert.match(source, /initial\[key\] \?\? EMPTY\[key\]/);
  assert.match(source, /onClick=\{\(\) => onSubmit\(form\)\}/);
  assert.match(source, /editing \? 'Save changes' : 'Create'/);
});

test('legal-name validation and Cancel behavior are unchanged', () => {
  assert.match(source, /disabled=\{busy \|\| !form\.legal_name\.trim\(\)\}/);
  assert.match(source, /onClick=\{\(\) => onOpenChange\(false\)\}/);
});

test('footer stays visually separated outside the scrolling body', () => {
  const footerOpeningTag = source.slice(footerStart, source.indexOf('>', footerStart) + 1);
  assert.match(footerOpeningTag, /border-t/);
  assert.match(footerOpeningTag, /bg-background/);
  assert.match(footerOpeningTag, /shrink-0/);
});
