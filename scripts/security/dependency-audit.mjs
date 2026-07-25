#!/usr/bin/env node
/**
 * Dependency vulnerability gate (SUPPLY-001 / CI-001).
 *
 * Runs `npm audit --json` and fails the build when a vulnerability at or above
 * the blocking severity is present and not explicitly accepted.
 *
 * Design notes:
 *  - Blocks on `high` by default (override with SECURITY_AUDIT_LEVEL:
 *    low|moderate|high|critical). Findings below the threshold are reported as
 *    warnings so they stay visible without breaking every unrelated PR.
 *  - Accepted advisories are listed in
 *    scripts/security/dependency-audit-allowlist.json (by advisory URL or
 *    GHSA/CVE id, each with a reason + review date). Anything not on the
 *    allowlist counts toward the gate.
 *  - `npm audit` exits non-zero when it finds anything; we capture output and
 *    make our own pass/fail decision, so a clean-but-nonzero exit is fine.
 *
 * This is intentionally advisory-database driven (npm's registry mirrors the
 * GitHub Advisory / OSV data), so it needs no extra service. SBOM generation
 * is handled separately in CI via @cyclonedx/cyclonedx-npm.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALLOWLIST_PATH = join(root, 'scripts', 'security', 'dependency-audit-allowlist.json');

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const blockLevel = (process.env.SECURITY_AUDIT_LEVEL || 'high').toLowerCase();
const blockRank = RANK[blockLevel] ?? RANK.critical;

let allow = { advisories: [] };
try {
  allow = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
} catch {
  // No allowlist file -> nothing accepted; that's fine.
}
const accepted = new Set(
  (allow.advisories || []).map((a) => String(a.id || a.url || '').trim()).filter(Boolean)
);

function runAudit() {
  let report;
  try {
    const out = execSync('npm audit --json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    report = JSON.parse(out);
  } catch (e) {
    // npm audit exits 1 when vulnerabilities exist; the JSON is still on stdout.
    if (e.stdout) {
      try { report = JSON.parse(e.stdout); } catch { /* fall through */ }
    }
    if (!report) failAudit(e);
  }

  // Operational failures can also produce parseable JSON. Only accept the
  // documented npm v7+ report shape so registry/audit errors fail closed.
  if (!isRecord(report?.vulnerabilities) || !isRecord(report?.metadata?.vulnerabilities)) {
    failAudit(new Error('`npm audit --json` returned an invalid audit report.'));
  }
  return report;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failAudit(error) {
  console.error('dependency-audit: could not run/parse `npm audit --json`.');
  console.error(error.message);
  process.exit(2);
}

const report = runAudit();

// npm v7+ schema: report.vulnerabilities is keyed by package name.
const vulns = report.vulnerabilities;
const blocking = [];
const belowThreshold = [];

for (const [pkg, v] of Object.entries(vulns)) {
  const severity = String(v.severity || 'info').toLowerCase();
  const rank = RANK[severity] ?? 0;
  // Collect advisory identifiers for allowlist matching.
  const ids = new Set();
  for (const via of v.via || []) {
    if (typeof via === 'object') {
      if (via.url) ids.add(String(via.url));
      if (via.source) ids.add(String(via.source));
      if (via.name && via.title) ids.add(`${via.name}: ${via.title}`);
    }
  }
  const isAccepted = [...ids].some((id) => accepted.has(id)) || accepted.has(pkg);
  const record = { pkg, severity, ids: [...ids], accepted: isAccepted };

  if (rank >= blockRank && !isAccepted) blocking.push(record);
  else if (rank >= blockRank && isAccepted) belowThreshold.push({ ...record, note: 'accepted-via-allowlist' });
  else belowThreshold.push(record);
}

const meta = report.metadata?.vulnerabilities || {};
console.log(
  `Dependency audit: ${meta.total ?? '?'} total ` +
  `(critical ${meta.critical ?? 0}, high ${meta.high ?? 0}, moderate ${meta.moderate ?? 0}, low ${meta.low ?? 0}). ` +
  `Blocking level: ${blockLevel}.`
);

if (belowThreshold.length) {
  console.log(`\nBelow-threshold / accepted (${belowThreshold.length}):`);
  for (const r of belowThreshold) {
    console.log(`  - ${r.pkg} [${r.severity}]${r.note ? ' (' + r.note + ')' : ''}`);
  }
}

if (blocking.length) {
  console.error(`\nDependency audit FAILED — ${blocking.length} vulnerability(ies) at/above "${blockLevel}" not on the allowlist:\n`);
  for (const r of blocking) {
    console.error(`  - ${r.pkg} [${r.severity}]`);
    for (const id of r.ids) console.error(`      ${id}`);
  }
  console.error(
    '\nRemediate (npm audit fix / upgrade), or, if the risk is accepted, add the ' +
    'advisory id/url to scripts/security/dependency-audit-allowlist.json with a reason.'
  );
  process.exit(1);
}

console.log('\nDependency audit passed.');
