/**
 * Builder / Developer Portal — administration navigation shape.
 *
 * The page grew to ten top-level tabs, which made it read as a pile of modules
 * rather than an administration surface. It is now five, matching the focus of
 * the Solicitor Portal:
 *
 *   Portal users | Organisations | Memberships | Projects | Transactions
 *
 * Inventory, construction, delivery, collaboration and workspace are stages of
 * the same project lifecycle, so they moved into a nested bar inside Projects.
 * Nothing was removed: every panel, prop and permission check is unchanged, and
 * these assertions exist to keep it that way.
 *
 * Static assertions over the shipped source, so they run with no database and
 * no network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const adminPage = read('src/pages/admin/BuilderPortalAdmin.tsx');
const stripJsComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const code = stripJsComments(adminPage);

/** The primary bar is the first TabsList; the nested one is labelled. */
const primaryList = (() => {
  const start = code.indexOf('<TabsList className="w-full justify-start');
  assert.ok(start !== -1, 'the primary TabsList was not found');
  return code.slice(start, code.indexOf('</TabsList>', start));
})();

const nestedList = (() => {
  const start = code.indexOf('aria-label="Project operations sections"');
  assert.ok(start !== -1, 'the nested project-operations TabsList was not found');
  return code.slice(start, code.indexOf('</TabsList>', start));
})();

const primaryTabValues = [...primaryList.matchAll(/<TabsTrigger value="([a-z]+)"/g)].map((m) => m[1]);

/** The `PROJECT_OPERATION_SECTIONS` literal the nested bar maps over. */
const projectSections = (() => {
  const start = code.indexOf('const PROJECT_OPERATION_SECTIONS = [');
  assert.ok(start !== -1, 'PROJECT_OPERATION_SECTIONS is missing');
  const block = code.slice(start, code.indexOf('] as const;', start));
  return [...block.matchAll(/\{ value: '([a-z]+)', label: '([A-Za-z ]+)', icon: (\w+) \}/g)]
    .map((m) => ({ value: m[1], label: m[2], icon: m[3] }));
})();

const MOVED_MODULES = ['inventory', 'construction', 'delivery', 'collaboration', 'workspace'];

// ---------------------------------------------------------------------------
// 1–3. The primary bar
// ---------------------------------------------------------------------------

test('1. exactly five primary tabs are rendered', () => {
  assert.equal(primaryTabValues.length, 5,
    `expected 5 primary tabs, found ${primaryTabValues.length}: ${primaryTabValues.join(', ')}`);
});

test('2. the primary tabs are in the required order', () => {
  assert.deepEqual(primaryTabValues,
    ['users', 'organisations', 'memberships', 'projects', 'transactions']);
  // The labels read as the brief specifies, in the same order.
  const labels = [...primaryList.matchAll(/aria-hidden \/>\s*\n\s*([A-Z][A-Za-z ]+)\n/g)].map((m) => m[1].trim());
  assert.deepEqual(labels,
    ['Portal users', 'Organisations', 'Memberships', 'Projects', 'Transactions']);
});

test('3. Portal users is the default active tab', () => {
  assert.match(code, /const \[primaryTab, setPrimaryTab\] = useState\('users'\)/);
  assert.match(code, /<Tabs value=\{primaryTab\} onValueChange=\{setPrimaryTab\}>/);
  // No stale uncontrolled default is left behind.
  assert.doesNotMatch(code, /<Tabs defaultValue=/);
});

// ---------------------------------------------------------------------------
// 4–8. The five moved modules are no longer top-level
// ---------------------------------------------------------------------------

for (const [index, moduleName] of MOVED_MODULES.entries()) {
  test(`${4 + index}. ${moduleName} is not a top-level tab`, () => {
    assert.ok(!primaryTabValues.includes(moduleName),
      `${moduleName} is still in the primary tab bar`);
  });
}

// ---------------------------------------------------------------------------
// 9–11. Nothing was lost
// ---------------------------------------------------------------------------

test('9. all five moved modules are available inside the Projects section', () => {
  const nested = projectSections.map((s) => s.value);
  assert.deepEqual(nested,
    ['projects', 'inventory', 'construction', 'delivery', 'collaboration', 'workspace']);
  for (const moduleName of MOVED_MODULES) {
    assert.ok(nested.includes(moduleName), `${moduleName} is not reachable under Projects`);
  }
  // The nested bar renders that list rather than a hand-written copy of it.
  assert.match(nestedList, /PROJECT_OPERATION_SECTIONS\.map\(\(section\) => \(/);
  assert.match(nestedList, /<TabsTrigger\s+key=\{section\.value\}\s+value=\{section\.value\}/);
  // And it lives inside the Projects tab, not the primary bar.
  const projectsTab = code.slice(
    code.indexOf('<TabsContent value="projects" className="mt-4">'),
    code.indexOf('<TabsContent value="transactions"'));
  assert.ok(projectsTab.includes('aria-label="Project operations sections"'));
  assert.ok(projectsTab.includes('Project operations'));
  assert.ok(projectsTab.includes(
    'Manage projects and the connected inventory, construction, delivery and'));
});

test('10. every domain panel still renders, with its props unchanged', () => {
  for (const panel of [
    'AdminBuilderProjectsPanel', 'AdminBuilderInventoryPanel', 'AdminBuilderTransactionsPanel',
    'AdminBuilderConstructionPanel', 'AdminBuilderDeliveryPanel',
    'AdminBuilderCollaborationPanel', 'AdminBuilderWorkspacePanel',
  ]) {
    assert.match(code, new RegExp(`import \\{ ${panel} \\}`), `${panel} is no longer imported`);
    assert.match(code, new RegExp(`<${panel} canEdit=\\{canEdit\\} />`),
      `${panel} is not rendered with canEdit`);
    // Exactly once — a module must not be reachable from two places.
    assert.equal((code.match(new RegExp(`<${panel} `, 'g')) ?? []).length, 1,
      `${panel} is rendered more than once`);
  }
});

test('11. Transactions remains a top-level tab', () => {
  assert.ok(primaryTabValues.includes('transactions'));
  assert.ok(!projectSections.map((s) => s.value).includes('transactions'),
    'Transactions must not move into the project-operations bar');
  const transactionsTab = code.slice(code.indexOf('<TabsContent value="transactions" className="mt-4">'));
  assert.match(transactionsTab, /<AdminBuilderTransactionsPanel canEdit=\{canEdit\} \/>/);
});

// ---------------------------------------------------------------------------
// 12–14. Nothing behavioural moved with the navigation
// ---------------------------------------------------------------------------

test('12. the admin operations and invocation targets are unchanged', () => {
  assert.deepEqual(
    [...new Set([...code.matchAll(/invokeSecureFunction\('([a-z-]+)'/g)].map((m) => m[1]))].sort(),
    ['builder-portal-admin', 'builder-portal-invite']);

  const operations = [...new Set([
    ...[...code.matchAll(/(?:^|[^.\w])call\('([a-z_]+)'/g)].map((m) => m[1]),
    ...[...code.matchAll(/mutate\('([a-z_]+)'/g)].map((m) => m[1]),
    ...[...code.matchAll(/runConfirmed\('([a-z_]+)'/g)].map((m) => m[1]),
    // create/update user is chosen by a ternary rather than a literal argument.
    ...[...code.matchAll(/editing \? '([a-z_]+)' : '([a-z_]+)'/g)].flatMap((m) => [m[1], m[2]]),
  ])].sort();
  assert.deepEqual(operations, [
    'create_user', 'delete_membership', 'delete_organisation', 'delete_user',
    'get_membership_permissions', 'get_permission_catalogue',
    'list_memberships', 'list_organisations', 'list_users',
    'revoke_membership', 'revoke_user_sessions',
    'set_organisation_status', 'set_user_status',
    'update_membership_permissions', 'update_user',
    'upsert_membership', 'upsert_organisation',
  ]);

  // The invitation actions are untouched.
  for (const action of ['invite', 'resend', 'revoke_invite']) {
    assert.match(code, new RegExp(`'${action}'`), `the ${action} action is missing`);
  }
  // Permission gating is still applied to every action menu.
  assert.match(code, /useModulePermissions\('builder_portal_admin'\)/);
  assert.ok((code.match(/disabled=\{!canEdit \|\| busy\}/g) ?? []).length >= 3);
});

test('13. the page reaches the backend only through the secure helper', () => {
  assert.match(code, /import \{ invokeSecureFunction \} from '@\/lib\/secureInvoke'/);
  // No direct table access, no client construction, no schema knowledge.
  assert.doesNotMatch(code, /from\('builder_/);
  assert.doesNotMatch(code, /createClient|supabase\.from|\.rpc\(/);
  assert.doesNotMatch(code, /import[^\n]*from '[^']*supabase\/functions/);
});

test('14. no route is defined or changed by this page', () => {
  assert.doesNotMatch(code, /<Route\b|createBrowserRouter|useNavigate\(|<Navigate\b/);
  assert.doesNotMatch(code, /path=["']/);
});

// ---------------------------------------------------------------------------
// 15–17. State survives a refresh, and the bar cannot overflow the page
// ---------------------------------------------------------------------------

test('15. the active primary tab survives a background refresh', () => {
  // Controlled, held on the page, and never written by load() or a mutation.
  assert.match(code, /<Tabs value=\{primaryTab\} onValueChange=\{setPrimaryTab\}>/);
  const loadFn = code.slice(code.indexOf('const load = useCallback('), code.indexOf('useEffect(() => { void load(); }'));
  assert.doesNotMatch(loadFn, /setPrimaryTab|setProjectSection/);
  const mutateFn = code.slice(code.indexOf('const mutate = useCallback('), code.indexOf('const sendInvite = useCallback('));
  assert.doesNotMatch(mutateFn, /setPrimaryTab|setProjectSection/);
  // And the full-page loading state, which would unmount the tabs, is
  // first-load only.
  assert.match(code, /if \(loading && !hasLoadedOnce\.current\) \{/);
});

test('16. the active project-operations section survives a background refresh', () => {
  assert.match(code, /const \[projectSection, setProjectSection\] = useState\('projects'\)/);
  assert.match(code, /<Tabs value=\{projectSection\} onValueChange=\{setProjectSection\}/);
  // Only the nested bar writes it.
  assert.equal((code.match(/setProjectSection/g) ?? []).length, 2);
});

test('17. neither bar can push the page into horizontal overflow', () => {
  // The primitive scrolls its own overflow; triggers keep their intrinsic
  // width so labels never wrap onto a second line.
  const tabsPrimitive = read('src/components/ui/tabs.tsx');
  assert.match(tabsPrimitive, /overflow-x-auto/);
  assert.match(tabsPrimitive, /whitespace-nowrap/);
  for (const list of [primaryList, nestedList]) {
    const triggers = [...list.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(triggers.some((c) => c.includes('shrink-0')),
      'tab triggers must keep their intrinsic width');
  }
  // Both bars are width-bounded rather than laid out wider than their column.
  assert.match(primaryList, /w-full/);
  assert.match(nestedList, /w-full/);
  // A `sr-only` span is absolutely positioned, so its trigger must be a
  // containing block or it anchors past the viewport.
  const srOnlyTriggers = [...primaryList.matchAll(/<TabsTrigger value="[a-z]+" className="([^"]*)"[\s\S]*?<\/TabsTrigger>/g)]
    .filter((m) => m[0].includes('sr-only'));
  assert.equal(srOnlyTriggers.length, 3);
  for (const trigger of srOnlyTriggers) {
    assert.ok(trigger[1].includes('relative'), 'a trigger carrying sr-only text must be relative');
  }
});
