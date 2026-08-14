import 'package:npc_api/npc_api.dart';
import 'package:npc_client/src/app_scope.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the client app is portal-scoped and cannot reach staff functions', () {
    expect(appScope, NpcFunctionScope.portal);
    final Set<String> allowed = NpcFunctions.allowedFor(appScope);
    expect(allowed.intersection(NpcFunctions.staff), isEmpty);
    expect(allowed.intersection(NpcFunctions.serverOnly), isEmpty);
  });
}
