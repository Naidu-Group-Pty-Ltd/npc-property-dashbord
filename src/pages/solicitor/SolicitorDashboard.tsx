import { FileText, Loader2, LogOut, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';

/**
 * Phase 1 landing surface. Matters, critical dates, documents and messaging
 * arrive in Phases 3+; this confirms an authenticated session and firm context.
 */
export default function SolicitorDashboard() {
  const { user, loading, signOut } = useSolicitorPortalAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
              <Scale className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Solicitor Portal</p>
              <p className="text-sm text-muted-foreground">{user?.firm_name || 'Legal practice'}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            <LogOut className="mr-2 h-4 w-4" aria-hidden />
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Welcome back, {user?.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account is active. Matters and settlement tooling are being rolled out next.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" aria-hidden />
              Your matters
            </CardTitle>
            <CardDescription>
              Conveyancing matters assigned to you will appear here once the matters workspace goes live.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
              No matters have been assigned to your account yet. Your NPC contact will notify you when one is shared.
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
