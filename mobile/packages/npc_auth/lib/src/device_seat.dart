import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:meta/meta.dart';
import 'package:npc_core/npc_core.dart';

/// One device holding a seat, as Mission Control reports it.
@immutable
class NpcDevice {
  const NpcDevice({
    required this.id,
    required this.label,
    required this.platform,
    this.lastSeenAt,
  });

  factory NpcDevice.fromJson(Map<String, Object?> json) => NpcDevice(
    id: (json['id'] ?? '').toString(),
    label: (json['device_label'] ?? 'Unknown device').toString(),
    platform: json['platform']?.toString(),
    lastSeenAt: json['last_seen_at'] == null
        ? null
        : DateTime.tryParse(json['last_seen_at'].toString()),
  );

  final String id;
  final String label;
  final String? platform;
  final DateTime? lastSeenAt;
}

/// The result of claiming a seat.
@immutable
sealed class NpcSeatOutcome {
  const NpcSeatOutcome();
}

/// The seat was claimed.
final class NpcSeatClaimed extends NpcSeatOutcome {
  const NpcSeatClaimed({
    required this.deviceId,
    required this.active,
    required this.limit,
  });
  final String deviceId;
  final int active;
  final int limit;
}

/// Every seat on the plan is taken.
///
/// This is a **routine outcome**, not an error: `device_limit_per_seat` is 2 on
/// the Starter plan, so one browser plus this app is the cap. The app owes the
/// user the device list and a way to revoke one, the way `ManageDevicesDialog`
/// does on web — not a failure toast (ARCHITECTURE.md A5).
final class NpcSeatLimitReached extends NpcSeatOutcome {
  const NpcSeatLimitReached({
    required this.devices,
    required this.active,
    required this.limit,
  });
  final List<NpcDevice> devices;
  final int active;
  final int limit;
}

/// Something else went wrong.
final class NpcSeatError extends NpcSeatOutcome {
  const NpcSeatError(this.message);
  final String message;
}

/// Client for the existing `mission-control-devices` edge function.
///
/// The function is transport-agnostic and is reused **unchanged** by mobile —
/// there is no server work here. It is also the boundary that keeps the clone
/// API key server-side, which is why the device never calls Mission Control
/// itself.
class NpcDeviceSeatClient {
  NpcDeviceSeatClient({
    required this.functionsBaseUrl,
    required this.anonKey,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  /// How often a live device reports in. Matches the web's five-minute cadence
  /// so a mobile seat ages out on the same schedule as a browser one.
  static const Duration heartbeatInterval = Duration(minutes: 5);

  final String functionsBaseUrl;
  final String anonKey;
  final http.Client _http;
  static const NpcLog _log = NpcLog('npc_auth.seat');

  Future<NpcSeatOutcome> register({
    required String accessToken,
    required String installId,
    required String deviceLabel,
    required String platform,
  }) async {
    final Map<String, Object?> body = await _call(
      accessToken,
      <String, Object?>{
        'action': 'register',
        'device_fingerprint': installId,
        'device_label': deviceLabel,
        'platform': platform,
      },
    );

    if (body['error'] == 'device_limit_reached') {
      final Object? raw = body['devices'];
      return NpcSeatLimitReached(
        devices: raw is List
            ? raw
                  .whereType<Map<String, Object?>>()
                  .map(NpcDevice.fromJson)
                  .toList(growable: false)
            : const <NpcDevice>[],
        active: (body['devices_active'] as num?)?.toInt() ?? 0,
        limit: (body['device_limit'] as num?)?.toInt() ?? 0,
      );
    }
    if (body['ok'] != true) {
      return NpcSeatError((body['error'] ?? 'register_failed').toString());
    }
    return NpcSeatClaimed(
      deviceId: (body['device_id'] ?? '').toString(),
      active: (body['devices_active'] as num?)?.toInt() ?? 0,
      limit: (body['device_limit'] as num?)?.toInt() ?? 0,
    );
  }

  Future<void> heartbeat({
    required String accessToken,
    required String deviceId,
  }) async {
    await _call(accessToken, <String, Object?>{
      'action': 'heartbeat',
      'device_id': deviceId,
    });
  }

  Future<void> release({
    required String accessToken,
    required String installId,
    String? deviceId,
    String reason = 'user_signed_out',
  }) async {
    await _call(accessToken, <String, Object?>{
      'action': 'release',
      'device_id': ?deviceId,
      'device_fingerprint': installId,
      'reason': reason,
    });
  }

  Future<Map<String, Object?>> _call(
    String accessToken,
    Map<String, Object?> payload,
  ) async {
    try {
      final http.Response response = await _http
          .post(
            Uri.parse('$functionsBaseUrl/mission-control-devices'),
            headers: <String, String>{
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $accessToken',
              'apikey': anonKey,
            },
            body: jsonEncode(payload),
          )
          .timeout(const Duration(seconds: 15));
      final Object? decoded = jsonDecode(response.body);
      return decoded is Map<String, Object?> ? decoded : <String, Object?>{};
    } catch (error) {
      _log.warn(
        'Device seat call failed',
        data: <String, Object?>{'action': payload['action']},
      );
      return <String, Object?>{'error': 'network_error'};
    }
  }
}
