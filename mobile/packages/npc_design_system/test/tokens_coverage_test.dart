import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:npc_design_system/npc_design_system.dart';

/// The parity gate named in mobile/plan.md's verification section.
///
/// A token added to `src/styles/tokens.css` on the web must reach mobile. The
/// failure this prevents is silent: an unresolved token is not an error in
/// Dart, it is simply a missing map entry, and the screen renders with a
/// fallback nobody chose.
void main() {
  final File source = File('../../design-tokens.json');

  test('every exported token reaches the generated Dart tables', () {
    final Map<String, Object?> json =
        jsonDecode(source.readAsStringSync()) as Map<String, Object?>;
    final Map<String, Object?> themes = json['themes']! as Map<String, Object?>;

    expect(
      NpcTokens.all.keys.toSet(),
      themes.keys.toSet(),
      reason:
          'A theme was added or removed from the web export without '
          'regenerating tokens.g.dart. Run `npm run mobile:dart:tokens`.',
    );

    for (final MapEntry<String, Object?> entry in themes.entries) {
      final Map<String, Object?> exported =
          entry.value! as Map<String, Object?>;
      final NpcTokenSet generated = NpcTokens.all[entry.key]!;

      expect(
        generated.tokenNames.toSet(),
        exported.keys.toSet(),
        reason:
            'Theme "${entry.key}" lost or gained tokens between the JSON '
            'export and tokens.g.dart.',
      );
      expect(generated.tokenCount, exported.length);
    }
  });

  test('core semantic colours resolve for every theme', () {
    for (final NpcTokenSet tokens in NpcTokens.all.values) {
      expect(
        tokens.colors['--background'] ?? tokens.colors['--card'],
        isNotNull,
        reason: '${tokens.name} has no background colour to build a theme on.',
      );
    }
  });

  test('var() references are resolved, not carried through', () {
    for (final NpcTokenSet tokens in NpcTokens.all.values) {
      for (final MapEntry<String, String> raw in tokens.raws.entries) {
        // Composite CSS values (gradients, shadows) legitimately embed var().
        // A *bare* var() means resolution failed.
        expect(
          RegExp(r'^var\(--[a-z0-9-]+\)$').hasMatch(raw.value),
          isFalse,
          reason: '${tokens.name} ${raw.key} is an unresolved reference.',
        );
      }
    }
  });
}
