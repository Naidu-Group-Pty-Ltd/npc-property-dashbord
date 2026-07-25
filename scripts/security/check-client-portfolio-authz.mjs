import { readFileSync } from 'node:fs';

const clientData = readFileSync('supabase/functions/get-client-data/index.ts', 'utf8');
const scenarios = readFileSync('supabase/functions/manage-bc-scenarios/index.ts', 'utf8');
const failures = [];

for (const required of [
  "requireModulePermission(supabase, actor, 'client_management', 'can_view')",
  'canAccessClient(supabase, actor, id)',
  'canAccessAllClients(supabase, actor)',
  'assigned_team_user_id.eq.${userId}',
]) {
  if (!clientData.includes(required)) failures.push(`get-client-data missing: ${required}`);
}

for (const required of [
  "'client_management',",
  "operation === 'list'",
  "'can_view'",
  "'can_edit'",
  "'can_delete'",
  ".select('client_id')",
  'canAccessClient(supabase, actor, authorizedClientId)',
]) {
  if (!scenarios.includes(required)) failures.push(`manage-bc-scenarios missing: ${required}`);
}

const clientGate = clientData.indexOf("requireModulePermission(supabase, actor, 'client_management', 'can_view')");
const clientRead = clientData.indexOf(".from('clients')", clientData.indexOf('// Fetch base client data'));
if (clientGate < 0 || clientRead < 0 || clientGate > clientRead) {
  failures.push('get-client-data authorization does not precede sensitive client reads');
}

const scenarioGate = scenarios.indexOf('const requiredPermission: ModulePerm');
const scenarioMutation = scenarios.indexOf(".insert(insertRow)");
if (scenarioGate < 0 || scenarioMutation < 0 || scenarioGate > scenarioMutation) {
  failures.push('scenario authorization does not precede mutations');
}

if (failures.length) {
  console.error(`Client portfolio authorization FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('Client portfolio authorization check passed.');
