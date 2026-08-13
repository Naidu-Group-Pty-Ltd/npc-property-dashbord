/**
 * The render calls must go through the app's ONE transport.
 *
 * These call sites used to address the edge function as
 * `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/…`. The
 * hosting build defines that variable, so it worked in production — but the
 * repo ships no `.env` and `vite.config.ts` declares no fallback, so a repo or
 * CI build compiled the render path, and only the render path, into a request
 * to `https://undefined.supabase.co`. Nothing else in the app is exposed to
 * that: `integrations/supabase/client.ts` and `secureInvoke.ts` hardcode the
 * project.
 *
 * These tests pin the properties that removes: the render goes through
 * `invokeSecureFunction`, and no render module reads a Supabase URL out of
 * `import.meta.env` or hand-rolls a fetch to the functions gateway.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const invokeSecureFunction = vi.fn();
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: (...args: unknown[]) => invokeSecureFunction(...args),
  describeAuthError: () => null,
}));

const REPO_SRC = join(process.cwd(), 'src');
const RENDER_MODULES = [
  'lib/reportTemplate/weasyRenderClient.ts',
  'lib/reportTemplate/weasyPreview.ts',
  'components/templateBuilder/ExportPipelineDialog.tsx',
];

afterEach(() => {
  invokeSecureFunction.mockReset();
});

describe('render-template-pdf transport', () => {
  it('renderHtmlToPdfUrl calls the function by NAME, never a constructed host', async () => {
    invokeSecureFunction.mockResolvedValue({ data: { url: 'https://signed/doc.pdf' }, error: null });
    const { renderHtmlToPdfUrl } = await import('../weasyRenderClient');

    const url = await renderHtmlToPdfUrl({ html: '<p>x</p>', fileName: 'a.pdf' });

    expect(url).toBe('https://signed/doc.pdf');
    expect(invokeSecureFunction).toHaveBeenCalledTimes(1);
    const [fnName, body] = invokeSecureFunction.mock.calls[0];
    expect(fnName).toBe('render-template-pdf');
    expect(body).toMatchObject({ html: '<p>x</p>', fileName: 'a.pdf', mode: 'preview' });
  });

  it('surfaces a render failure instead of resolving to an unusable URL', async () => {
    invokeSecureFunction.mockResolvedValue({ data: null, error: { message: 'Authentication required' } });
    const { renderHtmlToPdfUrl } = await import('../weasyRenderClient');
    await expect(renderHtmlToPdfUrl({ html: '<p>x</p>', fileName: 'a.pdf' }))
      .rejects.toThrow(/Authentication required/);
  });

  it('refuses a success response that carries no document URL', async () => {
    invokeSecureFunction.mockResolvedValue({ data: {}, error: null });
    const { renderHtmlToPdfUrl } = await import('../weasyRenderClient');
    await expect(renderHtmlToPdfUrl({ html: '<p>x</p>', fileName: 'a.pdf' }))
      .rejects.toThrow(/no document URL/);
  });

  it('no render module builds a Supabase host from import.meta.env', () => {
    // Comments are stripped first: these files DOCUMENT the outage by naming
    // the variables, and a guard that fired on the explanation would push the
    // next reader to delete the explanation.
    const stripComments = (source: string) => source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    for (const relative of RENDER_MODULES) {
      const code = stripComments(readFileSync(join(REPO_SRC, relative), 'utf8'));
      // The exact shape that shipped requests to `https://undefined.supabase.co`.
      expect(code, `${relative} must not construct a Supabase host from env`)
        .not.toMatch(/VITE_SUPABASE_PROJECT_ID/);
      expect(code, `${relative} must not read the anon key from env`)
        .not.toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY/);
      expect(code, `${relative} must not hand-roll a fetch to the functions gateway`)
        .not.toMatch(/fetch\([^)]*functions\/v1/);
    }
  });
});
