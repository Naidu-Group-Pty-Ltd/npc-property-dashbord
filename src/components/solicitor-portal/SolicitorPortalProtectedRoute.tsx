import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';

export function SolicitorPortalProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useSolicitorPortalAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm">Loading Solicitor Portal...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/solicitor/login" replace />;
  }

  // Temp-password users must rotate their password before anything else.
  if (user.must_change_password && location.pathname !== '/solicitor/change-password') {
    return <Navigate to="/solicitor/change-password" replace />;
  }

  return <>{children}</>;
}
