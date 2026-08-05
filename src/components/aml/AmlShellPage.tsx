import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, Sparkles, type LucideIcon } from "lucide-react";
import { ReactNode } from "react";
import { AmlEmptyState, AmlPageHeader } from "@/components/aml/primitives";

interface AmlShellPageProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  phaseLabel?: string;
  children?: ReactNode;
}

/**
 * Shared shell for every Phase-2 AML surface. Renders the standard page
 * header and, while a surface has no real content, a "coming online in
 * phase N" note plus a placeholder card so the routing and role gating can
 * be exercised end-to-end without live data. Once a page supplies children,
 * the phase notice is wrong by definition, so it is not rendered.
 */
export function AmlShellPage({
  title,
  description,
  icon: Icon = Sparkles,
  phaseLabel = "Data wires in a later phase",
  children,
}: AmlShellPageProps) {
  return (
    <div className="space-y-6">
      <AmlPageHeader title={title} description={description} icon={Icon} />

      {children ?? (
        <>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>{phaseLabel}</AlertTitle>
            <AlertDescription>
              The route, permissions, and audit chain for this surface are live. The functional data
              layer ships in a later phase of the AML/CTF plan.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">Placeholder workspace</CardTitle>
            </CardHeader>
            <CardContent>
              <AmlEmptyState body="No records to display yet. Use the sidebar or sub-navigation to explore other AML surfaces." />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
