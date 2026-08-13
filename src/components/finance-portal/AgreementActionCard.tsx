/**
 * The agreements waiting on this partner, on the first screen they see.
 *
 * The Finance Portal dashboard did not mention agreements at all. A partner who
 * had just been sent one signed in, landed here, and saw settlement runways and
 * document expiry — nothing about the document somebody was waiting on them to
 * execute. The only signal was a number on the bell, and for three weeks even
 * that was broken (`docs/agreements/SENDING.md`).
 *
 * A bell badge is a notification about a notification. This is the thing
 * itself, with the action attached, and it disappears the moment there is
 * nothing to do — which is what stops it becoming furniture people stop seeing.
 *
 * What counts as "waiting on them" is `partnerAgreementAction().awaitingPartner`
 * from the shared lifecycle module, not a status list rewritten here. It is
 * deliberately false for `changes_requested`: the partner asked us a question,
 * and putting an ACTION REQUIRED banner in front of somebody who is waiting on
 * *us* is worse than saying nothing.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, FileSignature, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { partnerAgreementAction, type AgreementStatus } from '@/lib/agreements';

interface PortalAgreement {
  id: string;
  title?: string | null;
  status: AgreementStatus;
  partner_legal_name?: string | null;
  issued_at?: string | null;
}

export function AgreementActionCard() {
  const { user, invokeFinanceFunction } = useFinancePortalAuth();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['finance-portal-agreements', 'awaiting', user?.id],
    enabled: !!user,
    // The same endpoint the agreements page uses; no new surface, and the
    // cache is shared with it.
    queryFn: async () => {
      const { data: result, error } = await invokeFinanceFunction('finance-portal-agreements', {
        operation: 'list',
      });
      if (error) throw new Error(error.message);
      return (result?.agreements ?? []) as PortalAgreement[];
    },
    refetchInterval: 120000,
  });

  const waiting = (data ?? []).filter(
    (agreement) => partnerAgreementAction(agreement.status).awaitingPartner,
  );

  // Nothing to do is the common case and deserves no pixels at all.
  if (isLoading || waiting.length === 0) return null;

  const first = waiting[0];
  const action = partnerAgreementAction(first.status);

  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
              <FileSignature className="h-4 w-4 text-primary" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {waiting.length === 1
                  ? (first.title || 'An agreement') + ' needs your attention'
                  : `${waiting.length} agreements need your attention`}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {waiting.length === 1
                  ? action.detail
                  : 'Review, request changes or execute them in the Agreements section.'}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => navigate(waiting.length === 1
              ? `/finance/agreements/${first.id}`
              : '/finance/agreements')}
          >
            {waiting.length === 1 ? action.label : 'View agreements'}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default AgreementActionCard;
