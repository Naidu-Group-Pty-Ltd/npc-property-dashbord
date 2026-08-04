import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import { RESPONSIBILITY_NOTICE } from "./types";

/**
 * The persistent statutory responsibility notice. Every portal renders the
 * SAME fixed wording (from the shared domain module); an adapter may add a
 * portal-specific introduction above it but can never replace or soften it.
 * Nothing here ever claims the partner has been "made compliant".
 */
export function ResponsibilityNotice({ intro }: { intro?: string }) {
  return (
    <Alert data-testid="partner-responsibility-notice">
      <ShieldAlert className="h-4 w-4" aria-hidden="true" />
      <AlertTitle className="text-sm">Your organisation remains responsible</AlertTitle>
      <AlertDescription className="text-xs space-y-1.5">
        {intro && <p>{intro}</p>}
        <p>{RESPONSIBILITY_NOTICE}</p>
      </AlertDescription>
    </Alert>
  );
}
