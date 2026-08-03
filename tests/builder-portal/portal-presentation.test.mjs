/**
 * Builder / Developer Portal — presentation contract.
 *
 * One change moved the Builder Portal's vocabulary and its chrome:
 *
 *   • the record the database calls a `membership` is now read as
 *     "organisation access" everywhere a person sees it;
 *   • the terms page became a consent surface with two acknowledgements;
 *   • onboarding joined it in the same shell;
 *   • the twelve-item horizontal navigation bar became a grouped sidebar with
 *     a mobile drawer;
 *   • the dashboard became a grouped command centre.
 *
 * None of that was allowed to move anything underneath it. These assertions
 * exist to hold both halves at once: that the words changed, and that the
 * operations, payload fields, query hooks, routes, guards and server files did
 * not.
 *
 * Static assertions over the shipped source, so they run with no database and
 * no network.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');
const stripJsComments = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const adminPage = read('src/pages/admin/BuilderPortalAdmin.tsx');
const adminCode = stripJsComments(adminPage);
const accessTerms = read('src/lib/builderAccessTerms.ts');
const termsPage = read('src/pages/builder/BuilderTerms.tsx');
const termsCode = stripJsComments(termsPage);
const onboardingPage = read('src/pages/builder/BuilderOnboarding.tsx');
const onboardingCode = stripJsComments(onboardingPage);
const layout = read('src/components/builder-portal/BuilderPortalLayout.tsx');
const layoutCode = stripJsComments(layout);
const dashboard = read('src/pages/builder/BuilderDashboard.tsx');
const dashboardCode = stripJsComments(dashboard);
const governanceShell = read('src/components/builder-portal/ui/BuilderGovernanceShell.tsx');
const governanceProgress = read('src/components/builder-portal/ui/BuilderGovernanceProgress.tsx');
const app = read('src/App.tsx');

const NEW_UI = [
  'src/components/builder-portal/ui/BuilderGovernanceProgress.tsx',
  'src/components/builder-portal/ui/BuilderGovernanceShell.tsx',
  'src/components/builder-portal/ui/BuilderPortalEmptyState.tsx',
  'src/components/builder-portal/ui/BuilderPortalMetricCard.tsx',
  'src/components/builder-portal/ui/BuilderPortalNavGroup.tsx',
  'src/components/builder-portal/ui/BuilderPortalSection.tsx',
];

/** The twelve destinations, exactly as the route tree defines them. */
const ROUTES = [
  '/builder', '/builder/projects', '/builder/inventory', '/builder/transactions',
  '/builder/pipeline', '/builder/construction', '/builder/documents', '/builder/messages',
  '/builder/tasks', '/builder/notifications', '/builder/activity', '/builder/settings',
];

/** Committed files, so "untouched" is measured against the merge base, not the disk. */
const changedFiles = (() => {
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root })
    .toString().trim();
  return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root })
    .toString().split('\n').filter(Boolean);
})();

// ---------------------------------------------------------------------------
// 1–8. Terminology
// ---------------------------------------------------------------------------

test('1. the admin surface reads Organisation Access, not Memberships', () => {
  // The tab, the card heading and the summary metric.
  assert.match(adminCode, /<TabsTrigger value="memberships"[\s\S]{0,240}Organisation Access/);
  assert.match(adminCode, /<CardTitle className="text-base">Organisation Access Assignments<\/CardTitle>/);
  assert.match(adminCode, /label="Active organisation access"/);
  assert.match(adminCode,
    /Assign portal users to builder or developer organisations, define their access\s*\n?\s*role and control which organisation is primary\./);
  assert.match(adminCode,
    /Organisation access determines\s*\n?\s*which company workspace a portal user can enter\./);
});

test('2. no user-facing label in the Builder surfaces still says membership', () => {
  // Labels are JSX text and quoted copy; identifiers are excluded by shape.
  const surfaces = [
    ['admin page', adminCode], ['terms', termsCode], ['onboarding', onboardingCode],
    ['layout', layoutCode], ['dashboard', dashboardCode],
    ...NEW_UI.map((file) => [file, stripJsComments(read(file))]),
  ];
  // Only what a reader actually sees is examined: JSX text, and quoted copy
  // (a string literal holding a space — an identifier never does). Identifiers
  // are excluded by construction rather than by scrubbing, so `membership_role`
  // and `liveMemberships` stay exactly as they are without weakening this.
  const readableCopy = (code) => [
    // JSX text on its own line(s), the shape prose takes in this codebase.
    ...[...code.matchAll(/>\s*\n\s+([A-Za-z][^<>{}]*?)\n\s*[<{]/g)].map((m) => m[1]),
    // JSX text inline between two tags on one line.
    ...[...code.matchAll(/>([A-Za-z][^<>{}\n]{2,})</g)].map((m) => m[1]),
    // A string literal holding a space is copy; one without is an identifier.
    // The space must not be a newline, or the pattern spans two literals.
    ...[...code.matchAll(/'([^'\n]*[^\S\n][^'\n]*)'/g)].map((m) => m[1]),
    ...[...code.matchAll(/"([^"\n]*[^\S\n][^"\n]*)"/g)].map((m) => m[1]),
  ].join('\n');

  for (const [name, code] of surfaces) {
    const copy = readableCopy(code);
    const hit = copy.match(/\b[Mm]emberships?\b/);
    assert.equal(hit, null,
      `${name} still shows "membership" to a reader: ${hit && copy.slice(Math.max(0, hit.index - 70), hit.index + 70)}`);
  }

  // The translation table is the one place the word survives on purpose: its
  // keys are the server's exact sentences, which have to match byte for byte
  // to be recognised. Only the values are ever shown, and none of them says
  // "membership".
  const table = accessTerms.slice(accessTerms.indexOf('const KNOWN_ACCESS_MESSAGES'),
    accessTerms.indexOf('export function accessErrorMessage'));
  const shown = [...table.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]);
  assert.equal(shown.length, 2, 'the translation table no longer has two entries');
  for (const message of shown) {
    assert.doesNotMatch(message, /\b[Mm]emberships?\b/, `"${message}" still says membership`);
    assert.match(message, /organisation access/);
  }
  // And the keys are still the server's wording, unedited.
  assert.match(table, /'Grant this user an organisation membership before inviting them\.':/);
  assert.match(table,
    /'You do not have an active organisation membership\. Please contact your administrator\.':/);
});

test('3. the grant action reads Grant organisation access', () => {
  assert.ok(adminCode.includes('Grant organisation access'));
  assert.match(adminCode, /Grant organisation access before inviting/);
  assert.match(adminCode, /Step 2 of 5 — grant access to an organisation/);
  assert.match(adminCode, /\{ label: 'grant organisation access', icon: KeyRound \}/);
});

test('4. the revoke action reads Revoke organisation access', () => {
  assert.ok(adminCode.includes('Revoke organisation access'));
  assert.match(adminCode, /confirmLabel: 'Revoke organisation access'/);
  assert.match(adminCode, /title: 'Revoke this organisation access\?'/);
});

test('5. restore reads Restore organisation access, removal reads access assignment', () => {
  assert.ok(adminCode.includes('Restore organisation access'));
  assert.ok(adminCode.includes('Remove access assignment'));
  assert.match(adminCode, /confirmLabel: 'Remove access assignment'/);
  assert.match(adminCode, /title: 'Permanently remove this access assignment\?'/);
});

test('6. every backend operation string is unchanged', () => {
  const operations = [...new Set([
    ...[...adminCode.matchAll(/(?:^|[^.\w])call\('([a-z_]+)'/g)].map((m) => m[1]),
    ...[...adminCode.matchAll(/mutate\('([a-z_]+)'/g)].map((m) => m[1]),
    ...[...adminCode.matchAll(/runConfirmed\('([a-z_]+)'/g)].map((m) => m[1]),
    ...[...adminCode.matchAll(/editing \? '([a-z_]+)' : '([a-z_]+)'/g)].flatMap((m) => [m[1], m[2]]),
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
  // Five of them still carry the word the database uses.
  for (const operation of [
    'upsert_membership', 'revoke_membership', 'delete_membership',
    'get_membership_permissions', 'update_membership_permissions',
  ]) {
    assert.ok(operations.includes(operation), `${operation} was renamed`);
  }
  assert.deepEqual(
    [...new Set([...adminCode.matchAll(/invokeSecureFunction\('([a-z-]+)'/g)].map((m) => m[1]))].sort(),
    ['builder-portal-admin', 'builder-portal-invite']);
});

test('7. every request and response field containing membership is unchanged', () => {
  for (const field of ['membership_id', 'membership_role', 'builder_user_id', 'organisation_id',
    'is_primary', 'expected_version']) {
    assert.ok(adminCode.includes(field), `the ${field} payload field is missing`);
  }
  // The response shape the page reads is untouched.
  assert.match(adminCode, /membershipResult\?\.memberships \?\? \[\]/);
  assert.match(adminCode, /interface BuilderMembership \{/);
  assert.match(adminCode, /membership_role: string;/);
  // The role catalogue maps stored values to labels and invents no value.
  assert.deepEqual(
    [...accessTerms.matchAll(/\{ value: '([a-z_]+)', label: ACCESS_ROLE_LABELS\.[a-z_]+ \}/g)]
      .map((m) => m[1]),
    ['owner', 'administrator', 'manager', 'member', 'read_only']);
  assert.match(accessTerms, /member: 'Standard User'/);
  assert.match(accessTerms, /administrator: 'Organisation Administrator'/);
  // And it is a pure mapping: no request, no decision, no permission.
  assert.doesNotMatch(accessTerms, /invoke|fetch|supabase|useQuery|permission\w*\(/i);
});

test('8. no database, Edge Function or generated type file was touched', () => {
  for (const file of changedFiles) {
    assert.ok(!file.startsWith('supabase/'), `${file} is a Supabase file`);
    assert.ok(!file.includes('integrations/supabase/types'), `${file} is a generated type file`);
    assert.ok(!file.startsWith('src/pages/solicitor/'), `${file} is Solicitor Portal code`);
    assert.ok(!file.startsWith('src/components/solicitor-portal/'), `${file} is Solicitor Portal code`);
  }
});

// ---------------------------------------------------------------------------
// 9–17. Terms and project-data consent
// ---------------------------------------------------------------------------

test('9. the terms page is titled Terms & Project Data Consent', () => {
  assert.match(termsCode, /title="Terms & Project Data Consent"/);
  assert.match(termsCode, /Builder \/ Developer Portal/);
  // The title renders as text, not as an unresolved HTML entity.
  assert.doesNotMatch(termsCode, /&amp;/);
});

test('10. the title, version and body still come from governance data', () => {
  assert.match(termsCode, /import \{ builderLoadGovernance, type BuilderTermsVersion \} from '@\/lib\/builderPortal'/);
  assert.match(termsCode, /void builderLoadGovernance\(\)\.then\(\(\{ data, error: loadError \}\) => \{/);
  assert.match(termsCode, /setTerms\(data\?\.terms \?\? null\)/);
  assert.match(termsCode, /\{terms\?\.title \|\| 'Builder \/ Developer Portal terms'\}/);
  assert.match(termsCode, /Version \{versionLabel\}/);
  assert.match(termsCode, /const versionLabel = terms\?\.version \|\| 'current'/);
  assert.match(termsCode, /terms\?\.content_markdown/);
  // Nothing decides which version is served.
  assert.doesNotMatch(termsCode, /version\s*[=:]\s*['"][\d.]/);
});

test('11. both consent acknowledgements exist and are labelled', () => {
  assert.equal((termsCode.match(/<Checkbox\b/g) ?? []).length, 2);
  assert.match(termsCode, /id="builder-agree-terms"/);
  assert.match(termsCode, /id="builder-agree-project-data"/);
  assert.match(termsCode, /htmlFor="builder-agree-terms"/);
  assert.match(termsCode, /htmlFor="builder-agree-project-data"/);
  assert.match(termsCode, /I have read and agree to the \{terms\?\.title/);
  assert.match(termsCode,
    /project, inventory, transaction, construction, document and\s*\n?\s*communication data may be commercially sensitive or confidential/);
  assert.match(termsCode, /limited to authorised organisation and project records/);
  assert.match(termsCode, /may be logged and audited/);
});

test('12. the accept button is disabled until both are checked', () => {
  assert.match(termsCode,
    /const canProceed = Boolean\(terms\) && agreedTerms && agreedData && !submitting/);
  assert.match(termsCode, /disabled=\{!canProceed\}/);
  // The handler refuses too, so the gate is not only visual.
  assert.match(termsCode, /if \(!canProceed\) return;/);
  assert.match(termsCode, /'Accept & Continue'/);
});

test('13. acceptTerms is the single acceptance call, invoked once', () => {
  assert.equal((termsCode.match(/acceptTerms\(\)/g) ?? []).length, 1);
  assert.match(termsCode, /const result = await acceptTerms\(\);/);
  // No second write of any kind sits beside it.
  assert.doesNotMatch(termsCode, /invokeSecureFunction|supabase\.|\.rpc\(|useMutation/);
});

test('14. no hard-coded terms stand in for the server text', () => {
  const fallback = 'No current terms are published for this portal.';
  assert.ok(termsCode.includes(fallback), 'the missing-terms state is gone');
  // The only long literals are the fallback and the two acknowledgements —
  // nothing resembling a substitute agreement.
  assert.doesNotMatch(termsCode, /(?:WHEREAS|hereby agrees?|Clause \d|Section \d\.\d)/i);
});

test('15. the load error is shown, and a failed acceptance does not navigate', () => {
  assert.match(termsCode, /if \(loadError\) setError\(loadError\.message\)/);
  assert.match(termsCode, /<Alert variant="destructive" role="alert">/);
  const handler = termsCode.slice(termsCode.indexOf('const handleAccept'),
    termsCode.indexOf('\n  };', termsCode.indexOf('const handleAccept')));
  assert.match(handler, /if \(result\.error\) \{\s*\n\s*setError\(result\.error\);\s*\n\s*return;/);
  assert.ok(handler.indexOf('return;') < handler.indexOf("navigate('/builder'"),
    'the page navigates before checking whether acceptance succeeded');
});

test('16. the loading state is announced, not just drawn', () => {
  assert.match(termsCode, /aria-live="polite"/);
  assert.match(termsCode, /aria-busy=\{loading\}/);
  assert.match(termsCode, /<span className="sr-only">Loading the current terms…<\/span>/);
  assert.match(termsCode, /<Skeleton/);
});

test('17. acceptance does not bypass onboarding', () => {
  // It returns to `/builder`, which the guard sends on to onboarding when
  // onboarding is outstanding. Nothing here jumps past that.
  assert.match(termsCode, /navigate\('\/builder', \{ replace: true \}\)/);
  assert.doesNotMatch(termsCode, /navigate\('\/builder\/(?!$)[a-z-]+'/);
  assert.equal((termsCode.match(/navigate\(/g) ?? []).length, 1);
  // The route tree still gates both pages behind the protected route.
  const tree = app.slice(app.indexOf('<Route path="/builder/*"'));
  const guarded = tree.slice(tree.indexOf('<BuilderPortalProtectedRoute />'));
  assert.ok(guarded.includes('<Route path="terms" element={<BuilderTerms />} />'));
  assert.ok(guarded.includes('<Route path="onboarding" element={<BuilderOnboarding />} />'));
});

// ---------------------------------------------------------------------------
// 18–21. Onboarding
// ---------------------------------------------------------------------------

test('18. onboarding still renders the steps the server returned', () => {
  assert.match(onboardingCode, /void builderLoadGovernance\(\)\.then/);
  assert.match(onboardingCode, /setSteps\(data\?\.steps \?\? \[\]\)/);
  assert.match(onboardingCode, /\{steps\.map\(\(step, index\) => \{/);
  assert.match(onboardingCode, /STEP_LABELS\[step\.step_key\] \|\| step\.step_key\.replace\(\/_\/g, ' '\)/);
  // The four server step keys are unchanged.
  assert.deepEqual(
    [...onboardingCode.matchAll(/^ {2}([a-z_]+): '/gm)].map((m) => m[1]),
    ['profile_confirmed', 'organisation_confirmed', 'contact_confirmed', 'security_reviewed']);
});

test('19. the mandatory-step rule is byte-for-byte the rule it was', () => {
  assert.match(onboardingCode,
    /const outstanding = steps\.filter\(\(step\) => step\.mandatory && !step\.completed_at\);/);
  assert.match(onboardingCode,
    /const ready = steps\.length > 0 && outstanding\.every\(\(step\) => checked\[step\.step_key\]\);/);
  assert.match(onboardingCode, /disabled=\{!ready \|\| submitting\}/);
  // A step the server marked complete cannot be unticked, and nothing ticks
  // a step on the user's behalf.
  assert.match(onboardingCode, /const done = Boolean\(step\.completed_at\);/);
  assert.match(onboardingCode, /disabled=\{done\}/);
  assert.doesNotMatch(onboardingCode, /useEffect\([^)]*setChecked/);
});

test('20. completeOnboarding is unchanged and gates the navigation', () => {
  assert.equal((onboardingCode.match(/completeOnboarding\(\)/g) ?? []).length, 1);
  assert.match(onboardingCode, /const result = await completeOnboarding\(\);/);
  const handler = onboardingCode.slice(
    onboardingCode.indexOf('const handleComplete'),
    onboardingCode.indexOf('\n  };', onboardingCode.indexOf('const handleComplete')));
  assert.ok(handler.indexOf('if (result.error)') < handler.indexOf("navigate('/builder'"));
  assert.doesNotMatch(onboardingCode, /invokeSecureFunction|supabase\.|\.rpc\(/);
});

test('21. the journey indicator is display-only', () => {
  for (const [name, code] of [['terms', termsCode], ['onboarding', onboardingCode]]) {
    assert.match(code, /step="(Terms|Workspace setup)"/, `${name} does not mark its stage`);
  }
  assert.match(termsCode, /step="Terms"/);
  assert.match(onboardingCode, /step="Workspace setup"/);
  assert.match(governanceProgress,
    /const BUILDER_GOVERNANCE_STEPS = \['Terms', 'Workspace setup', 'Portal ready'\] as const;/);
  // It holds nothing, requests nothing and routes nowhere.
  const progressCode = stripJsComments(governanceProgress);
  assert.doesNotMatch(progressCode, /useState|useEffect|navigate|<Link|invoke|fetch|supabase/);
  const shellCode = stripJsComments(governanceShell);
  assert.doesNotMatch(shellCode, /useState|useEffect|navigate|invoke|fetch|supabase/);
  // Progress is reported, never used as the gate — `ready` is the gate.
  assert.match(onboardingCode, /const acknowledged = outstanding\.filter/);
  assert.doesNotMatch(onboardingCode, /disabled=\{[^}]*acknowledged/);
});

// ---------------------------------------------------------------------------
// 22–30. The portal shell
// ---------------------------------------------------------------------------

test('22. every Builder route is still in the navigation', () => {
  const navBlock = layoutCode.slice(layoutCode.indexOf('const NAV: BuilderNavItem[]'),
    layoutCode.indexOf('function tourAnchor'));
  const paths = [...navBlock.matchAll(/\{ to: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(paths, ROUTES);
  // Every one is placed in a group, and the grouping is derived from NAV so a
  // route can never be listed in one and missing from the other.
  const groupPaths = [...layoutCode.matchAll(/'(\/builder(?:\/[a-z]+)?)'/g)].map((m) => m[1]);
  for (const route of ROUTES) {
    assert.ok(groupPaths.includes(route), `${route} is not in any navigation group`);
  }
  assert.match(layoutCode, /const unplaced = NAV\.filter\(\(item\) => !placed\.has\(item\.to\)\);/);
  assert.match(layoutCode, /if \(unplaced\.length\) groups\[groups\.length - 1\]\.items\.push\(\.\.\.unplaced\);/);
});

test('23. no route path was added, removed or renamed', () => {
  // The layout defines no route and navigates to no path outside the twelve.
  assert.doesNotMatch(layoutCode, /<Route\b|createBrowserRouter|path=["']/);
  const targets = new Set([
    ...[...layoutCode.matchAll(/to="([^"]+)"/g)].map((m) => m[1]),
    ...[...layoutCode.matchAll(/navigate\('([^']+)'\)/g)].map((m) => m[1]),
  ].filter((value) => value.startsWith('/')));
  for (const target of targets) {
    assert.ok(ROUTES.includes(target), `${target} is not an existing Builder route`);
  }
  // The route tree itself is not part of this change.
  assert.ok(!changedFiles.includes('src/App.tsx'), 'the route tree was modified');
});

test('24. the desktop navigation is a grouped sidebar', () => {
  assert.match(layoutCode, /<aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col[^"]*lg:flex">/);
  assert.deepEqual(
    [...layoutCode.matchAll(/title: '([A-Za-z &]+)',\s*\n?\s*paths:/g)].map((m) => m[1]),
    ['Overview', 'Project delivery', 'Workspace', 'Account & control']);
  assert.match(layoutCode, /<BuilderPortalNavGroup key=\{title\} title=\{title\}>/);
  // Labels are never hidden on desktop.
  const navFn = layoutCode.slice(layoutCode.indexOf('function SidebarNav'),
    layoutCode.indexOf('export function BuilderPortalLayout'));
  assert.doesNotMatch(navFn, /sr-only|lg:hidden/);
  assert.match(navFn, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(navFn, /focus-visible:ring-2 focus-visible:ring-ring/);
});

test('25. the mobile drawer carries the same navigation, and closes properly', () => {
  assert.match(layoutCode, /role="dialog"\s*\n\s*aria-modal="true"/);
  assert.match(layoutCode, /aria-label="Builder portal navigation"/);
  // One SidebarNav definition, rendered by both the sidebar and the drawer, so
  // the drawer cannot fall behind the desktop list.
  assert.equal((layoutCode.match(/<SidebarNav /g) ?? []).length, 1);
  assert.equal((layoutCode.match(/\{sidebarBody\(/g) ?? []).length, 2);
  assert.match(layoutCode, /\{sidebarBody\(\(\) => setMobileOpen\(false\)\)\}/);
  // Escape closes it, the overlay closes it, and a route change closes it.
  assert.match(layoutCode, /if \(event\.key === 'Escape'\) setMobileOpen\(false\);/);
  assert.match(layoutCode, /useEffect\(\(\) => \{ setMobileOpen\(false\); \}, \[pathname\]\);/);
  assert.match(layoutCode, /onClick=\{\(\) => setMobileOpen\(false\)\}/);
  assert.match(layoutCode, /aria-label="Close navigation menu"/);
  assert.match(layoutCode, /aria-expanded=\{mobileOpen\}/);
});

test('26. no horizontally scrolling navigation bar is left', () => {
  const navFn = layoutCode.slice(layoutCode.indexOf('function SidebarNav'),
    layoutCode.indexOf('export function BuilderPortalLayout'));
  assert.doesNotMatch(navFn, /overflow-x-auto|max-w-\[calc\(100vw/);
  assert.doesNotMatch(layoutCode, /overflow-x-auto/);
  // The main column and the drawer are both width-bounded.
  assert.match(layoutCode, /<div className="flex min-w-0 flex-1 flex-col">/);
  assert.match(layoutCode, /className="min-w-0 flex-1"/);
  assert.match(layoutCode, /w-\[17rem\] max-w-\[85vw\]/);
});

test('27. the organisation switcher still renders, unmodified', () => {
  assert.match(layoutCode, /import \{ BuilderOrganisationSwitcher \} from '\.\/BuilderOrganisationSwitcher'/);
  assert.match(layoutCode, /<BuilderOrganisationSwitcher \/>/);
  // The layout does not re-implement selection.
  assert.doesNotMatch(layoutCode, /selectOrganisation/);
  // And the switcher's own logic is untouched apart from the role label.
  const switcher = read('src/components/builder-portal/BuilderOrganisationSwitcher.tsx');
  assert.match(switcher, /const \{ error \} = await selectOrganisation\(organisationId\);/);
  assert.match(switcher, /if \(selectable\.length <= 1\) return null;/);
  assert.match(switcher, /accessRoleLabel\(organisation\.membership_role\)/);
});

test('28. sign out still calls the existing handler', () => {
  assert.match(layoutCode, /const \{ user, activeOrganisation, signOut \} = useBuilderPortalAuth\(\);/);
  assert.equal((layoutCode.match(/void signOut\(\)/g) ?? []).length, 2,
    'sign out should be reachable from the sidebar and the account menu');
  assert.doesNotMatch(layoutCode, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(layoutCode, /invokeSecureFunction|supabase\.|\.rpc\(/);
});

test('29. the onboarding tour is still mounted, with its anchors intact', () => {
  assert.match(layoutCode, /import \{ BuilderOnboardingTour \} from '\.\/BuilderOnboardingTour'/);
  assert.match(layoutCode, /<BuilderOnboardingTour \/>/);
  assert.match(layoutCode, /data-tour=\{tourAnchor\(to\)\}/);
  assert.match(layoutCode, /function tourAnchor\(to: string\): string \{/);
  assert.match(layoutCode, /to === '\/builder' \? 'dashboard' : to\.slice\('\/builder\/'\.length\)/);
});

test('30. the skip link and the main-content target are both present', () => {
  assert.match(layoutCode, /href="#main-content"/);
  assert.match(layoutCode, /Skip to main content/);
  assert.match(layoutCode, /focus:not-sr-only/);
  assert.match(layoutCode, /<main id="main-content"/);
});

// ---------------------------------------------------------------------------
// 31–36. The dashboard
// ---------------------------------------------------------------------------

/** The tile groups, up to where the attention list starts. */
const tileBlock = dashboardCode.slice(dashboardCode.indexOf('const tileGroups = ['),
  dashboardCode.indexOf('const attention = ['));

test('31. all eight metrics are still shown', () => {
  const labels = [...tileBlock.matchAll(/\{ label: '([^']+)', value: summary\?\./g)].map((m) => m[1]);
  assert.deepEqual(labels, [
    'Projects', 'Units', 'Transactions', 'Builds',
    'Documents', 'Open conversations', 'Open tasks', 'Unread notifications',
  ]);
});

test('32. every metric still links to its existing route', () => {
  const tiles = [...tileBlock.matchAll(/\{ label: '([^']+)', value: summary\?\.(\w+) \?\? 0, icon: \w+, to: '([^']+)'/g)]
    .map((m) => ({ label: m[1], field: m[2], to: m[3] }));
  assert.deepEqual(tiles.map((t) => [t.label, t.field, t.to]), [
    ['Projects', 'projects', '/builder/projects'],
    ['Units', 'units', '/builder/inventory'],
    ['Transactions', 'transactions', '/builder/transactions'],
    ['Builds', 'construction_cases', '/builder/construction'],
    ['Documents', 'documents', '/builder/documents'],
    ['Open conversations', 'open_conversations', '/builder/messages'],
    ['Open tasks', 'open_tasks', '/builder/tasks'],
    ['Unread notifications', 'unread_notifications', '/builder/notifications'],
  ]);
  for (const tile of tiles) assert.ok(ROUTES.includes(tile.to), `${tile.to} is not a Builder route`);
});

test('33. the query hooks are unchanged and no new call was added', () => {
  assert.match(dashboardCode,
    /import \{ useBuilderActivity, useBuilderWorkspaceSummary \} from '@\/lib\/builderQueries'/);
  assert.match(dashboardCode, /const summaryQuery = useBuilderWorkspaceSummary\(\);/);
  assert.match(dashboardCode, /const activityQuery = useBuilderActivity\(\);/);
  assert.equal((dashboardCode.match(/use[A-Z]\w*Query|useQuery|useMutation/g) ?? []).length, 0);
  assert.doesNotMatch(dashboardCode, /invokeSecureFunction|supabase\.|\.rpc\(|queryKey/);
  // The hooks themselves — where the query keys live — are not part of this change.
  assert.ok(!changedFiles.includes('src/lib/builderQueries.ts'), 'the query hooks were modified');
});

test('34. recent activity keeps its limit, labels and destination', () => {
  assert.match(dashboardCode, /const activity = \(activityQuery\.data \|\| \[\]\)\.slice\(0, 8\);/);
  assert.match(dashboardCode, /activityActionLabel\(entry\.action\)/);
  assert.match(dashboardCode, /ACTIVITY_ENTITY_LABELS\[entry\.entity_type\] \?\? entry\.entity_type/);
  assert.match(dashboardCode, /ACTOR_TYPE_LABELS\[entry\.actor_type\] \?\? entry\.actor_type/);
  assert.match(dashboardCode, /formatWorkspaceTime\(entry\.created_at\)/);
  assert.match(dashboardCode, /<Link to="\/builder\/activity">View all<\/Link>/);
  // No administrative entity is surfaced that the query excludes.
  assert.doesNotMatch(dashboardCode, /previous_state|new_state|ip_address|user_agent/);
});

test('35. no figure on the page is invented', () => {
  // Every number comes from `summary`, `permissions` or the activity list.
  const numericLiterals = [...dashboardCode.matchAll(/value=\{(\d+)\}/g)].map((m) => m[1]);
  assert.deepEqual(numericLiterals, [], 'a metric card was given a literal value');
  assert.match(dashboardCode, /value=\{value\}/);
  assert.doesNotMatch(dashboardCode, /Math\.(random|round|floor)|placeholder|mock|sample|demo/i);
  // The zero explanation survives, because a zero is a permission answer.
  assert.match(dashboardCode,
    /A zero means nothing you can see,\s*\n?\s*not necessarily nothing at all\./);
});

test('36. attention items read only the summary, and only above zero', () => {
  const block = dashboardCode.slice(dashboardCode.indexOf('const attention = ['),
    dashboardCode.indexOf('return ('));
  assert.deepEqual(
    [...block.matchAll(/\{ label: '([^']+)', value: summary\?\.(\w+) \?\? 0, to: '([^']+)' \}/g)]
      .map((m) => [m[1], m[2], m[3]]),
    [
      ['Open defects', 'open_defects', '/builder/construction'],
      ['Overdue tasks', 'overdue_tasks', '/builder/tasks'],
      ['Unread messages', 'unread_messages', '/builder/messages'],
    ]);
  assert.match(block, /\.filter\(\(item\) => item\.value > 0\);/);
  assert.match(dashboardCode, /\{attention\.length \? \(/);
  // No severity is attached that the data does not carry.
  assert.doesNotMatch(dashboardCode, /'(critical|high|medium|low|urgent)'/i);
});

// ---------------------------------------------------------------------------
// 37–45. General safety
// ---------------------------------------------------------------------------

test('37. no Solicitor Portal file was changed, and none is imported', () => {
  for (const file of changedFiles) {
    assert.ok(!/solicitor/i.test(file), `${file} is Solicitor Portal code`);
  }
  for (const [name, code] of [['terms', termsCode], ['onboarding', onboardingCode],
    ['layout', layoutCode], ['dashboard', dashboardCode]]) {
    assert.doesNotMatch(code, /from '[^']*[Ss]olicitor/, `${name} imports Solicitor code`);
  }
});

test('38. no Finance Portal file was changed, and none is imported', () => {
  for (const file of changedFiles) {
    assert.ok(!/finance/i.test(file), `${file} is Finance Portal code`);
  }
  for (const [name, code] of [['terms', termsCode], ['onboarding', onboardingCode],
    ['layout', layoutCode], ['dashboard', dashboardCode], ['admin', adminCode]]) {
    assert.doesNotMatch(code, /from '[^']*[Ff]inance/, `${name} imports Finance code`);
  }
});

test('39. every changed file is Builder frontend presentation', () => {
  const allowedPrefixes = [
    'src/pages/builder/', 'src/components/builder-portal/',
    'src/components/admin/builder-portal/', 'tests/builder-portal/',
  ];
  const allowedFiles = ['src/pages/admin/BuilderPortalAdmin.tsx', 'src/lib/builderAccessTerms.ts'];
  for (const file of changedFiles) {
    assert.ok(
      allowedFiles.includes(file) || allowedPrefixes.some((prefix) => file.startsWith(prefix)),
      `${file} is outside the Builder frontend`);
  }
});

test('40. no authentication, permission or transport logic moved', () => {
  for (const file of changedFiles) {
    assert.ok(!file.includes('useBuilderPortalAuth'), 'the auth provider was modified');
    assert.ok(!file.includes('BuilderPortalProtectedRoute'), 'the protected route was modified');
    assert.ok(!file.includes('secureInvoke'), 'the secure invocation helper was modified');
    assert.ok(!file.includes('src/lib/builderPortal.ts'), 'the API wrapper was modified');
    assert.ok(!file.includes('useModulePermissions'), 'the permission resolver was modified');
  }
  // The surfaces consume those modules; none of them re-implements one.
  for (const [name, code] of [['terms', termsCode], ['onboarding', onboardingCode],
    ['layout', layoutCode], ['dashboard', dashboardCode]]) {
    assert.doesNotMatch(code, /localStorage|sessionStorage|document\.cookie/,
      `${name} persists state in the browser`);
  }
  assert.match(adminCode, /useModulePermissions\('builder_portal_admin'\)/);
  assert.match(adminCode, /disabled=\{!canEdit \|\| busy\}/);
});

test('41. every new presentation component is display-only', () => {
  const dir = 'src/components/builder-portal/ui';
  const files = readdirSync(join(root, dir)).filter((name) => name.endsWith('.tsx'));
  assert.deepEqual(files.map((name) => `${dir}/${name}`).sort(), NEW_UI.slice().sort());
  for (const file of NEW_UI) {
    const code = stripJsComments(read(file));
    assert.doesNotMatch(code, /invokeSecureFunction|supabase|useQuery|useMutation|\.rpc\(/,
      `${file} reaches a backend`);
    assert.doesNotMatch(code, /useBuilderPortalAuth|useModulePermissions|canEdit|permissions\[/,
      `${file} makes a permission or authentication decision`);
    assert.doesNotMatch(code, /localStorage|sessionStorage|document\.cookie/,
      `${file} touches Web Storage`);
    // Props in, markup out.
    assert.match(code, /export (?:function|const|interface)/);
  }
});

test('42. no raw hex colour or palette class was introduced', () => {
  const surfaces = [
    ['terms', termsPage], ['onboarding', onboardingPage], ['layout', layout],
    ['dashboard', dashboard], ['admin', adminPage],
    ...NEW_UI.map((file) => [file, read(file)]),
    ['shell', read('src/components/builder-portal/BuilderPortalShell.tsx')],
  ];
  for (const [name, code] of surfaces) {
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, `${name} contains a raw hex colour`);
    assert.doesNotMatch(code, /\b(bg|text|border)-(red|blue|green|slate|zinc|gray|grey|amber|indigo|violet|emerald)-\d{2,3}\b/,
      `${name} uses a raw Tailwind palette class`);
  }
});

test('43. no new styling or animation dependency was added', () => {
  assert.ok(!changedFiles.includes('package.json'), 'package.json was modified');
  assert.ok(!changedFiles.includes('package-lock.json'), 'the lockfile was modified');
  assert.ok(!changedFiles.includes('tailwind.config.ts'), 'the Tailwind config was modified');
  assert.ok(!changedFiles.includes('src/index.css'), 'the global theme was modified');
  // Framer Motion was already a dependency, and is the only motion import.
  const packageJson = JSON.parse(read('package.json'));
  assert.ok(packageJson.dependencies['framer-motion'], 'framer-motion is not an existing dependency');
  assert.match(layoutCode, /from 'framer-motion'/);
  assert.match(layoutCode, /const reduceMotion = useReducedMotion\(\);/);
  assert.match(layoutCode, /reduceMotion \? \{ duration: 0 \}/);
  assert.match(governanceShell, /motion-reduce:animate-none/);
});

test('44. nothing on these surfaces can push the page sideways', () => {
  // Long names truncate or wrap rather than widening their column, and every
  // flex column that holds them is allowed to shrink.
  for (const [name, code] of [['layout', layoutCode], ['dashboard', dashboardCode],
    ['terms', termsCode], ['onboarding', onboardingCode]]) {
    assert.match(code, /min-w-0/, `${name} has no shrinkable column`);
    assert.doesNotMatch(code, /w-screen|overflow-x-visible/, `${name} can exceed the viewport`);
  }
  assert.match(layoutCode, /truncate/);
  assert.match(dashboardCode, /break-words/);
  // Terms and onboarding render the organisation name through the shared
  // shell, which is where its wrapping is decided.
  assert.match(governanceShell, /break-words/);
  // The metric grid reflows rather than forcing four columns.
  assert.match(dashboardCode, /grid gap-3 sm:grid-cols-2 xl:grid-cols-4/);
});

test('45. the shell switches to the drawer at a real breakpoint', () => {
  // Sidebar from `lg` up, drawer below it — one rule, both directions, so no
  // width can end up with neither.
  assert.match(layoutCode, /hidden h-screen w-72 shrink-0 flex-col[^"]*lg:flex/);
  assert.match(layoutCode, /className="h-9 w-9 shrink-0 lg:hidden"/);
  assert.match(layoutCode, /fixed inset-0 z-40[^"]*lg:hidden/);
  assert.match(layoutCode, /fixed inset-y-0 left-0 z-50[^"]*lg:hidden/);
  // Actions stack full width on a phone and sit inline from `sm`.
  const shell = read('src/components/builder-portal/BuilderPortalShell.tsx');
  assert.match(shell, /\[&>\*\]:w-full sm:\[&>\*\]:w-auto/);
  assert.match(dashboardCode, /className="w-full shrink-0 sm:w-auto"/);
  assert.match(termsCode, /className="w-full sm:w-auto sm:min-w-\[200px\]"/);
  assert.match(onboardingCode, /className="w-full sm:w-auto sm:min-w-\[200px\]"/);
});
