/**
 * Finance Partner Portal — the agreement inbox.
 *
 * "Requires Your Attention" (issued for review / awaiting signature) leads;
 * everything else is history. Clearly visible without being intrusive — new
 * agreements arrive here plus a bell notification, nothing modal.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, FileSignature, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';

export interface PartnerAgreementSummary {
  id: string;
  title: string;
  template_key: string;
  status: string;
  principal_legal_name: string | null;
  principal_trading_name: string | null;
  issued_at: string | null;
  accepted_at: string | null;
  executed_at: string | null;
  withdrawn_at: string | null;
  effective_date: string | null;
}

export const PARTNER_STATUS_LABELS: Record<string, string> = {
  partner_review: 'Review Required',
  changes_requested: 'Changes Requested',
  sent_for_signature: 'Signature Required',
  partially_signed: 'Awaiting Counter-Signature',
  active: 'Fully Executed',
  withdrawn: 'Withdrawn',
  terminated: 'Terminated',
  superseded: 'Superseded',
};

export function partnerStatusBadge(status: string): string {
  switch (status) {
    case 'partner_review':
    case 'sent_for_signature':
      return 'bg-warning/15 text-warning border-warning/30';
    case 'partially_signed':
      return 'bg-primary/15 text-primary border-primary/30';
    case 'active':
      return 'bg-success/15 text-success border-success/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

const ATTENTION_STATUSES = new Set(['partner_review', 'sent_for_signature', 'changes_requested']);

export default function FinancePortalAgreements() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['finance-portal-agreements'],
    queryFn: async () => {
      const { data: payload, error } = await invokeFinanceFunction('finance-portal-agreements', { operation: 'list' });
      if (error) throw new Error(error.message ?? 'Failed to load agreements');
      return payload as { agreements: PartnerAgreementSummary[] };
    },
  });

  useEffect(() => {
    document.title = 'Agreements | Finance Portal';
  }, []);

  const agreements = data?.agreements ?? [];
  const attention = agreements.filter((agreement) => ATTENTION_STATUSES.has(agreement.status));
  const history = agreements.filter((agreement) => !ATTENTION_STATUSES.has(agreement.status));

  const issuerName = (agreement: PartnerAgreementSummary) =>
    agreement.principal_trading_name || agreement.principal_legal_name || 'Issuing organisation';

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <FileSignature className="h-6 w-6 text-primary" /> Agreements
          </h1>
          <p className="text-sm text-muted-foreground">
            Review, accept and execute agreements issued to your organisation.
          </p>
        </div>
        <Button variant="outline" size="icon" aria-label="Refresh"
          onClick={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }}>
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
        </Button>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : agreements.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <FileSignature className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium text-foreground">No agreements yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              When an agreement is issued to your organisation it will appear here for secure review
              and execution.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {attention.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Requires Your Attention
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {attention.map((agreement) => (
                  <Card key={agreement.id} className="border-primary/30">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-serif text-base font-semibold leading-snug text-foreground">
                            {agreement.title}
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Issued by: {issuerName(agreement)}
                            {agreement.issued_at ? ` · ${format(new Date(agreement.issued_at), 'd MMM yyyy')}` : ''}
                          </p>
                        </div>
                        <Badge variant="outline" className={partnerStatusBadge(agreement.status)}>
                          {PARTNER_STATUS_LABELS[agreement.status] ?? agreement.status}
                        </Badge>
                      </div>
                      <Button asChild size="sm" className="mt-3 w-full sm:w-auto">
                        <Link to={`/finance/agreements/${agreement.id}`}>
                          {agreement.status === 'sent_for_signature' ? 'Complete Signature' : 'Review Agreement'}
                          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}

          {history.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Agreement History
              </h2>
              <Card>
                <CardContent className="divide-y divide-border/60 p-0">
                  {history.map((agreement) => (
                    <Link
                      key={agreement.id}
                      to={`/finance/agreements/${agreement.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/10"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{agreement.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {issuerName(agreement)}
                          {agreement.executed_at
                            ? ` · executed ${format(new Date(agreement.executed_at), 'd MMM yyyy')}`
                            : agreement.issued_at
                              ? ` · issued ${format(new Date(agreement.issued_at), 'd MMM yyyy')}`
                              : ''}
                        </div>
                      </div>
                      <Badge variant="outline" className={partnerStatusBadge(agreement.status)}>
                        {PARTNER_STATUS_LABELS[agreement.status] ?? agreement.status}
                      </Badge>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
