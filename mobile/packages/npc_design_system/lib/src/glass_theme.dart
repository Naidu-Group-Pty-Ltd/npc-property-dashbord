import 'package:flutter/material.dart';

import 'tokens.g.dart';

/// The glass material, as a theme extension.
///
/// `src/styles/glass.css` is the web recipe and this mirrors its *policy*, not
/// its mechanism: a surface is a fill plus a stroke plus a sheen, and the blur
/// belongs to the container.
///
/// [maxBlurLayersPerScreen] is a budget, not a decoration. The web audit found
/// blur-per-repeated-element to be the one catastrophic cost, and Flutter's
/// [BackdropFilter] behaves the same way — every live blur is a full-screen
/// readback. Containers blur; list items never do (plan.md R-BOTH-4).
@immutable
class GlassTheme extends ThemeExtension<GlassTheme> {
  const GlassTheme({
    required this.fill,
    required this.stroke,
    required this.sheen,
    required this.blurSigma,
    required this.blurSigmaLarge,
    required this.blurSigmaSmall,
    required this.radius,
    required this.transparencyEnabled,
  });

  /// Builds the material from a generated token set.
  ///
  /// [transparencyEnabled] carries the platform accessibility flag. The web
  /// collapses glass to opaque under `prefers-reduced-transparency`; Flutter
  /// reads `MediaQuery.of(context).disableAnimations` / the platform's reduce
  /// transparency setting and applies the same policy — reimplementing the
  /// media queries would couple this to the wrong platform's mechanism.
  factory GlassTheme.fromTokens(
    NpcTokenSet tokens, {
    required bool transparencyEnabled,
  }) {
    Color color(String name, Color fallback) => tokens.colors[name] ?? fallback;
    double length(String name, double fallback) =>
        tokens.lengths[name] ?? fallback;

    return GlassTheme(
      fill: color('--aurixa-glass-bg', const Color(0x14FFFFFF)),
      stroke: color('--aurixa-glass-border', const Color(0x33FFFFFF)),
      sheen: color('--aurixa-glow', const Color(0x1AFFFFFF)),
      // CSS blur radius is roughly twice the Gaussian sigma Flutter wants.
      blurSigma: length('--glass-blur', 16) / 2,
      blurSigmaLarge: length('--glass-blur-lg', 28) / 2,
      blurSigmaSmall: length('--glass-blur-sm', 8) / 2,
      radius: length('--radius', 12),
      transparencyEnabled: transparencyEnabled,
    );
  }

  final Color fill;
  final Color stroke;
  final Color sheen;
  final double blurSigma;
  final double blurSigmaLarge;
  final double blurSigmaSmall;
  final double radius;
  final bool transparencyEnabled;

  /// The budget every screen is held to. Verified with the performance overlay
  /// on mid-range Android hardware before each release.
  static const int maxBlurLayersPerScreen = 8;

  /// The decoration for a glass container.
  ///
  /// When transparency is disabled the fill is composited over [background] so
  /// the surface stays legible without a blur behind it.
  BoxDecoration decoration({required Color background}) => BoxDecoration(
    color: transparencyEnabled ? fill : Color.alphaBlend(fill, background),
    border: Border.all(color: stroke),
    borderRadius: BorderRadius.circular(radius),
  );

  /// The sigma a container should blur at, or null when it must not blur.
  double? effectiveBlurSigma({bool large = false, bool small = false}) {
    if (!transparencyEnabled) return null;
    if (large) return blurSigmaLarge;
    if (small) return blurSigmaSmall;
    return blurSigma;
  }

  @override
  GlassTheme copyWith({
    Color? fill,
    Color? stroke,
    Color? sheen,
    double? blurSigma,
    double? blurSigmaLarge,
    double? blurSigmaSmall,
    double? radius,
    bool? transparencyEnabled,
  }) => GlassTheme(
    fill: fill ?? this.fill,
    stroke: stroke ?? this.stroke,
    sheen: sheen ?? this.sheen,
    blurSigma: blurSigma ?? this.blurSigma,
    blurSigmaLarge: blurSigmaLarge ?? this.blurSigmaLarge,
    blurSigmaSmall: blurSigmaSmall ?? this.blurSigmaSmall,
    radius: radius ?? this.radius,
    transparencyEnabled: transparencyEnabled ?? this.transparencyEnabled,
  );

  @override
  GlassTheme lerp(covariant GlassTheme? other, double t) {
    if (other == null) return this;
    return GlassTheme(
      fill: Color.lerp(fill, other.fill, t)!,
      stroke: Color.lerp(stroke, other.stroke, t)!,
      sheen: Color.lerp(sheen, other.sheen, t)!,
      blurSigma: _lerp(blurSigma, other.blurSigma, t),
      blurSigmaLarge: _lerp(blurSigmaLarge, other.blurSigmaLarge, t),
      blurSigmaSmall: _lerp(blurSigmaSmall, other.blurSigmaSmall, t),
      radius: _lerp(radius, other.radius, t),
      transparencyEnabled: t < 0.5
          ? transparencyEnabled
          : other.transparencyEnabled,
    );
  }

  static double _lerp(double a, double b, double t) => a + (b - a) * t;
}
