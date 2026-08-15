import 'package:flutter/material.dart';
import 'package:npc_core/npc_core.dart';

import '../../portal_session.dart';
import '../portal_app_state.dart';
import 'glass_card.dart';

/// Email and password against the resolved tenant.
///
/// Shared by all five apps. Turnstile is the one thing this screen cannot do
/// natively: three of the four portal logins verify a `turnstile_token`
/// server-side, and a browser widget has no native equivalent — that is `S-2`,
/// and until it lands those logins will answer "Security verification
/// required". The message is shown as the server writes it rather than being
/// swallowed, so the cause is visible in testing.
class SignInScreen extends StatefulWidget {
  const SignInScreen({required this.state, super.key});

  final PortalAppState state;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final NpcPortalAuth? auth = widget.state.auth;
    if (auth == null) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    final NpcResult<String> result = await auth.signIn(
      email: _email.text.trim(),
      password: _password.text,
    );
    if (!mounted) return;

    switch (result) {
      case NpcFailure<String>(:final String message):
        setState(() {
          _busy = false;
          _error = message;
        });
      case NpcSuccess<String>(:final String value):
        await widget.state.adoptSession(value);
    }
  }

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return GlassPage(
      children: <Widget>[
        Text('Sign in', style: text.headlineSmall),
        const SizedBox(height: 4),
        Text(widget.state.tenant?.slug ?? '', style: text.bodySmall),
        const SizedBox(height: 24),
        TextField(
          controller: _email,
          autocorrect: false,
          enableSuggestions: false,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(
            labelText: 'Email',
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
                  child: CircularProgressIndicator.adaptive(strokeWidth: 2),
                )
              : const Text('Sign in'),
        ),
      ],
    );
  }
}
