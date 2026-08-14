/**
 * No adapter reads a table the browser cannot see.
 *
 * ## The defect
 *
 * Command Centre identity is a custom HttpOnly-cookie session, not a Supabase
 * Auth session — `src/integrations/supabase/client.ts` creates the client with
 * the anon key and `persistSession: false`, so `auth.uid()` is **always NULL**
 * in the browser.
 *
 * Three of the tables the report adapters read have exactly one non-service
 * SELECT policy and it is gated on `auth.uid()`:
 *
 *   investment_reports   generated_by = auth.uid() (or a client join on it)
 *   property_comparisons user_id = auth.uid()
 *   clients              created_by = auth.uid()
 *
 * A `supabase.from(...)` read of any of them therefore returns **zero rows for
 * every record and every user** — not an error, an empty result. The adapters
 * read `maybeSingle()`, answered `null`, the router read `null` as "this
 * adapter refuses this record", and the caller fell through to the legacy
 * generator. So a person could choose a template, be told the choice was kept,
 * and receive the standard layout every single time.
 *
 * It is also the mechanical explanation for `docs/reports/COVERAGE.md`: the
 * one format that ever rendered through the design system is the one whose
 * adapter already read through a broker.
 *
 * ## The rule
 *
 * An adapter reads a record through an edge function that holds a service-role
 * client and scopes the read to the verified session user — never through the
 * browser client. This test fails on a direct `.from('<invisible table>')` in
 * the adapter directory, which is the only way this class comes back.
 *
 * The list is deliberately narrow: it names the tables *measured* to be
 * invisible, not every table. A permissive policy on the other sixteen is what
 * makes reading them from the browser legitimate today, and this file is the
 * place to widen the list if that ever changes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BROWSER_INVISIBLE_TABLES } from '@/lib/reportTemplate/adapters/secureSource';

const ADAPTERS = join(__dirname, '../adapters');

const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const adapterFiles = readdirSync(ADAPTERS)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));

describe('the invisible-table list', () => {
  it('names the three measured in production', () => {
    expect([...BROWSER_INVISIBLE_TABLES].sort())
      .toEqual(['clients', 'investment_reports', 'property_comparisons']);
  });
});

describe('every adapter', () => {
  it.each(adapterFiles)('%s reads no browser-invisible table directly', (file) => {
    const code = stripComments(readFileSync(join(ADAPTERS, file), 'utf8'));
    const offenders = BROWSER_INVISIBLE_TABLES.filter(
      (table) => code.includes(`.from('${table}')`),
    );
    expect(
      offenders,
      `${file} reads ${offenders.join(', ')} through the browser client, which returns `
      + 'zero rows under this app\'s custom auth — the read answers "no such record" for '
      + 'every record. Use the brokers in secureSource.ts.',
    ).toEqual([]);
  });

  it('the ones that need a broker import it', () => {
    // The three formats whose entry record lives in an invisible table. If one
    // of these stops importing the module, it is reading its record some other
    // way and that way needs the same scrutiny.
    for (const file of ['cashFlowAdapter.ts', 'comparisonAdapter.ts', 'clientDetailsAdapter.ts']) {
      const code = stripComments(readFileSync(join(ADAPTERS, file), 'utf8'));
      expect(code, `${file} no longer reads through secureSource`).toContain('./secureSource');
    }
  });
});

describe('the brokers themselves', () => {
  const code = stripComments(readFileSync(join(ADAPTERS, 'secureSource.ts'), 'utf8'));

  it('go through the secure invoke path, never the browser client', () => {
    expect(code).toContain('invokeSecureFunction');
    expect(code).not.toContain("from '@/integrations/supabase/client'");
  });

  it('answer null rather than throwing, so a caller’s fallback stays one line', () => {
    // Every failure is a fallback: the caller's next line is the generator
    // that has produced this document for the life of the product.
    const catches = code.match(/catch\s*\{\s*return (null|\[\]);\s*\}/g) ?? [];
    expect(catches.length).toBeGreaterThanOrEqual(4);
  });
});
