import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Loader2 } from 'lucide-react';

interface FinancePortalProtectedRouteProps {
  children: ReactNode;
}

export function FinancePortalProtectedRoute({ children }: FinancePortalProtectedRouteProps) {
  const { user, loading } = useFinancePortalAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm">Loading Finance Portal...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/finance/login" replace />;
  }

  // Force temp-password users to change password before accessing the portal
  if (user.must_change_password && location.pathname !== '/finance/change-password') {
    return <Navigate to="/finance/change-password" replace />;
  }

  return <>{children}</>;
}
