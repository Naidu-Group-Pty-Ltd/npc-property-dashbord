import { createCorsHeaders as createBaseCorsHeaders } from './auth.ts';

const AUTH_ALLOWED_ORIGINS = new Set([
  'https://command-centre.npcservices.com.au',
  'https://npc-property-dashbord.lovable.app',
  'https://id-preview--7976d60b-c277-4851-889b-c170285f4be2.lovable.app',
  'https://7976d60b-c277-4851-889b-c170285f4be2.lovableproject.com',
  'http://localhost:5173',
  'http://localhost:8080',
]);

/**
 * Versioned CORS boundary for credentialed Command Centre auth endpoints.
 * Only exact, project-owned origins are reflected; unknown origins retain the
 * base helper's mismatched ACAO and therefore cannot read credentialed replies.
 */
export function createAuthCorsHeaders(origin: string | null): Record<string, string> {
  const headers = createBaseCorsHeaders(origin);
  if (origin && AUTH_ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}