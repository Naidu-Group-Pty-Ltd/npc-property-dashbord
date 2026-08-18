import 'package:flutter_test/flutter_test.dart';
import 'package:npc_api/npc_api.dart';
import 'package:npc_portal/npc_portal.dart';

/// Pins every descriptor field against the backend audit.
///
/// This test is the point of the descriptor. The planning that preceded it
/// claimed finance, solicitor and builder were all cookie-only; three of those
/// four claims were wrong, and nothing caught it because nothing checked. A
/// hopeful edit that marks a portal native-ready now has to change a value a
/// test names.
void main() {
  group('client portal', () {
    const NpcPortalDescriptor d = NpcPortals.client;

    test('carries the session in its own header', () {
      final NpcCredentialTransport t = d.transport;
      expect(t, isA<NpcHeaderTransport>());
      expect((t as NpcHeaderTransport).header, 'x-portal-session-token');
      expect(t.headers('tok'), <String, String>{
        'x-portal-session-token': 'tok',
      });
      expect(t.bodyFields('tok'), <String, Object?>{
        'portal_session_token': 'tok',
        'session_token': 'tok',
      });
    });

    test('login returns the token in the body, and it is native-ready', () {
      expect(d.tokenDelivery, NpcTokenDelivery.responseBody);
      expect(d.requiresAllowListedOrigin, isFalse);
      expect(d.portalDiscriminator, isNull);
      expect(d.nativeBlockers, isEmpty);
      expect(d.isNativeReady, isTrue);
    });
  });

  group('finance portal', () {
    const NpcPortalDescriptor d = NpcPortals.finance;

    test('uses x-finance-session-token and is native-ready', () {
      expect(
        (d.transport as NpcHeaderTransport).header,
        'x-finance-session-token',
      );
      expect(d.tokenDelivery, NpcTokenDelivery.responseBody);
      expect(d.requiresAllowListedOrigin, isFalse);
      expect(d.isNativeReady, isTrue);
      expect(d.sessionLifetime, const Duration(hours: 12));
    });
  });

  group('solicitor portal', () {
    const NpcPortalDescriptor d = NpcPortals.solicitor;

    test('accepts a header but issues the token only via Set-Cookie', () {
      expect(
        (d.transport as NpcHeaderTransport).header,
        'x-solicitor-session-token',
      );
      expect(d.tokenDelivery, NpcTokenDelivery.setCookieHeader);
    });

    test('is blocked by the Origin gate alone', () {
      expect(d.requiresAllowListedOrigin, isTrue);
      expect(d.portalDiscriminator, 'solicitor-portal');
      expect(d.nativeBlockers, hasLength(1));
      expect(d.nativeBlockers.single, contains('Origin'));
      expect(d.isNativeReady, isFalse);
    });
  });

  group('builder portal', () {
    const NpcPortalDescriptor d = NpcPortals.builder;

    test('has no native credential carrier at all', () {
      expect(d.transport, isA<NpcCookieOnlyTransport>());
      expect(d.transport.isNative, isFalse);
      expect(d.transport.headers('tok'), isEmpty);
      expect(d.transport.bodyFields('tok'), isEmpty);
    });

    test('is blocked twice over, and selects an organisation', () {
      expect(d.nativeBlockers, hasLength(2));
      expect(d.isNativeReady, isFalse);
      expect(d.selectsOrganisation, isTrue);
      expect(d.idleTimeout, const Duration(minutes: 30));
    });
  });

  group('the estate', () {
    test('three of five apps are native-ready today', () {
      final List<String> ready = NpcPortals.all
          .where((NpcPortalDescriptor d) => d.isNativeReady)
          .map((NpcPortalDescriptor d) => d.id)
          .toList();
      expect(ready, <String>['command_centre', 'client', 'finance']);
    });

    test('only the Command Centre is staff-scoped', () {
      expect(NpcPortals.commandCentre.scope, NpcFunctionScope.staff);
      for (final NpcPortalDescriptor d in NpcPortals.portals) {
        expect(d.scope, NpcFunctionScope.portal, reason: d.id);
      }
    });

    test('every portal login is Turnstile-gated; the staff login is not', () {
      expect(NpcPortals.commandCentre.requiresTurnstile, isFalse);
      for (final NpcPortalDescriptor d in NpcPortals.portals) {
        expect(d.requiresTurnstile, isTrue, reason: d.id);
      }
    });

    test('function names are derived from one prefix', () {
      expect(NpcPortals.finance.loginFunction, 'finance-portal-login');
      expect(NpcPortals.finance.verifyFunction, 'finance-portal-verify');
      expect(NpcPortals.builder.logoutFunction, 'builder-portal-logout');
    });

    test('ids are unique and resolvable', () {
      final Set<String> ids = NpcPortals.all
          .map((NpcPortalDescriptor d) => d.id)
          .toSet();
      expect(ids.length, NpcPortals.all.length);
      expect(NpcPortals.byId('finance'), same(NpcPortals.finance));
      expect(NpcPortals.byId('nope'), isNull);
    });

    test('only Origin-gated portals send a discriminator', () {
      for (final NpcPortalDescriptor d in NpcPortals.all) {
        if (d.portalDiscriminator != null) {
          expect(d.baseHeaders['x-portal-request'], d.portalDiscriminator);
        } else {
          expect(d.baseHeaders, isEmpty, reason: d.id);
        }
      }
    });
  });
}
