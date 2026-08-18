import 'package:flutter/material.dart';

/// A tenant's brand, as `whitelabel_settings` stores it.
///
/// The web reads the same row in `src/branding/BrandProvider.tsx` and cascades
/// it into CSS variables; this does the same job onto [ThemeData]. Because both
/// clients read one row, a brand change made in Command Centre reaches web and
/// mobile alike — which is the whole point of not hardcoding an NPC palette
/// into Dart (ARCHITECTURE.md A11).
@immutable
class NpcBrandConfig {
  const NpcBrandConfig({
    this.primaryColor,
    this.accentColor,
    this.brandColor,
    this.darkModeDefault = ThemeMode.system,
    this.logoAuth,
    this.logoSidebar,
  });

  /// Reads the `theme_config` / `logo_config` JSONB columns.
  ///
  /// Every field is optional and an unparseable colour is ignored rather than
  /// substituted. A tenant that has set nothing gets the design system exactly
  /// as shipped, which is the correct default — guessing a brand is worse than
  /// having none.
  factory NpcBrandConfig.fromSettings({
    Map<String, Object?>? themeConfig,
    Map<String, Object?>? logoConfig,
  }) {
    final Map<String, Object?> theme = themeConfig ?? const <String, Object?>{};
    final Map<String, Object?> logo = logoConfig ?? const <String, Object?>{};
    return NpcBrandConfig(
      primaryColor: parseHslToken(theme['primaryColor']),
      accentColor: parseHslToken(theme['accentColor']),
      brandColor: parseHslToken(theme['brandColor']),
      darkModeDefault: _mode(theme['darkModeDefault']),
      logoAuth: logo['auth'] as String?,
      logoSidebar: logo['sidebar'] as String?,
    );
  }

  final Color? primaryColor;
  final Color? accentColor;
  final Color? brandColor;
  final ThemeMode darkModeDefault;
  final String? logoAuth;
  final String? logoSidebar;

  bool get isEmpty =>
      primaryColor == null && accentColor == null && brandColor == null;

  /// Applies this brand over [base].
  ///
  /// Only the roles the tenant actually set are replaced; everything else keeps
  /// the design system's value, so a partial brand cannot produce an
  /// unreadable screen.
  ThemeData apply(ThemeData base) {
    if (isEmpty) return base;
    final ColorScheme scheme = base.colorScheme.copyWith(
      primary: primaryColor,
      secondary: accentColor,
    );
    return base.copyWith(colorScheme: scheme);
  }

  /// Parses the `H S% L%` triplet form the platform stores, or a `#rrggbb`.
  ///
  /// Returns null on anything else — see the constructor's note on why an
  /// unparseable colour is dropped rather than guessed.
  static Color? parseHslToken(Object? value) {
    if (value is! String || value.trim().isEmpty) return null;
    final String raw = value.trim();

    final RegExpMatch? hex = RegExp(r'^#?([0-9a-fA-F]{6})$').firstMatch(raw);
    if (hex != null) {
      return Color(0xFF000000 | int.parse(hex.group(1)!, radix: 16));
    }

    final RegExpMatch? hsl = RegExp(r'^(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%$')
        .firstMatch(raw);
    if (hsl == null) return null;
    return HSLColor.fromAHSL(
      1,
      double.parse(hsl.group(1)!) % 360,
      (double.parse(hsl.group(2)!) / 100).clamp(0.0, 1.0),
      (double.parse(hsl.group(3)!) / 100).clamp(0.0, 1.0),
    ).toColor();
  }

  static ThemeMode _mode(Object? value) => switch (value) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };
}
