import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:npc_design_system/npc_design_system.dart';

void main() {
  test('finance palettes build as dark themes', () {
    for (final String name in <String>[
      NpcTheme.financeMidnight,
      NpcTheme.financeGraphite,
      NpcTheme.dark,
    ]) {
      expect(NpcTheme.named(name).brightness, Brightness.dark);
    }
    expect(NpcTheme.named(NpcTheme.light).brightness, Brightness.light);
  });

  test('every theme carries the glass extension', () {
    for (final String name in NpcTokens.all.keys) {
      expect(NpcTheme.named(name).extension<GlassTheme>(), isNotNull);
    }
  });

  test('reduced transparency suppresses blur rather than dimming it', () {
    final GlassTheme opaque = GlassTheme.fromTokens(
      NpcTokens.light,
      transparencyEnabled: false,
    );
    expect(opaque.effectiveBlurSigma(), isNull);

    final GlassTheme glass = GlassTheme.fromTokens(
      NpcTokens.light,
      transparencyEnabled: true,
    );
    expect(glass.effectiveBlurSigma(), greaterThan(0));
    expect(
      glass.effectiveBlurSigma(large: true),
      greaterThan(glass.effectiveBlurSigma()!),
    );
  });

  test('an unknown theme name falls back rather than throwing', () {
    expect(NpcTheme.named('does-not-exist').brightness, Brightness.light);
  });
}
