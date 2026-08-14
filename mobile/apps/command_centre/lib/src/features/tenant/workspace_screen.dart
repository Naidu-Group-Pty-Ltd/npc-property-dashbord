import 'package:flutter/material.dart';
import 'package:npc_core/npc_core.dart';
import 'package:npc_tenant/npc_tenant.dart';

import '../shell/app_state.dart';
import '../shell/glass_card.dart';

/// Asks which NPC workspace this installation belongs to.
///
/// This screen exists because the platform provisions one backend per tenant
/// (ARCHITECTURE.md A6). It is the first thing a user sees, so it must work
/// offline enough to explain itself — a network failure here shows a message,
/// never a blank screen (plan.md R-BOTH-1).
class WorkspaceScreen extends StatefulWidget {
  const WorkspaceScreen({required this.state, super.key});

  final CommandCentreState state;

  @override
  State<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

class _WorkspaceScreenState extends State<WorkspaceScreen> {
  final TextEditingController _controller = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final NpcResult<NpcTenant> result = await widget.state.resolveTenant(
      _controller.text,
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = switch (result) {
        NpcFailure<NpcTenant>(:final String message) => message,
        NpcSuccess<NpcTenant>() => null,
      };
    });
  }

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: GlassCard(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text('NPC Command Centre', style: text.headlineSmall),
                  const SizedBox(height: 8),
                  Text(
                    'Enter your workspace name to continue.',
                    style: text.bodyMedium,
                  ),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _controller,
                    autocorrect: false,
                    enableSuggestions: false,
                    textInputAction: TextInputAction.go,
                    onSubmitted: (_) => _submit(),
                    decoration: InputDecoration(
                      labelText: 'Workspace',
                      hintText: 'e.g. npc',
                      errorText: _error,
                      border: const OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator.adaptive(
                              strokeWidth: 2,
                            ),
                          )
                        : const Text('Continue'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
