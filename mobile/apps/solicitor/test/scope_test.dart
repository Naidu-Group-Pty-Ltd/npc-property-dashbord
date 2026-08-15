import 'package:flutter_test/flutter_test.dart';
import 'package:npc_api/npc_api.dart';
import 'package:npc_portal/npc_portal.dart';

void main() {
  const NpcPortalDescriptor descriptor = NpcPortals.solicitor;

  test(
    'the solicitor app is portal-scoped and cannot reach staff functions',
    () {
      expect(descriptor.scope, NpcFunctionScope.portal);
      final Set<String> allowed = NpcFunctions.allowedFor(descriptor.scope);
      expect(allowed.intersection(NpcFunctions.staff), isEmpty);
      expect(allowed.intersection(NpcFunctions.serverOnly), isEmpty);
    },
  );

  test('its login function name matches the backend', () {
    expect(descriptor.loginFunction, 'solicitor-portal-login');
  });
}
