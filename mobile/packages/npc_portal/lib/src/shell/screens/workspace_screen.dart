import 'package:flutter/material.dart';
import 'package:npc_core/npc_core.dart';
import 'package:npc_tenant/npc_tenant.dart';

import '../portal_app_state.dart';
import 'glass_card.dart';

/// Asks which NPC workspace this installation belongs to.
///
/// Every app starts here because the platform provisions one backend per
/// tenant (`ARCHITECTURE.md` A6) — there is nothing to sign in to until a
/// tenant is resolved. A network failure shows a message, never a blank screen
/// (`plan.md` R-BOTH-1).
class WorkspaceScreen extends StatefulWidget {
  const WorkspaceScreen({required this.state, super.key});

  final PortalAppState state;

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
    return GlassPage(
      children: <Widget>[
        Text(widget.state.descriptor.displayName, style: text.headlineSmall),
        const SizedBox(height: 8),
        Text('Enter your workspace name to continue.', style: text.bodyMedium),
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
                  child: CircularProgressIndicator.adaptive(strokeWidth: 2),
                )
              : const Text('Continue'),
        ),
      ],
    );
  }
}
