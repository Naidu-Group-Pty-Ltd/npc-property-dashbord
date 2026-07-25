interface PortfolioPublicationClient {
  id: string;
  created_by: string | null;
  assigned_team_user_id: string | null;
}

/** Human publishers may act only for clients they own or are assigned to. */
export function canPublishPortfolioForClient(
  userId: string,
  client: PortfolioPublicationClient | null,
  isSuperadmin: boolean,
  isServiceRole: boolean,
): boolean {
  if (isServiceRole || isSuperadmin) return true;
  return Boolean(client && (client.created_by === userId || client.assigned_team_user_id === userId));
}
