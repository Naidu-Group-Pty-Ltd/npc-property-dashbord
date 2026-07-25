import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canPublishPortfolioForClient } from './portfolioPublicationAuthorization.ts';

const client = {
  id: 'client-a',
  created_by: 'owner-user',
  assigned_team_user_id: 'assigned-user',
};

Deno.test('portfolio publication permits the client owner and assigned team member', () => {
  assertEquals(canPublishPortfolioForClient('owner-user', client, false, false), true);
  assertEquals(canPublishPortfolioForClient('assigned-user', client, false, false), true);
});

Deno.test('portfolio publication denies an unassigned staff user', () => {
  assertEquals(canPublishPortfolioForClient('other-user', client, false, false), false);
  assertEquals(canPublishPortfolioForClient('other-user', null, false, false), false);
});

Deno.test('portfolio publication preserves trusted superadmin and service-role access', () => {
  assertEquals(canPublishPortfolioForClient('superadmin-user', client, true, false), true);
  assertEquals(canPublishPortfolioForClient('service_role', null, false, true), true);
});
