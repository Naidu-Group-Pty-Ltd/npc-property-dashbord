import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Boxes, Eye, EyeOff, FileText, HardHat, Loader2, ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { BrandLockup, BrandLogo } from '@/components/branding/BrandAssets';
import { useBrand } from '@/branding/useTokens';
import { useBuilderPortalAuth } from '@/hooks/useBuilderPortalAuth';

/**
 * Builder / Developer Portal sign-in.
 *
 * A split composition matching the quality of `SolicitorLogin` — branded panel
 * on the left from `lg` up, form on the right — but with Builder's own identity
 * and copy. The reset journey stays on its own routes
 * (`/builder/forgot-password`, `/builder/reset-password`) rather than being
 * mode-switched inside this component, which is why the link below is a `Link`
 * and not a mode toggle.
 *
 * The chrome is the only thing that changed here: the same `signIn` call, the
 * same guard, the same validation, the same Turnstile handlers, the same
 * inline-alert error handling and the same redirect. Nothing about the session
 * is stored in the browser: the server sets an HttpOnly cookie and the provider
 * re-reads the session from it.
 *
 * `BuilderAuthShell` is deliberately not used and not changed — five other
 * unauthenticated Builder pages depend on it, and this layout is specific to
 * the sign-in surface.
 */
const FEATURES = [
  {
    icon: HardHat,
    title: 'Projects and delivery',
    desc: 'Developments, stages and construction programmes tracked in one place.',
  },
  {
    icon: Boxes,
    title: 'Inventory and transactions',
    desc: 'Lot and unit availability beside the sales moving against them.',
  },
  {
    icon: FileText,
    title: 'Documents, messages and tasks',
    desc: 'Plans, certificates and conversations against the records you can reach.',
  },
];

export default function BuilderLogin() {
  const { user, loading, signIn } = useBuilderPortalAuth();
  const { settings } = useBrand();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

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

  const companyName = settings.companyName || 'Builder / Developer Portal';

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── Left branded panel (from lg up) ── */}
      <aside
        className="relative hidden shrink-0 overflow-hidden border-r border-border bg-card lg:flex lg:w-[480px] lg:flex-col xl:w-[540px]"
        aria-hidden="true"
      >
        <div className="builder-auth-aurora pointer-events-none absolute inset-0 opacity-70" />
        <div className="pointer-events-none absolute right-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-primary/30 to-transparent" />

        <div className="relative flex min-h-0 flex-1 flex-col justify-between gap-10 p-10 xl:p-12">
          <BrandLockup
            slot="auth"
            meta="Builder / Developer Portal"
            logoClassName="h-12 max-w-[220px] object-contain"
            fallbackClassName="h-11 w-11 border border-primary/25"
            companyClassName="text-lg font-bold tracking-tight truncate"
            metaClassName="tracking-[0.2em]"
          />

          <div className="space-y-8">
            <div>
              <h2 className="text-3xl font-bold leading-tight tracking-tight text-foreground">
                Deliver every project<br />
                with <span className="text-primary">control</span>.
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Your secure workspace for projects, inventory, transactions, construction
                programmes and the documents that go with them.
              </p>
            </div>

            <ul className="space-y-4">
              {FEATURES.map((feature, index) => (
                <motion.li
                  key={feature.title}
                  className="flex items-start gap-3"
                  initial={reduceMotion ? false : { opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.4, delay: reduceMotion ? 0 : 0.3 + index * 0.12 }}
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                    <feature.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{feature.title}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">
                      {feature.desc}
                    </span>
                  </span>
                </motion.li>
              ))}
            </ul>
          </div>

          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
            <ShieldCheck className="h-3 w-3 shrink-0" />
            <span>Secured portal · Access resolved per request · Audit logged</span>
          </p>
        </div>
      </aside>

      {/* ── Right form panel ── */}
      <main
        className="flex min-w-0 flex-1 items-center justify-center p-6 md:p-10"
        aria-label="Builder / Developer Portal sign in"
      >
        <motion.div
          className="w-full max-w-[25rem]"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.4 }}
        >
          {/* The branded panel is hidden below lg, so the identity moves inline. */}
          <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
            <BrandLogo
              slot="auth"
              alt={companyName}
              className="h-14 max-w-[220px] object-contain"
              fallbackClassName="h-14 w-14 rounded-2xl border border-primary/25"
            />
            <div className="text-center">
              <p className="text-lg font-bold tracking-tight text-foreground">{companyName}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Builder / Developer Portal
              </p>
            </div>
          </div>

          <div className="mb-6">
            <h1 id="builder-login-heading" className="text-2xl font-bold tracking-tight text-foreground">
              Welcome back
            </h1>
            <p id="builder-login-description" className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Sign in to your builder or developer workspace.
            </p>
          </div>

          {/* The form sits on its own surface, matching `BuilderAuthShell`, so
              it stays anchored on a wide canvas instead of floating. */}
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl border border-border/60 bg-card/70 p-6 shadow-xl backdrop-blur-sm sm:p-7"
            aria-labelledby="builder-login-heading"
            aria-describedby="builder-login-description"
          >
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="builder-email" className="text-xs font-medium">Email</Label>
              <Input
                id="builder-email"
                type="email"
                autoComplete="email"
                required
                aria-required="true"
                className="h-11"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@yourcompany.com.au"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="builder-password" className="text-xs font-medium">Password</Label>
              <div className="relative">
                <Input
                  id="builder-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  aria-required="true"
                  className="h-11 pr-10"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

            <Button
              type="submit"
              className="h-11 w-full gap-2 font-semibold"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Sign in
            </Button>

            <div className="text-center">
              <Link
                to="/builder/forgot-password"
                className="rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Forgot your password?
              </Link>
            </div>
          </form>

          <p className="mt-8 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/50 lg:hidden">
            <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
            <span>Secured portal · Access resolved per request</span>
          </p>
        </motion.div>
      </main>
    </div>
  );
}
