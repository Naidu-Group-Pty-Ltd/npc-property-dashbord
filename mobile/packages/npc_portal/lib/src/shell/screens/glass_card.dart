import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:npc_design_system/npc_design_system.dart';

/// A glass container.
///
/// One rule: **containers blur, list items never do** (`plan.md` R-BOTH-4).
/// Flutter's [BackdropFilter] costs a full-screen readback per live layer,
/// exactly as the web audit measured for `backdrop-filter`.
class GlassCard extends StatelessWidget {
  const GlassCard({required this.child, this.padding, super.key});

  final Widget child;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final GlassTheme glass =
        theme.extension<GlassTheme>() ??
        GlassTheme.fromTokens(NpcTokens.light, transparencyEnabled: false);
    final double? sigma = glass.effectiveBlurSigma();

    final Widget surface = Container(
      constraints: const BoxConstraints(maxWidth: 440),
      padding: padding ?? const EdgeInsets.all(24),
      decoration: glass.decoration(background: theme.scaffoldBackgroundColor),
      child: child,
    );

    if (sigma == null) return surface;
    return ClipRRect(
      borderRadius: BorderRadius.circular(glass.radius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: sigma, sigmaY: sigma),
        child: surface,
      ),
    );
  }
}

/// Centres a [GlassCard] on a scrollable, safe-area page.
class GlassPage extends StatelessWidget {
  const GlassPage({required this.children, super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: GlassCard(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: children,
            ),
          ),
        ),
      ),
    ),
  );
}
