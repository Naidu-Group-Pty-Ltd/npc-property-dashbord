/**
 * Builder / Developer Portal — onboarding tour contract tests.
 *
 * The Builder tour must mirror the Solicitor construction rather than being a
 * separate Builder-specific design. These assertions pin the mirroring: the
 * same storage-key shape, the same replay-event shape, the same step-card
 * structure, and Builder destinations with no legal terminology.
 *
 * The behaviour — appearance, the ten-step walk, persistence, skip, Escape,
 * replay, mobile fallback, reduced motion and ARIA labelling — is exercised in a
 * real browser by tests-e2e/builder-portal/onboarding-tour.e2e.ts (14 tests).
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const TOUR = 'src/components/builder-portal/BuilderOnboardingTour.tsx';
const tourSource = read(TOUR);
const solicitorTour = read('src/components/solicitor-portal/SolicitorOnboardingTour.tsx');
const layout = read('src/components/builder-portal/BuilderPortalLayout.tsx');
const settings = read('src/pages/builder/BuilderSettings.tsx');

/**
 * Comments stripped. The tour explains in prose which Solicitor construction it
 * adapts and which browser APIs it deliberately avoids, so an un-stripped
 * search matches the explanation rather than the code.
 */
const stripJs = (body) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const tourCode = stripJs(tourSource);

/** The step table, which is where destinations and terminology are asserted. */
const STEP_TABLE = tourCode.slice(
  tourCode.indexOf('const STEPS'), tourCode.indexOf('export const BUILDER_TOUR_EVENT'));

test('the Builder tour exists and is mounted in the portal layout', () => {
  assert.ok(existsSync(join(root, TOUR)));
  assert.match(layout, /import \{ BuilderOnboardingTour \}/);
  assert.match(layout, /<BuilderOnboardingTour \/>/);
});

test('the tour mirrors the Solicitor construction', () => {
  // Same primitives, so the two portals introduce themselves the same way.
  for (const marker of [
    'role="dialog"', 'aria-modal="true"', 'Close tour',
    'Start tour', 'Skip for now', 'STEPS', 'setCentered',
  ]) {
    assert.ok(solicitorTour.includes(marker), `solicitor tour has ${marker}`);
    assert.ok(tourSource.includes(marker), `builder tour mirrors ${marker}`);
  }
});

test('completion is server state, never browser state', () => {
  // The Builder Portal persists nothing in the browser. The Solicitor tour
  // caches completion in localStorage; copying that would fail
  // scripts/builder-portal/security-check.mjs, which is the point of the check.
  assert.match(solicitorTour, /localStorage/, 'the solicitor tour does use browser storage');
  assert.doesNotMatch(tourCode, /localStorage|sessionStorage|document\.cookie/);
  assert.match(tourSource, /useBuilderMyPreferences/);
  assert.match(tourSource, /preferences\?\.tour_completed_at/);
  assert.match(tourSource, /operation: 'complete_onboarding_tour'/);
});

test('the tour completion column exists and defaults to NULL', () => {
  const migration = read('supabase/migrations/20260810000100_builder_portal_onboarding_tour.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS tour_completed_at timestamptz/);
  assert.match(migration, /tour_completed_at must default to NULL/);
  // Idempotent and version-free, so finishing the tour can never collide with
  // the preferences form.
  assert.match(migration, /FUNCTION public\.builder_complete_onboarding_tour/);
  assert.match(migration, /COALESCE\(public\.builder_user_preferences\.tour_completed_at, now\(\)\)/);
  assert.doesNotMatch(migration, /_expected_version/);
});

test('the completion command is service-role only and owns its user', () => {
  const migration = read('supabase/migrations/20260810000100_builder_portal_onboarding_tour.sql');
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.builder_complete_onboarding_tour\(uuid\)\s*\n?\s*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.builder_complete_onboarding_tour\(uuid\) TO service_role/);

  // The Edge Function passes the SESSION user, never an id from the body.
  const workspaceFn = read('supabase/functions/builder-portal-workspace/index.ts');
  assert.match(workspaceFn, /operation === 'complete_onboarding_tour'/);
  assert.match(workspaceFn, /_builder_user_id: me\.id/);
});

test('the tour can be replayed from Builder settings', () => {
  assert.match(tourSource, /export const BUILDER_TOUR_EVENT = 'builder:start-tour'/);
  assert.match(tourSource, /window\.addEventListener\(BUILDER_TOUR_EVENT, onReplay\)/);
  assert.match(settings, /BUILDER_TOUR_EVENT/);
  assert.match(settings, /Replay portal tour/);
  // Replaying re-opens the tour even though the server flag is still stamped.
  assert.match(tourSource, /const onReplay = \(\) => \{ dismissed\.current = false;/);
});

test('replay never listens on the Solicitor event', () => {
  assert.doesNotMatch(tourSource, /solicitor:start-tour/);
  assert.doesNotMatch(settings, /solicitor:start-tour/);
});

test('the tour walks Builder destinations only', () => {
  const steps = STEP_TABLE;
  for (const id of ['dashboard', 'projects', 'inventory', 'transactions', 'construction',
                    'documents', 'messages', 'tasks', 'notifications', 'settings']) {
    assert.match(steps, new RegExp(`\\[data-tour="${id}"\\]`), `tour introduces ${id}`);
  }
});

test('no tour step uses legal or matter terminology', () => {
  const steps = STEP_TABLE;
  assert.doesNotMatch(steps, /matter|conveyanc|solicitor|firm|settlement|requisition|disbursement/i);
});

test('no tour step exposes another portal’s private domain', () => {
  const steps = STEP_TABLE;
  assert.doesNotMatch(steps, /commission|serviceability|borrowing capacity|AML|CTF|SMR|MLRO/i);
  // Builder-private commercial data must not be advertised either.
  assert.doesNotMatch(steps, /margin|supplier pricing|contractor pricing/i);
});

test('every tour anchor resolves to a real navigation destination', () => {
  const anchors = [...STEP_TABLE.matchAll(/\[data-tour="([a-z]+)"\]/g)].map((m) => m[1]);
  const nav = layout.slice(layout.indexOf('const NAV'), layout.indexOf('function tourAnchor'));

  // The anchor is derived from the route, so a tour step is valid exactly when
  // a NAV entry exists whose path yields that anchor.
  const routes = [...nav.matchAll(/to: '(\/builder[a-z/]*)'/g)].map((m) => m[1]);
  const derived = new Set(routes.map((to) => (to === '/builder' ? 'dashboard' : to.slice('/builder/'.length))));

  assert.ok(anchors.length > 0);
  for (const anchor of anchors) {
    assert.ok(derived.has(anchor), `${anchor} is not a real navigation destination`);
  }
  // And the layout actually renders the attribute the tour queries for.
  assert.match(layout, /data-tour=\{tourAnchor\(to\)\}/);
});

test('the anchor is derived from the route so it cannot drift', () => {
  // Storing the anchor on BuilderNavItem would let a step point at a label that
  // no longer matches its destination. Deriving it makes that unrepresentable.
  assert.match(layout, /function tourAnchor\(to: string\): string \{/);
  assert.match(layout, /to === '\/builder' \? 'dashboard' : to\.slice\('\/builder\/'\.length\)/);
});

test('reduced motion is honoured', () => {
  assert.match(tourSource, /motion-reduce:animate-none/);
  assert.match(tourSource, /motion-reduce:transition-none/);
});

test('the tour degrades to a centred card when the destination is not visible', () => {
  // The Builder nav scrolls horizontally on small screens, so a destination can
  // be off-screen with a zero-sized rect.
  assert.match(tourSource, /if \(rect\.width === 0 \|\| rect\.height === 0\) \{ setCentered\(true\); return; \}/);
  assert.match(tourSource, /if \(!el\) \{ setCentered\(true\); return; \}/);
});

test('the step card is kept inside the viewport', () => {
  assert.match(tourSource, /Math\.max\(Math\.min\(rect\.left, window\.innerWidth - 400\), 16\)/);
  assert.match(tourSource, /maxWidth: 'calc\(100vw - 32px\)'/);
});

test('the tour is keyboard dismissible and cleans up after itself', () => {
  assert.match(tourSource, /event\.key === 'Escape'/);
  assert.match(tourSource, /return \(\) => cleanup\(\);/);
  // Inline highlight styles must be removed, or a dismissed tour leaves the
  // navigation permanently outlined and raised above the page.
  assert.match(tourSource, /el\.style\.boxShadow = ''/);
  assert.match(tourSource, /shell\.style\.zIndex = ''/);
});

test('the stacking-context fix targets the Builder chrome', () => {
  // Builder uses a sticky top bar, not a sidebar. Comments are stripped first:
  // the file explains in prose which Solicitor construction it is adapting, so
  // an un-stripped search matches the explanation rather than the code.
  const code = tourSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.match(code, /closest\('header'\)/);
  assert.doesNotMatch(code, /closest\('aside'\)/);
});

test('a failed completion stamp fails safe', () => {
  // The tour closes either way; if the stamp does not land the tour simply
  // offers itself again next visit, which is the harmless direction.
  assert.match(tourSource, /workspace\.mutate\(\{ operation: 'complete_onboarding_tour' \}\)/);
  // It must not block closing on the round-trip.
  assert.doesNotMatch(tourSource, /await workspace\.mutateAsync/);
});
