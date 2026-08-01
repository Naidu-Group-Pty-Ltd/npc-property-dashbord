import { useState } from 'react';
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

  const reviewOutput = methods.handleSubmit(
    () => setTab('output'),
    errors => {
      setTab(tabForError(errors as Record<string, unknown>));
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    },
  );

  return (
    <FormProvider {...methods}>
      <form onSubmit={event => event.preventDefault()} className="flex min-h-0 flex-1 flex-col">
        <Tabs value={tab} onValueChange={value => setTab(value as AdvancedTab)} className="flex min-h-0 flex-1 flex-col">
          <AdvancedTabNavigation />
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6">
            <TabsContent value="branding" className="m-0"><WhiteLabelSetupTab /></TabsContent>
            <TabsContent value="fact-find" className="m-0"><ClientFactFindTab /></TabsContent>
            <TabsContent value="expenses" className="m-0"><LivingExpensesTab /></TabsContent>
            <TabsContent value="output" className="m-0"><ClientFormOutputTab /></TabsContent>
          </div>
        </Tabs>
        <footer className="sticky bottom-0 z-30 shrink-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">Advanced client saving will be connected separately.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
              <Button type="button" onClick={reviewOutput}><FileCheck2 className="mr-2 h-4 w-4" />Review Output</Button>
            </div>
          </div>
        </footer>
      </form>
    </FormProvider>
  );
}
