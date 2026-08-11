import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What the Client Portal may learn about a document, and what it may open.
 *
 * The visible fix here was a UI one — the Documents step never read the
 * document list, so uploads vanished from the page. Making them visible adds
 * exactly one new server capability: opening a file the customer has already
 * sent us. That capability is the part worth guarding, because a document id
 * is a value clients legitimately hold for their own files and can guess for
 * anybody else's.
 *
 * Source-text assertions, in the shape `amlPortalContracts.test.ts` already
 * uses: these are boundary properties that must not quietly regress, and the
 * cheapest place to catch a regression is where the boundary is written.
 */
const repo = process.cwd();
const portal = readFileSync(join(repo, 'supabase/functions/aml-client-portal/index.ts'), 'utf8');
const portalApi = readFileSync(join(repo, 'src/lib/aml/amlPortalApi.ts'), 'utf8');
const step = readFileSync(join(repo, 'src/components/portal/DocumentsStep.tsx'), 'utf8');

/** The `get_document_url` branch, to the start of the next op. */
const documentUrlBranch = portal.slice(
  portal.indexOf("case 'get_document_url'"),
  portal.indexOf("case 'list_client_requests'"),
);
/** The `list_documents` branch. */
const listBranch = portal.slice(
  portal.indexOf("case 'list_documents'"),
  portal.indexOf("case 'get_document_url'"),
);

describe('list_documents stays portal-safe', () => {
  it('returns the projection the client contract declares, and no more', () => {
    // The columns are named explicitly rather than `select('*')` — the staff
    // function selects `*`, and copying that here would ship `storage_path`,
    // `checksum`, `uploaded_by` and the reviewer to the browser.
    expect(listBranch).toContain(
      "'id, requirement_id, filename, mime_type, size_bytes, status, uploaded_at, rejection_reason'");
    expect(listBranch).not.toContain("select('*')");
  });

  it('never exposes a storage path, bucket or checksum', () => {
    for (const internal of ['storage_path', 'checksum', 'uploaded_by', 'reviewed_by', 'metadata']) {
      expect(listBranch).not.toContain(internal);
    }
  });

  it('is scoped to a case the caller owns and hides deleted rows', () => {
    expect(listBranch).toContain('resolveCase(body.case_id)');
    expect(listBranch).toContain("eq('case_id', c.id)");
    expect(listBranch).toContain("neq('status', 'deleted')");
  });

  it('the declared client type carries nothing the projection does not', () => {
    const contract = portalApi.slice(
      portalApi.indexOf('export interface AmlPortalDocument'),
      portalApi.indexOf('export const amlPortalApi'));
    for (const internal of ['storage_path', 'bucket', 'checksum', 'uploaded_by', 'reviewed_by']) {
      expect(contract).not.toContain(internal);
    }
  });
});

describe('get_document_url proves ownership twice', () => {
  it('exists', () => {
    expect(documentUrlBranch.length).toBeGreaterThan(0);
  });

  it('resolves the case through the portal session', () => {
    // `resolveCase` is what ties `case_id` to the authenticated client.
    expect(documentUrlBranch).toContain('resolveCase(body.case_id)');
    expect(documentUrlBranch).toMatch(/if \(!c\) return jsonResponse\(\{ error: 'No case' \}, 404\)/);
  });

  it('requires the document to belong to THAT case', () => {
    /*
     * The load-bearing line. Without it a document id alone would open any
     * document in the system — and a client legitimately holds ids for their
     * own files, so the id space is not a secret.
     */
    expect(documentUrlBranch).toContain("eq('case_id', c.id)");
    expect(documentUrlBranch).toContain("eq('id', String(body.document_id))");
    expect(documentUrlBranch).toContain("neq('status', 'deleted')");
  });

  it('answers the same way for missing, deleted and someone else’s', () => {
    // Distinguishing them would confirm that an id exists on another case.
    const notFound = documentUrlBranch.match(/jsonResponse\(\{ error: 'Document not found' \}, 404\)/g);
    expect(notFound).toHaveLength(1);
  });

  it('takes the bucket and the path from the server, never the request', () => {
    // A caller-supplied path is directory traversal; a caller-supplied bucket
    // turns this into a general-purpose read of the project's storage.
    expect(documentUrlBranch).toContain("from('aml-documents')");
    expect(documentUrlBranch).toContain('createSignedUrl(doc.storage_path');
    expect(documentUrlBranch).not.toMatch(/body\.(storage_path|bucket|path)/);
  });

  it('signs for seconds, not hours', () => {
    const ttl = documentUrlBranch.match(/createSignedUrl\(doc\.storage_path,\s*(\d+)/)?.[1];
    expect(Number(ttl)).toBeGreaterThan(0);
    expect(Number(ttl)).toBeLessThanOrEqual(300);
  });

  it('serves as an attachment', () => {
    /*
     * `request_upload_url` does not constrain the stored content type, and the
     * storage origin is the same host as this API — so an inline-served HTML
     * upload would execute there. An attachment disposition removes that and
     * costs the customer nothing.
     */
    expect(documentUrlBranch).toContain('download: doc.filename');
  });

  it('never echoes the storage error, which carries the path', () => {
    expect(documentUrlBranch).toMatch(/console\.error\('\[aml-client-portal\] document url signing failed'\)/);
    expect(documentUrlBranch).not.toMatch(/signErr\.message|String\(signErr/);
  });
});

describe('the browser holds no route to a document except through the server', () => {
  it('never builds a storage URL itself', () => {
    for (const source of [step, portalApi]) {
      expect(source).not.toContain('storage/v1/object');
      expect(source).not.toContain('aml-documents');
      expect(source).not.toContain('createSignedUrl');
    }
  });

  it('sends both the case and the document id when opening one', () => {
    expect(portalApi).toMatch(/documentUrl: \(case_id: string, document_id: string\)/);
    expect(step).toContain('amlPortalApi.documentUrl(caseId, doc.id)');
  });

  it('keeps the signed URL out of storage and out of the log', () => {
    // It is a credential with a deadline: fetched at the click, used, dropped.
    expect(step).not.toMatch(/(localStorage|sessionStorage)\.setItem/);
    expect(step).not.toMatch(/console\.(log|info|warn|error)\([^)]*url/i);
    expect(step).not.toMatch(/setState[^)]*url|useState<string[^>]*>\(\s*\)\s*;?\s*\/\/\s*url/i);
  });
});

describe('the upload path is unchanged', () => {
  it('still goes signed-URL then server-side confirm', () => {
    expect(portal).toContain("case 'request_upload_url'");
    expect(portal).toContain("case 'confirm_upload'");
    expect(portal).toContain('createSignedUploadUrl(key)');
    // Confirm still verifies the object landed and that the path is inside the
    // case's own prefix.
    expect(portal).toContain("pathParts[0] !== c.id");
  });

  it('still coerces a foreign requirement id to null rather than trusting it', () => {
    const confirm = portal.slice(
      portal.indexOf("case 'confirm_upload'"), portal.indexOf("case 'list_documents'"));
    expect(confirm).toContain('if (!rr || rr.case_id !== c.id) reqId = null;');
  });

  it('does not delete or supersede prior rows — no history model was invented', () => {
    const confirm = portal.slice(
      portal.indexOf("case 'confirm_upload'"), portal.indexOf("case 'list_documents'"));
    expect(confirm).not.toMatch(/status: 'superseded'/);
    expect(confirm).not.toMatch(/\.delete\(\)/);
  });
});
