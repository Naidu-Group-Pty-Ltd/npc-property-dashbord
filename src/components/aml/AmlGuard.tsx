import { useState, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert, Loader2 } from "lucide-react";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { hasAmlCapability, AML_STEP_UP_CAPABILITIES, type AmlCapability } from "@/lib/aml/permissions";
import { getStepUpToken, setStepUpToken } from "@/lib/aml/stepUpTokenStore";
import { StepUpAuthDialog } from "./StepUpAuthDialog";

interface AmlGuardProps {
  capability?: AmlCapability;
  children: React.ReactNode;
}

/**
 * Phase 2 guard for every AML surface.
 *
 * - Confirms the `aml_ctf` feature flag is enabled for the tenant.
 * - Confirms the user has at least one AML role.
 * - Confirms the user has the requested capability.
 * - Requires a step-up placeholder confirmation for AUSTRAC + configuration routes.
 */
export function AmlGuard({ capability = "aml.view", children }: AmlGuardProps) {
  const { loading, flagEnabled, roles, hasAnyRole } = useAmlAccess();
  const location = useLocation();
  const requiresStepUp = AML_STEP_UP_CAPABILITIES.includes(capability);
  const stepUpKey = `aml_step_up_session:${capability}`;

  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpOk, setStepUpOk] = useState<boolean>(() => {
    if (!requiresStepUp) return true;
    return getStepUpToken(capability) !== null;
  });

  useEffect(() => {
    if (requiresStepUp && !stepUpOk && hasAnyRole && flagEnabled) {
      setStepUpOpen(true);
    }
  }, [requiresStepUp, stepUpOk, hasAnyRole, flagEnabled, location.pathname]);


  if (loading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!flagEnabled) {
    return (
      <div className="p-6">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>AML/CTF module is not enabled</AlertTitle>
          <AlertDescription>
            Ask a superadmin to enable the <code>aml_ctf</code> feature flag for this tenant.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!hasAnyRole) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>No AML role assigned</AlertTitle>
          <AlertDescription>
            You need an assigned AML role (analyst, reviewer, MLRO, or auditor) to access this
            surface. Contact your MLRO.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!hasAmlCapability(roles, capability)) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Insufficient AML permissions</AlertTitle>
          <AlertDescription>
            Your role does not include <code>{capability}</code>. This capability is restricted to
            {capability === "aml.report" || capability === "aml.configure"
              ? " the MLRO."
              : " analyst / reviewer / MLRO roles."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (requiresStepUp && !stepUpOk) {
    return (
      <>
        <div className="p-6">
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Awaiting step-up confirmation</AlertTitle>
            <AlertDescription>
              This surface is restricted. Confirm the step-up prompt to continue.
            </AlertDescription>
          </Alert>
        </div>
        <StepUpAuthDialog
          open={stepUpOpen}
          capability={capability}
          onCancel={() => {
            setStepUpOpen(false);
          }}
          onConfirm={(payload) => {
            setStepUpToken(capability, payload);
            try {
              sessionStorage.setItem(stepUpKey, JSON.stringify({ expires_at: payload.expires_at }));
            } catch { /* ignore */ }
            setStepUpOk(true);
            setStepUpOpen(false);
          }}
        />

      </>
    );
  }

  return <>{children}</>;
}

// Small convenience: bounce unknown /admin/aml paths to the overview.
export function AmlNotFoundRedirect() {
  return <Navigate to="/admin/aml" replace />;
}
