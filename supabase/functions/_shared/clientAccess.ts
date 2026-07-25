import { actorIsSuperadmin } from './authz.ts';

export async function canAccessClient(
  supabase: any,
  actor: { userId: string | null; authMethod?: string | null },
  clientId: string,
): Promise<boolean> {
  if (actor.authMethod === 'service_role' || actor.userId === 'service_role') return true;
  if (!actor.userId) return false;
  if (await actorIsSuperadmin(supabase, actor.userId)) return true;

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .or(`created_by.eq.${actor.userId},assigned_team_user_id.eq.${actor.userId}`)
    .maybeSingle();

  return Boolean(client);
}

export async function canAccessAllClients(
  supabase: any,
  actor: { userId: string | null; authMethod?: string | null },
): Promise<boolean> {
  return actor.authMethod === 'service_role' ||
    actor.userId === 'service_role' ||
    Boolean(actor.userId && await actorIsSuperadmin(supabase, actor.userId));
}
