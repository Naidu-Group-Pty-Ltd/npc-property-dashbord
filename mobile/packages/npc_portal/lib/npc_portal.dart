/// What the five NPC apps share.
///
/// Five separate binaries, one architecture. Every difference between the
/// portals that was found by auditing the backend is a *value* — a header
/// name, a body field, a discriminator — never a different algorithm. So the
/// apps differ by [NpcPortalDescriptor] and by their screens, and by nothing
/// else.
library;

export 'src/credential_transport.dart';
export 'src/portal_descriptor.dart';
export 'src/portal_session.dart';
export 'src/portals.dart';
export 'src/sync_stamp.dart';
export 'src/portal_auth_client.dart';
export 'src/shell/bootstrap.dart';
export 'src/shell/portal_app.dart';
export 'src/shell/portal_app_state.dart';
export 'src/shell/screens/glass_card.dart';
export 'src/shell/secure_store.dart';
