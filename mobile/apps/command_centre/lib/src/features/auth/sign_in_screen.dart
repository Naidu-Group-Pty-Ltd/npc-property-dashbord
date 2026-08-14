import 'package:flutter/material.dart';
import 'package:npc_auth/npc_auth.dart';
import 'package:npc_core/npc_core.dart';
import 'package:npc_tenant/npc_tenant.dart';

import '../shell/app_state.dart';
import '../shell/glass_card.dart';

/// Username and password against the resolved tenant.
///
/// There is no Turnstile here: the Command Centre login does not carry one, so
/// `S-2` does not block this app (only the portals). See
/// `apps/command_centre/plan.md`.
class SignInScreen extends StatefulWidget {
  const SignInScreen({required this.state, this.authOverride, super.key});

  final CommandCentreState state;

  /// Injectable for widget tests, which must not reach the network.
  final NpcStaffAuth? authOverride;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final TextEditingController _username = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  NpcStaffAuth _auth(NpcTenant tenant) =>
      widget.authOverride ??
      NpcStaffAuth(
        functionsBaseUrl: '${tenant.supabaseUrl}/functions/v1',
        anonKey: tenant.anonKey,
        flavor: widget.state.flavor,
      );

  Future<void> _submit() async {
    final NpcTenant? tenant = widget.state.tenant;
    if (tenant == null) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    final NpcResult<NpcSession> result = await _auth(tenant)
        .signIn(username: _username.text.trim(), password: _password.text);
    if (!mounted) return;

    switch (result) {
      case NpcFailure<NpcSession>(:final String message):
        setState(() {
          _busy = false;
          _error = message;
        });
      case NpcSuccess<NpcSession>(:final NpcSession value):
        await widget.state.sessionStore.write(value);
        if (!mounted) return;
        widget.state.adoptSession(value);
    }
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
                  Text('Sign in', style: text.headlineSmall),
                  const SizedBox(height: 4),
                  Text(widget.state.tenant?.slug ?? '', style: text.bodySmall),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _username,
                    autocorrect: false,
                    enableSuggestions: false,
                    decoration: const InputDecoration(
                      labelText: 'Username',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _password,
                    obscureText: true,
                    textInputAction: TextInputAction.go,
                    onSubmitted: (_) => _submit(),
                    decoration: InputDecoration(
                      labelText: 'Password',
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
                        : const Text('Sign in'),
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
