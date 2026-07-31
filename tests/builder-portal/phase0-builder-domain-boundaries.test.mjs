/**
 * Builder / Developer Portal — Phase 0 boundary and semantics characterisation.
 *
 * Baseline: a2ec188faa806ff97cb272f7f5a8bcf56b984cb1
 *
 * Two halves:
 *
 *   A. Reference implementations of the PROPOSED Builder access-resolution and
 *      lifecycle semantics, exercised against tests/builder-portal/fixtures/
 *      phase-0-scenarios.json. Nothing here touches production code — these are
 *      executable specifications. When a later phase implements the real
 *      resolver, it must reproduce these outcomes, and the reference
 *      implementations below are replaced by imports of the real ones.
 *
 *   B. Assertions against the repository proving the Builder data boundaries
 *      hold at this baseline.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/phase-0-scenarios.json', import.meta.url), 'utf8'));
const now = Date.parse(fixture.evaluationTime);

// ===========================================================================
// A. Executable specification of the proposed Builder semantics
// ===========================================================================

const SCOPE_SPECIFICITY = {
  organisation: 1, development: 2, project: 3, stage: 4, unit: 5, transaction: 6,
};

const projectOf = (scopeType, scopeId) => {
  if (scopeType === 'project') return scopeId;
  if (scopeType === 'stage') return fixture.stages.find((stage) => stage.id === scopeId)?.project_id;
  if (scopeType === 'unit') {
    const unit = fixture.units.find((item) => item.id === scopeId);
    return fixture.stages.find((stage) => stage.id === unit?.stage_id)?.project_id;
  }
  return null;
};

/** A grant is live only if it is unrevoked and inside its validity window. */
const isLive = (grant) =>
  !grant.revoked_at
  && Date.parse(grant.valid_from) <= now
  && (!grant.valid_until || Date.parse(grant.valid_until) > now);

/**
 * Organisation containment: the grant's organisation must match the user's, and
 * the scope must resolve to a project that organisation is an active party to.
 * A grant that fails containment is inert, never merely narrowed.
 */
const isContained = (grant) => {
  const user = fixture.users.find((item) => item.id === grant.builder_user_id);
  if (!user || user.organisation_id !== grant.organisation_id) return false;
  const organisation = fixture.organisations.find((item) => item.id === grant.organisation_id);
  if (!organisation?.is_active) return false;
  const project = projectOf(grant.scope_type, grant.scope_id);
  if (!project) return grant.scope_type === 'organisation';
  return fixture.projectParties.some((party) =>
    party.project_id === project
    && party.organisation_id === grant.organisation_id
    && !party.revoked_at);
};

/** Does this grant's scope cover the target unit? Inheritance is downward only. */
const covers = (grant, unitId) => {
  const unit = fixture.units.find((item) => item.id === unitId);
  if (!unit) return false;
  if (grant.scope_type === 'unit') return grant.scope_id === unitId;
  if (grant.scope_type === 'stage') return grant.scope_id === unit.stage_id;
  if (grant.scope_type === 'project') return grant.scope_id === projectOf('unit', unitId);
  if (grant.scope_type === 'organisation') return isContained(grant);
  return false;
};

/**
 * Resolve one permission key at one level for one user against one unit.
 * Deny by default. Most specific scope wins. At equal specificity, deny wins.
 * read_only clamps edit and delete last. Forbidden keys can never be granted.
 */
const resolve = (userId, unitId, key, level) => {
  if (fixture.forbiddenKeys.includes(key)) return false;

  const applicable = fixture.grants
    .filter((grant) => grant.builder_user_id === userId)
    .filter(isLive)
    .filter(isContained)
    .filter((grant) => covers(grant, unitId));

  let decision = false;
  let winningSpecificity = -1;

  for (const grant of applicable) {
    const value = grant.permissions?.[key]?.[level];
    if (value !== 'allow' && value !== 'deny') continue;
    const specificity = SCOPE_SPECIFICITY[grant.scope_type];
    if (specificity > winningSpecificity) {
      winningSpecificity = specificity;
      decision = value === 'allow';
    } else if (specificity === winningSpecificity && value === 'deny') {
      decision = false;
    }
  }

  if (!decision) return false;
  if (level === 'view') return true;

  const readOnly = applicable.some(
    (grant) => grant.access_role === 'read_only' && SCOPE_SPECIFICITY[grant.scope_type] <= winningSpecificity,
  );
  return !readOnly;
};

test('deny by default: a user with no grant sees nothing', () => {
  assert.equal(resolve('u-ungranted', 'unit-1', 'construction', 'view'), false);
  assert.equal(resolve('u-ungranted', 'unit-3', 'construction', 'edit'), false);
});

test('deny by default: a granted user has no access to an unconfigured key', () => {
  // The direct correction of Solicitor finding NOCOPY-01. There is no
  // DEFAULT_ALLOW_KEYS equivalent.
  assert.equal(resolve('u-project-mgr', 'unit-1', 'pricing', 'view'), false);
  assert.equal(resolve('u-project-mgr', 'unit-1', 'progress_claims', 'view'), false);
});

test('a project grant inherits downward to every stage and unit of that project', () => {
  assert.equal(resolve('u-project-mgr', 'unit-1', 'construction', 'view'), true);
  assert.equal(resolve('u-project-mgr', 'unit-2', 'construction', 'view'), true);
  assert.equal(resolve('u-project-mgr', 'unit-3', 'construction', 'view'), true);
});

test('a stage grant does not reach a sibling stage', () => {
  assert.equal(resolve('u-site-super', 'unit-1', 'construction', 'edit'), true, 'unit-1 is in the granted stage');
  assert.equal(resolve('u-site-super', 'unit-3', 'construction', 'edit'), false, 'unit-3 is in the sibling stage');
});

test('no grant reaches a project the user is not party to', () => {
  assert.equal(resolve('u-project-mgr', 'unit-solo', 'construction', 'view'), false);
  assert.equal(resolve('u-site-super', 'unit-solo', 'construction', 'view'), false);
});

test('a more specific deny overrides a broader allow', () => {
  assert.equal(resolve('u-project-mgr', 'unit-2', 'construction', 'edit'), true, 'project allow applies');
  assert.equal(resolve('u-project-mgr', 'unit-3', 'construction', 'edit'), false, 'unit-level deny wins');
  assert.equal(resolve('u-project-mgr', 'unit-3', 'construction', 'view'), true, 'the deny was edit-only');
});

test('read_only clamps edit and delete after resolution', () => {
  assert.equal(resolve('u-readonly', 'unit-1', 'construction', 'view'), true);
  assert.equal(resolve('u-readonly', 'unit-1', 'construction', 'edit'), false);
  assert.equal(resolve('u-readonly', 'unit-1', 'construction', 'delete'), false);
});

test('an expired grant is inert', () => {
  assert.equal(resolve('u-sales', 'unit-1', 'inventory', 'view'), false);
});

test('a revoked grant is inert', () => {
  assert.equal(resolve('u-sales', 'unit-solo', 'inventory', 'view'), false);
});

test('organisation containment failure makes a grant inert, not merely narrowed', () => {
  // u-foreign belongs to org-dev, which is not a party to proj-solo.
  assert.equal(resolve('u-foreign', 'unit-solo', 'construction', 'view'), false);
});

test('forbidden keys can never be granted, whatever a matrix says', () => {
  for (const key of fixture.forbiddenKeys) {
    assert.equal(resolve('u-org-admin', 'unit-1', key, 'view'), false, `${key} was resolvable`);
    assert.equal(resolve('u-project-mgr', 'unit-1', key, 'view'), false, `${key} was resolvable`);
  }
});

test('the forbidden key list covers every restricted domain named in the boundary document', () => {
  for (const key of [
    'income', 'expenses', 'assets', 'liabilities', 'employment', 'borrowing_capacity',
    'serviceability', 'commissions', 'aml_restricted', 'smr', 'mlro',
    'legal_privileged', 'conflict_checks', 'finance_private', 'command_private', 'solicitor_private',
  ]) {
    assert.ok(fixture.forbiddenKeys.includes(key), `BUILDER_FORBIDDEN_KEYS is missing ${key}`);
  }
});

// --- Lifecycle -------------------------------------------------------------

const { statuses, transitions, invalidTransitionSamples, preCaseStatuses } = fixture.lifecycle;
const canTransition = (from, to) => (transitions[from] || []).includes(to);

test('every lifecycle status has a declared transition list', () => {
  for (const status of statuses) {
    assert.ok(Object.prototype.hasOwnProperty.call(transitions, status), `${status} has no transition list`);
  }
  for (const [from, targets] of Object.entries(transitions)) {
    assert.ok(statuses.includes(from), `${from} is not a declared status`);
    for (const target of targets) {
      assert.ok(statuses.includes(target), `${from} -> ${target} targets an undeclared status`);
    }
  }
});

test('the happy path is fully connected from available to settled', () => {
  const path = [
    'available', 'reserved', 'deposit_pending', 'contract_issued', 'contract_signed',
    'unconditional', 'under_construction', 'practical_completion', 'handover_ready',
    'settlement_ready', 'settled',
  ];
  for (let index = 0; index < path.length - 1; index += 1) {
    assert.ok(canTransition(path[index], path[index + 1]), `${path[index]} -> ${path[index + 1]} is not permitted`);
  }
});

test('terminal statuses have no outbound transition', () => {
  for (const terminal of ['settled', 'withdrawn', 'terminated']) {
    assert.deepEqual(transitions[terminal], [], `${terminal} is not terminal`);
  }
});

test('invalid transitions are rejected (409 territory, not 400)', () => {
  for (const { from, to } of invalidTransitionSamples) {
    assert.equal(canTransition(from, to), false, `${from} -> ${to} should be invalid`);
  }
});

test('the only backward transitions are the three declared failure paths', () => {
  const order = Object.fromEntries([
    'available', 'temporarily_held', 'reserved', 'deposit_pending', 'contract_issued',
    'contract_signed', 'unconditional', 'under_construction', 'practical_completion',
    'handover_ready', 'settlement_ready', 'settled',
  ].map((status, index) => [status, index]));
  const backward = [];
  for (const [from, targets] of Object.entries(transitions)) {
    for (const to of targets) {
      if (order[from] !== undefined && order[to] !== undefined && order[to] < order[from]) {
        backward.push(`${from}->${to}`);
      }
    }
  }
  assert.deepEqual(backward.sort(), [
    'deposit_pending->reserved',
    'reserved->available',
    'temporarily_held->available',
  ]);
});

test('pre-case statuses carry no client and therefore no transaction case', () => {
  // ADR 019: transaction_cases.client_id is NOT NULL, so unsold inventory cannot
  // and must not have a case.
  assert.deepEqual(preCaseStatuses, ['available', 'temporarily_held']);
  for (const status of preCaseStatuses) {
    assert.ok(canTransition(status, 'reserved'), `${status} must be able to reach reserved, where a case is created`);
  }
});

test('the construction milestone vocabulary is the ten declared keys', () => {
  assert.deepEqual(fixture.constructionMilestones, [
    'site_start', 'base_slab', 'frame', 'lock_up', 'fixing',
    'practical_completion', 'inspection', 'defect_rectification', 'handover', 'warranty',
  ]);
});

// --- Outbound contracts ----------------------------------------------------

test('no outbound contract exposes a Builder-private field', () => {
  for (const [audience, fields] of Object.entries(fixture.outboundContracts)) {
    for (const field of fields) {
      assert.ok(
        !fixture.builderPrivateFields.includes(field),
        `the ${audience} contract exposes Builder-private field ${field}`,
      );
    }
  }
});

test('no outbound contract exposes unreleased inventory or pricing', () => {
  for (const [audience, fields] of Object.entries(fixture.outboundContracts)) {
    for (const field of fields) {
      assert.ok(!/unreleased|cost_data|margin|feasibility|supplier|contractor/.test(field),
        `the ${audience} contract exposes ${field}`);
    }
  }
});

test('the Finance contract carries no construction cost or margin data', () => {
  for (const field of fixture.outboundContracts.finance) {
    assert.ok(!/cost|margin|supplier|contractor/.test(field), `finance contract exposes ${field}`);
  }
});

test('the Solicitor contract carries only legally relevant fields', () => {
  assert.ok(fixture.outboundContracts.solicitor.includes('builder_legal_entity'));
  assert.ok(fixture.outboundContracts.solicitor.includes('sunset_date'));
  for (const field of fixture.outboundContracts.solicitor) {
    assert.ok(!/progress_claim|inspection_state|defect_state/.test(field),
      `solicitor contract exposes builder operational field ${field}`);
  }
});

test('the Client contract carries only approved and sanitised fields', () => {
  for (const field of fixture.outboundContracts.client) {
    assert.ok(!/unit_sale_price|progress_claim|settlement_readiness/.test(field),
      `client contract exposes commercially sensitive field ${field}`);
  }
});

// ===========================================================================
// B. Repository boundary assertions at this baseline
// ===========================================================================

const functionsDir = join(root, 'supabase/functions');
const builderFunctionDirs = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('builder-portal-'))
  .map((entry) => entry.name);

/**
 * Strip comments before asserting a table is never touched. Builder functions
 * document the Finance-owned boundary in prose, so an un-stripped search matches
 * the documentation and reports a violation that does not exist.
 */
const stripJsComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const builderFunctionSources = builderFunctionDirs.flatMap((dir) =>
  readdirSync(join(functionsDir, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ts$/.test(entry.name))
    .map((entry) => ({ dir, code: stripJsComments(readFileSync(join(functionsDir, dir, entry.name), 'utf8')) })));

test('SEC-06: no builder-portal function reads the commission-bearing deal tables', () => {
  // Became a live gate in Phase 1, when builder-portal-admin was created.
  assert.ok(builderFunctionSources.length > 0,
    'no builder-portal function sources found — this gate must not be vacuous once the family exists');
  for (const { dir, code } of builderFunctionSources) {
    for (const table of ['builder_invoices', 'build_progress_payments']) {
      assert.ok(!code.includes(table), `${dir} references the Finance-owned table ${table} in code`);
      assert.ok(!new RegExp(`from\\(['"\`]${table}`).test(code), `${dir} queries ${table}`);
    }
  }
});

test('SEC-06: the Finance-owned boundary stays documented in the code that must honour it', () => {
  const adminFn = readFileSync(join(functionsDir, 'builder-portal-admin/index.ts'), 'utf8');
  assert.match(adminFn, /builder_invoices` and `build_progress_payments` are Finance-owned/);
});

test('SEC-05: no builder-portal function touches a restricted finance, AML or legal table', () => {
  for (const dir of builderFunctionDirs) {
    const files = readdirSync(join(functionsDir, dir), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(functionsDir, dir, entry.name));
    for (const file of files) {
      const source = stripJsComments(readFileSync(file, 'utf8'));
      for (const table of [
        'client_income', 'client_expenses', 'client_assets', 'client_liabilities',
        'client_employment', 'borrowing_capacity_assessments', 'commission_ledger',
        'commission_payouts', 'legal_conflict_checks', 'legal_matter_audit_events',
      ]) {
        assert.ok(!source.includes(table), `${dir} reads restricted table ${table}`);
      }
    }
  }
});

test('the field-ownership module grants Builder nothing at this baseline', () => {
  const source = readFileSync(join(root, 'supabase/functions/_shared/crossPortalFieldOwnership.ts'), 'utf8');
  assert.ok(!source.includes('builder'), 'the ownership module already names builder');
  // The private-field rules Builder must never be added to.
  for (const field of ['internal_notes', 'npc_internal_notes', 'finance_private_notes']) {
    const rule = source.split('\n').find((line) => line.includes(`field:'${field}'`));
    assert.ok(rule, `the ${field} ownership rule is missing`);
    assert.match(rule, /conflict_policy:'reject'/, `${field} is no longer reject-policy`);
  }
});

test('the documented Builder-private field list matches the field-ownership document', () => {
  const doc = readFileSync(join(root, 'docs/architecture/builder-cross-portal-field-ownership.md'), 'utf8');
  for (const field of fixture.builderPrivateFields) {
    assert.ok(doc.includes(field), `Builder-private field ${field} is missing from the ownership document`);
  }
});
