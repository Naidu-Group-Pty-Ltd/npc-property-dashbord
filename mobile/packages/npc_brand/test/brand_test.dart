import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:npc_brand/npc_brand.dart';
import 'package:npc_design_system/npc_design_system.dart';

void main() {
  test('parses the HSL triplet form the platform stores', () {
    final Color? colour = NpcBrandConfig.parseHslToken('268 58% 54%');
    expect(colour, isNotNull);
    // 268° purple — same value the token generator produces for --accent.
    expect(colour, NpcTokens.light.colors['--accent']);
  });

  test('parses hex, with or without the hash', () {
    expect(NpcBrandConfig.parseHslToken('#336699'), const Color(0xFF336699));
    expect(NpcBrandConfig.parseHslToken('336699'), const Color(0xFF336699));
  });

  test('drops an unparseable colour rather than guessing one', () {
    for (final Object? bad in <Object?>[
      null,
      '',
      'rebeccapurple',
      42,
      'hsl(1,2,3)',
    ]) {
      expect(NpcBrandConfig.parseHslToken(bad), isNull);
    }
  });

  test('an empty brand leaves the design system untouched', () {
    final ThemeData base = NpcTheme.named(NpcTheme.light);
    const NpcBrandConfig empty = NpcBrandConfig();
    expect(empty.isEmpty, isTrue);
    expect(identical(empty.apply(base), base), isTrue);
  });

  test('a partial brand replaces only the roles it names', () {
    final ThemeData base = NpcTheme.named(NpcTheme.light);
    final NpcBrandConfig brand = NpcBrandConfig.fromSettings(
      themeConfig: <String, Object?>{'primaryColor': '#FF0000'},
    );
    final ThemeData themed = brand.apply(base);

    expect(themed.colorScheme.primary, const Color(0xFFFF0000));
    // Untouched roles keep the design system's values.
    expect(themed.colorScheme.surface, base.colorScheme.surface);
    expect(themed.colorScheme.error, base.colorScheme.error);
  });

  test('reads dark mode default from theme_config', () {
    expect(
      NpcBrandConfig.fromSettings(
        themeConfig: <String, Object?>{'darkModeDefault': 'dark'},
      ).darkModeDefault,
      ThemeMode.dark,
    );
    expect(
      NpcBrandConfig.fromSettings(themeConfig: <String, Object?>{})
          .darkModeDefault,
      ThemeMode.system,
    );
  });
}
