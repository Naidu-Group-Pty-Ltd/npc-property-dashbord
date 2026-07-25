import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = join(dirname(fileURLToPath(import.meta.url)), 'dependency-audit.mjs');

function runWithAuditResponse(payload, exitCode = 0) {
  return runWithRawAuditResponse(JSON.stringify(payload), exitCode);
}

function runWithRawAuditResponse(output, exitCode = 0) {
  const binDir = mkdtempSync(join(tmpdir(), 'dependency-audit-test-'));
  const npmShim = join(binDir, 'npm');
  writeFileSync(npmShim, `#!/bin/sh\nprintf '%s\\n' '${output}'\nexit ${exitCode}\n`);
  chmodSync(npmShim, 0o755);

  try {
    return spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}` },
    });
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
}

const metadata = { vulnerabilities: { total: 0, critical: 0, high: 0, moderate: 0, low: 0 } };

test('passes a valid clean npm audit report', () => {
  const result = runWithAuditResponse({ vulnerabilities: {}, metadata });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dependency audit passed/);
});

test('evaluates a valid vulnerability report returned with exit code 1', () => {
  const vulnerabilities = {
    unsafe: { severity: 'critical', via: [{ source: 123, url: 'https://example.test/advisory' }] },
  };
  const result = runWithAuditResponse({ vulnerabilities, metadata }, 1);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dependency audit FAILED/);
});

test('fails closed when npm returns a parseable operational error', () => {
  const result = runWithAuditResponse({ error: { code: 'E403', summary: 'Forbidden' } }, 1);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid audit report/);
  assert.doesNotMatch(result.stdout, /Dependency audit passed/);
});

test('fails closed when npm returns malformed output', () => {
  const result = runWithRawAuditResponse('not-json', 1);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /could not run\/parse/);
  assert.doesNotMatch(result.stdout, /Dependency audit passed/);
});
