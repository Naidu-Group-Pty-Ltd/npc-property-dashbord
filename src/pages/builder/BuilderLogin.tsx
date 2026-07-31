import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { BuilderAuthShell } from '@/components/builder-portal/BuilderAuthShell';
import { useBuilderPortalAuth } from '@/hooks/useBuilderPortalAuth';

/**
 * Builder / Developer Portal sign-in.
 *
 * Mirrors `SolicitorLogin`, with the reset journey moved onto its own routes
 * (`/builder/forgot-password`, `/builder/reset-password`) rather than being
 * mode-switched inside this component. Nothing about the session is stored in
 * the browser: the server sets an HttpOnly cookie and the provider re-reads the
 * session from it.
 */
export default function BuilderLogin() {
  const { user, loading, signIn } = useBuilderPortalAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        role="status"
        aria-label="Checking your session"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <span className="sr-only">Checking your session</span>
      </div>
    );
  }

  // An already-authenticated visitor is handed back to the gate, which decides
  // whether they owe a password rotation, terms or onboarding.
  if (user) return <Navigate to="/builder" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email || !password) {
      setError('Enter your email address and password.');
      return;
    }

    setSubmitting(true);
    const result = await signIn(email, password, turnstileToken || undefined);
    setSubmitting(false);

    if (result.error) {
      // The server returns one generic string for every credential failure, so
      // this surface cannot be used to discover which accounts exist.
      setError(result.error);
      setTurnstileToken(null);
      return;
    }
    navigate('/builder', { replace: true });
  };

  return (
    <BuilderAuthShell
      title="Sign in"
      description="Access your builder or developer workspace."
      footer={
        <Link to="/builder/forgot-password" className="text-primary underline-offset-4 hover:underline">
          Forgot your password?
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="builder-email">Email</Label>
          <Input
            id="builder-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@yourcompany.com.au"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="builder-password">Password</Label>
          <div className="relative">
            <Input
              id="builder-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              className="pr-10"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        </div>

        <TurnstileWidget
          onVerify={(token) => setTurnstileToken(token)}
          onExpire={() => setTurnstileToken(null)}
          onError={() => setTurnstileToken(null)}
        />

        <Button type="submit" className="w-full" disabled={submitting} aria-busy={submitting}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          Sign in
        </Button>
      </form>
    </BuilderAuthShell>
  );
}
