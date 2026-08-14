import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:npc_core/npc_core.dart';

import 'tenant.dart';

/// Resolves a workspace slug to the backend that serves it.
///
/// The document is static and unauthenticated, served by the tenant's own
/// clone. The device talks only to its tenant; **Mission Control is never
/// contacted from a device** — the same boundary `src/lib/deviceSession.ts`
/// keeps on the web, where the clone API key stays server-side.
class NpcTenantDiscovery {
  NpcTenantDiscovery({required this.flavor, http.Client? httpClient})
    : _http = httpClient ?? http.Client();

  final NpcFlavor flavor;
  final http.Client _http;
  static const NpcLog _log = NpcLog('npc_tenant');

  /// Where a slug's discovery document lives for this flavor.
  Uri discoveryUri(String slug) => Uri.https(
    '$slug.${flavor.discoveryDomain}',
    '/.well-known/npc-mobile.json',
  );

  /// Resolves [slug], or explains why it could not.
  Future<NpcResult<NpcTenant>> resolve(String slug) async {
    final String normalised = slug.trim().toLowerCase();
    if (!RegExp(r'^[a-z0-9][a-z0-9-]{1,62}$').hasMatch(normalised)) {
      return const NpcFailure<NpcTenant>(
        'invalid_slug',
        'That workspace name contains characters it cannot contain.',
      );
    }

    final Uri uri = discoveryUri(normalised);
    try {
      final http.Response response = await _http
          .get(uri)
          .timeout(const Duration(seconds: 10));
      if (response.statusCode == 404) {
        return NpcFailure<NpcTenant>(
          'unknown_workspace',
          'No NPC workspace called "$normalised".',
        );
      }
      if (response.statusCode != 200) {
        return NpcFailure<NpcTenant>(
          'discovery_failed',
          'That workspace could not be reached (${response.statusCode}).',
        );
      }
      final Object? decoded = jsonDecode(response.body);
      if (decoded is! Map<String, Object?>) {
        return const NpcFailure<NpcTenant>(
          'discovery_malformed',
          'That workspace returned something this app cannot read.',
        );
      }
      return NpcSuccess<NpcTenant>(
        NpcTenant.fromDiscovery(normalised, decoded),
      );
    } on FormatException catch (error) {
      _log.warn(
        'Discovery document rejected',
        data: <String, Object?>{'slug': normalised, 'reason': error.message},
      );
      return const NpcFailure<NpcTenant>(
        'discovery_malformed',
        'That workspace returned something this app cannot read.',
      );
    } catch (error) {
      _log.warn(
        'Discovery unreachable',
        data: <String, Object?>{'slug': normalised},
      );
      return const NpcFailure<NpcTenant>(
        'discovery_unreachable',
        'Could not reach that workspace. Check your connection and try again.',
      );
    }
  }
}
