import 'package:npc_core/npc_core.dart';

import 'src/bootstrap/bootstrap.dart';

/// Entry point for every flavor.
///
/// There is one entry point rather than three, because the flavor is a
/// `--dart-define` and a flavor that can be selected at build time is one that
/// cannot drift out of sync with the Gradle/Xcode flavor of the same name.
void main() => bootstrap(NpcFlavor.fromEnvironment());
