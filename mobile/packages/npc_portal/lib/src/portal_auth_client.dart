import 'package:npc_api/npc_api.dart';

import 'portal_descriptor.dart';

/// Builds the API client for one app from its descriptor.
///
/// The scope comes from the descriptor rather than from the call site, so an
/// app physically cannot construct a client with another app's authority.
/// `scripts/mobile/check-api-scope.mjs` enforces the same rule over the
/// sources; this is the half that holds at runtime.
NpcApiClient buildPortalApiClient({
  required NpcPortalDescriptor descriptor,
  required String supabaseUrl,
  required String anonKey,
  required Future<String?> Function() sessionTokenProvider,
}) {
  return NpcApiClient(
    functionsBaseUrl: '$supabaseUrl/functions/v1',
    anonKey: anonKey,
    scope: descriptor.scope,
    accessTokenProvider: sessionTokenProvider,
  );
}
