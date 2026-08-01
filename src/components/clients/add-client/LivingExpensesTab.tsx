import { useFormContext, useWatch } from 'react-hook-form';
import { WalletCards } from 'lucide-react';
import type { AdvancedClientCreationPayload } from '@/lib/client-fact-find/types';
import { calculateFactFindTotals, centsToDisplay } from '@/lib/client-fact-find/calculations';
import { LIVING_EXPENSE_ITEMS } from '@/lib/client-fact-find/fieldDefinitions';

export function LivingExpensesTab() {
  const { register, control, getValues } = useFormContext<AdvancedClientCreationPayload>();
  useWatch({ control, name: 'expenses' });
  const total = calculateFactFindTotals(getValues()).totalMonthlyLivingExpensesCents;

  return <div className="space-y-4" data-testid="advanced-expenses-tab">
    <header className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-300/30 bg-brand-300/15 text-brand-200"><WalletCards className="h-5 w-5" aria-hidden="true" /></span>
        <div><h2 className="font-semibold">Monthly Living Expenses</h2><p className="text-sm text-muted-foreground">One monthly worksheet list with 50 editable expense items.</p></div>
      </div>
      <div aria-live="polite" className="rounded-xl border border-brand-300/30 bg-brand-300/10 px-4 py-2.5 sm:min-w-56 sm:text-right">
        <p className="text-xs font-medium text-muted-foreground">Total Monthly Living Expenses</p>
        <strong className="text-xl">{centsToDisplay(total)}</strong>
      </div>
    </header>

    <section data-testid="expense-continuous-list" aria-label="Living expenses worksheet" className="w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div data-testid="expense-list-header" className="hidden grid-cols-[minmax(0,20fr)_minmax(0,35fr)_minmax(8rem,15fr)_minmax(0,30fr)] border-b border-border bg-muted px-4 py-3 text-xs font-bold uppercase tracking-wide text-foreground md:grid">
        <span>Category</span><span>Expense Item</span><span>Monthly Amount</span><span>Notes</span>
      </div>
      <div className="divide-y divide-border">
        {LIVING_EXPENSE_ITEMS.map((item, index) => {
          const startsCategory = index === 0 || LIVING_EXPENSE_ITEMS[index - 1].category !== item.category;
          return <div
            data-testid="expense-row"
            data-category-start={startsCategory || undefined}
            className="grid min-w-0 grid-cols-1 gap-3 px-4 py-3 odd:bg-muted/15 hover:bg-brand-300/5 md:grid-cols-[minmax(0,20fr)_minmax(0,35fr)_minmax(8rem,15fr)_minmax(0,30fr)] md:items-center md:gap-0"
            key={item.key}
          >
            <div className="min-w-0 md:pr-4">
              <span className="text-xs font-semibold text-muted-foreground md:hidden">Category</span>
              <p className={`break-words text-sm ${startsCategory ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{item.category}</p>
            </div>
            <div className="min-w-0 md:pr-4">
              <span className="text-xs font-semibold text-muted-foreground md:hidden">Expense Item</span>
              <p className="break-words text-sm font-medium text-foreground">{item.itemLabel}</p>
            </div>
            <label className="block min-w-0 text-xs font-semibold text-muted-foreground md:pr-3">
              <span className="md:sr-only">Monthly Amount</span>
              <input aria-label={`${item.itemLabel} monthly amount`} type="number" min="0" step="0.01" className="mt-1 h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:mt-0" {...register(`expenses.${index}.monthlyAmount`, { setValueAs: value => value === '' ? 0 : Number(value) })} />
            </label>
            <label className="block min-w-0 text-xs font-semibold text-muted-foreground">
              <span className="md:sr-only">Notes</span>
              <input aria-label={`${item.itemLabel} notes`} className="mt-1 h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:mt-0" {...register(`expenses.${index}.notes`)} />
            </label>
          </div>;
        })}
      </div>
    </section>
  </div>;
}
