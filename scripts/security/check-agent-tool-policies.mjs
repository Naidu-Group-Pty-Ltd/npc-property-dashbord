import { readFileSync } from 'node:fs';

const handler = readFileSync('supabase/functions/ai-dashboard-agent/index.ts', 'utf8');
const policy = readFileSync('supabase/functions/_shared/agentToolAuthz.ts', 'utf8');
const toolNames = [...handler.slice(handler.indexOf('async function executeTool'))
  .matchAll(/case '([^']+)': return execute/g)].map((match) => match[1]);
const failures = [];

for (const name of toolNames) {
  const row = policy.match(new RegExp(`'${name}':\\{([^}]+)\\}`));
  if (!row) { failures.push(`missing policy: ${name}`); continue; }
  const body = row[1];
  if (!/moduleKey:'[^']+'/.test(body)) failures.push(`missing module key: ${name}`);
  if (/^(add_|bulk_|cancel_|complete_|create_|delete_|generate_|link_|log_|remove_|reconcile_|revoke_|run_|save_|send_|set_|toggle_|trigger_|undo_|update_)/.test(name)
    && /permission:'can_view'/.test(body)) failures.push(`write tool has can_view: ${name}`);
  if (name.startsWith('delete_') && !/requiresConfirmation:true/.test(body)) failures.push(`delete lacks confirmation: ${name}`);
  if (/allowedActorTypes:\['human','internal'\]/.test(body) && !/allowedInternalCallers:\[/.test(body)) failures.push(`internal actor lacks allowlist: ${name}`);
}

// High-value data has a real business module (a REGISTERED dashboard_modules
// key, not the generic AI shell), and organization-wide/admin reads are
// explicitly elevated. Module keys must be registered — an unregistered key is
// deny-by-default and silently keeps a tool superadmin-only.
for (const expected of [
  "get_client_details: { moduleKey: 'client_management', permission: 'can_view' }",
  "get_income_sources: { moduleKey: 'client_management', permission: 'can_view' }",
  "get_proactive_insights: { moduleKey: 'agent', permission: 'can_view', requiresSuperadmin: true }",
  "get_top_clients: { moduleKey: 'client_management', permission: 'can_view', requiresSuperadmin: true }",
  "send_email: { moduleKey: 'email_copilot', permission: 'can_edit' }",
  "get_commission_actuals: { moduleKey: 'cash_flow', permission: 'can_view' }",
  "send_agreement_docusign: { moduleKey: 'agreements', permission: 'can_edit' }",
  "get_user_list: { moduleKey: 'user_management', permission: 'can_view', requiresSuperadmin: true }",
]) if (!policy.includes(expected)) failures.push(`missing real-module override: ${expected}`);

if (!handler.includes("if (body.only_user || !(await actorIsSuperadmin(sb, userId!))) q = q.eq('user_id', userId!);")) {
  failures.push('trace log does not scope non-superadmin reads to the requesting user');
}

// Guard: REAL_MODULE_OVERRIDES must only reference registered module keys (or the
// generic ai_dashboard shell for the un-remapped set). Keep this list in sync
// with public.dashboard_modules.
const REGISTERED_MODULES = new Set([
  'activity_logs','admin_email_access','agent','agreements','automation','borrowing_capacity',
  'calendar','call_logs','cash_flow','charts','checklists','client_management','client_tracker',
  'cloudflare','conversations','data_import','depreciation_comps','email_copilot','error_logs',
  'finance_portal_admin','game_plans','generated_reports','listings','monitoring','overview',
  'quality_assurance','reminders','report_qa','report_requests','reports','settings','sources',
  'templates','user_guide','user_management','white_label','client_portal_admin','ai_dashboard',
]);
const overrideBlock = policy.slice(policy.indexOf('REAL_MODULE_OVERRIDES'), policy.indexOf('TOOL_SECURITY_POLICIES'));
for (const m of overrideBlock.matchAll(/moduleKey:\s*'([a-z_]+)'/g)) {
  if (!REGISTERED_MODULES.has(m[1])) failures.push(`override uses unregistered module key: '${m[1]}'`);
}
// The tool->business-module resolver must only return registered keys.
const resolverBlock = policy.slice(policy.indexOf('resolveToolBusinessModule'), policy.indexOf('export async function authorizeAgentTool'));
for (const m of resolverBlock.matchAll(/return\s*'([a-z_]+)'/g)) {
  if (!REGISTERED_MODULES.has(m[1])) failures.push(`resolveToolBusinessModule returns unregistered key: '${m[1]}'`);
}

if (failures.length) {
  console.error(`Agent tool policy check FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Agent tool policy check passed (${toolNames.length} tools; semantic policy invariants verified).`);
