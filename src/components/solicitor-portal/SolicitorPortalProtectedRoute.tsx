import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';

export function SolicitorPortalProtectedRoute() {
  const { user, loading } = useSolicitorPortalAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
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
  if (user.must_change_password) {
    return location.pathname === '/solicitor/change-password'
      ? <Outlet />
      : <Navigate to="/solicitor/change-password" replace />;
  }
  if (!user.has_accepted_current_terms) {
    return location.pathname === '/solicitor/terms'
      ? <Outlet />
      : <Navigate to="/solicitor/terms" replace />;
  }
  if (!user.has_completed_mandatory_onboarding) {
    return location.pathname === '/solicitor/onboarding'
      ? <Outlet />
      : <Navigate to="/solicitor/onboarding" replace />;
  }

  return <Outlet />;
}
