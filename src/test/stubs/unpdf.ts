/**
 * Test-time stand-in for `https://esm.sh/unpdf@0.12.1`.
 *
 * `extract.ts` reads a PDF's text layer through unpdf, and it imports it
 * DYNAMICALLY inside the PDF branch precisely so that a spreadsheet import
 * never depends on it. Vite resolves a literal dynamic specifier at transform
 * time regardless, so a test that imports `extract.ts` for its HTML or CSV
 * branch dies on a package this repo does not install for the browser.
 *
 * It throws rather than pretending: nothing under test reads a PDF, and a
 * silent empty document would be a worse answer than a loud one.
 */
export function getDocumentProxy(): never {
  throw new Error('unpdf is not available in tests; no test exercises the PDF branch.');
}

export function extractText(): never {
  throw new Error('unpdf is not available in tests; no test exercises the PDF branch.');
}
