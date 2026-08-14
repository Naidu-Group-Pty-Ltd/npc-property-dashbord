import 'package:flutter/material.dart';

import 'glass_theme.dart';
import 'tokens.g.dart';

/// Builds Flutter themes from the generated NPC tokens.
///
/// Two layers, and confusing them produces an app that is correct on exactly
/// one tenant (ARCHITECTURE.md A11):
///
///  * this class is the **design system** — compiled in, from
///    `design-tokens.json`;
///  * `npc_brand` applies the **brand** — fetched at runtime from the resolved
///    tenant's `whitelabel_settings` and overriding the tokens it names.
///
/// Typography deliberately uses the platform's own type family. The web uses a
/// system stack; embedding a webfont to imitate the other platform's system
/// face would make both platforms wrong.
class NpcTheme {
  const NpcTheme._();

  /// Named theme keys, matching the web export.
  static const String light = 'light';
  static const String dark = 'dark';
  static const String financeMidnight = 'financeMidnight';
  static const String financeGraphite = 'financeGraphite';

  /// Builds [ThemeData] for a generated token set.
  ///
  /// The finance palettes are dark palettes, so they map to
  /// [Brightness.dark] — the same semantics the web applies with
  /// `data-palette="dark"`.
  static ThemeData build(
    NpcTokenSet tokens, {
    bool transparencyEnabled = true,
  }) {
    final bool isDark = tokens.name != light;
    final Color background =
        tokens.colors['--background'] ??
        (isDark ? const Color(0xFF0B0B0F) : const Color(0xFFFFFFFF));
    final Color foreground =
        tokens.colors['--foreground'] ??
        (isDark ? const Color(0xFFF5F5F5) : const Color(0xFF121212));
    final Color primary =
        tokens.colors['--primary'] ?? tokens.colors['--accent'] ?? foreground;

    final ColorScheme scheme =
        ColorScheme.fromSeed(
          seedColor: primary,
          brightness: isDark ? Brightness.dark : Brightness.light,
        ).copyWith(
          primary: primary,
          onPrimary: tokens.colors['--primary-foreground'],
          secondary: tokens.colors['--secondary'],
          onSecondary: tokens.colors['--secondary-foreground'],
          surface: tokens.colors['--card'] ?? background,
          onSurface: tokens.colors['--card-foreground'] ?? foreground,
          error: tokens.colors['--destructive'],
          onError: tokens.colors['--destructive-foreground'],
          outline: tokens.colors['--border'],
        );

    return ThemeData(
      useMaterial3: true,
      brightness: scheme.brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      extensions: <ThemeExtension<dynamic>>[
        GlassTheme.fromTokens(tokens, transparencyEnabled: transparencyEnabled),
      ],
    );
  }

  /// The theme for a named token set, or the light theme if unknown.
  static ThemeData named(String name, {bool transparencyEnabled = true}) =>
      build(
        NpcTokens.all[name] ?? NpcTokens.light,
        transparencyEnabled: transparencyEnabled,
      );

  /// Whether the platform is asking for reduced transparency or high contrast.
  ///
  /// This is the Flutter-native equivalent of the web's
  /// `prefers-reduced-transparency` / `prefers-contrast` branches, which the
  /// token export deliberately excludes.
  static bool transparencyAllowed(BuildContext context) {
    final MediaQueryData media = MediaQuery.of(context);
    return !media.highContrast && !media.disableAnimations;
  }
}
