import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SolicitorAuthShell } from '@/components/solicitor-portal/SolicitorAuthShell';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';

export default function SolicitorLogin() {
  const { user, loading, signIn } = useSolicitorPortalAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate to={user.must_change_password ? '/solicitor/change-password' : '/solicitor'} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signIn(email, password);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    navigate('/solicitor', { replace: true });
  };

  return (
    <SolicitorAuthShell
      title="Sign in"
      description="Access your conveyancing matters, critical dates and secure messaging."
      footer={
        <Link to="/solicitor/forgot-password" className="text-primary underline-offset-4 hover:underline">
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
          <Label htmlFor="solicitor-email">Email address</Label>
          <Input
            id="solicitor-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@lawfirm.com.au"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="solicitor-password">Password</Label>
          <div className="relative">
            <Input
              id="solicitor-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Sign in
        </Button>
      </form>
    </SolicitorAuthShell>
  );
}
