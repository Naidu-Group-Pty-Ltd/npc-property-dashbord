import { useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileCheck2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { advancedClientCreationSchema } from '@/lib/client-fact-find/schema';
import type { AdvancedClientCreationPayload } from '@/lib/client-fact-find/types';
import { AdvancedTabNavigation, type AdvancedTab } from './AdvancedTabNavigation';
import { ClientFactFindTab } from './ClientFactFindTab';
import { ClientFormOutputTab } from './ClientFormOutputTab';
import { createAdvancedDefaults } from './defaults';
import { LivingExpensesTab } from './LivingExpensesTab';
import { WhiteLabelSetupTab } from './WhiteLabelSetupTab';
import type { ClientFactFindSection } from './ClientFactFindSectionNavigation';

const tabForError = (errors: Record<string, unknown>): AdvancedTab => {
  const first = Object.keys(errors)[0];
  if (first === 'branding') return 'branding';
  if (first === 'expenses') return 'expenses';
  return 'fact-find';
};

export function AdvancedClientForm({ onCancel }: { active: boolean; onCancel: () => void }) {
  const methods = useForm<AdvancedClientCreationPayload>({
    resolver: zodResolver(advancedClientCreationSchema) as never,
    defaultValues: createAdvancedDefaults(),
    mode: 'onBlur',
    shouldUnregister: false,
  });
  const [tab, setTab] = useState<AdvancedTab>('branding');
  const [factFindSection,setFactFindSection]=useState<ClientFactFindSection>('applicants');
  const contentRef=useRef<HTMLDivElement>(null);

  const changeFactFindSection=(section:ClientFactFindSection)=>{setFactFindSection(section);if(contentRef.current)contentRef.current.scrollTop=0};

  const reviewOutput = methods.handleSubmit(
    () => setTab('output'),
    errors => {
      const errorRecord=errors as Record<string,unknown>;setTab(tabForError(errorRecord));
      const first=Object.keys(errorRecord)[0];const section:ClientFactFindSection=first==='addresses'?'addresses':first==='employment'?'employment':first==='assets'?'assets':first==='liabilities'?'liabilities':'applicants';
      if(!['branding','expenses'].includes(first))changeFactFindSection(section);
      requestAnimationFrame(() => requestAnimationFrame(()=>document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()));
    },
  );

  return (
    <FormProvider {...methods}>
      <form onSubmit={event => event.preventDefault()} className="flex min-h-0 flex-1 flex-col">
        <Tabs value={tab} onValueChange={value => setTab(value as AdvancedTab)} className="flex min-h-0 flex-1 flex-col">
          <AdvancedTabNavigation />
          <div ref={contentRef} data-testid="advanced-content-scroll" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-muted/10 [scrollbar-gutter:stable]">
          <div className="mx-auto w-full max-w-[1360px] overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <TabsContent value="branding" className="m-0"><WhiteLabelSetupTab /></TabsContent>
            <TabsContent value="fact-find" className="m-0"><ClientFactFindTab section={factFindSection} onSectionChange={changeFactFindSection}/></TabsContent>
            <TabsContent value="expenses" className="m-0"><LivingExpensesTab /></TabsContent>
            <TabsContent value="output" className="m-0"><ClientFormOutputTab /></TabsContent>
          </div></div>
        </Tabs>
        <footer data-testid="advanced-footer" className="z-30 shrink-0 border-t border-brand-300/20 bg-card px-4 py-3 shadow-sm sm:px-6">
          <div className="mx-auto flex max-w-[1360px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">Advanced client saving will be connected separately.</p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <Button type="button" variant="outline" className="rounded-xl" onClick={onCancel}>Cancel</Button>
              <Button type="button" className="rounded-xl bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 font-bold text-primary-foreground shadow-lg shadow-brand-500/20" onClick={reviewOutput}><FileCheck2 className="mr-2 h-4 w-4" />Review Output</Button>
            </div>
          </div>
        </footer>
      </form>
    </FormProvider>
  );
}
