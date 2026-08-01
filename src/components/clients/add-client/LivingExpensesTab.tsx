import { useFormContext, useWatch } from 'react-hook-form';
import { ReceiptText, WalletCards } from 'lucide-react';
import type { AdvancedClientCreationPayload } from '@/lib/client-fact-find/types';
import { calculateFactFindTotals, centsToDisplay } from '@/lib/client-fact-find/calculations';
import { LIVING_EXPENSE_ITEMS } from '@/lib/client-fact-find/fieldDefinitions';

export function LivingExpensesTab(){
  const {register,control,getValues}=useFormContext<AdvancedClientCreationPayload>();
  useWatch({control,name:'expenses'});
  const total=calculateFactFindTotals(getValues()).totalMonthlyLivingExpensesCents;
  return <div className="space-y-5" data-testid="advanced-expenses-tab">
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand-300/25 bg-brand-300/10"><WalletCards className="h-5 w-5 text-brand-200"/></span><div><h3 className="font-semibold">Monthly Living Expenses</h3><p className="text-sm text-muted-foreground">Enter monthly amounts and notes for all 50 workbook items.</p></div></div>
      <div className="rounded-xl border border-brand-300/25 bg-brand-300/10 px-4 py-2.5 sm:text-right"><p className="text-xs font-medium text-muted-foreground">Total Monthly Living Expenses</p><strong className="text-xl">{centsToDisplay(total)}</strong></div>
    </section>
    <section data-testid="expense-continuous-list" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="hidden grid-cols-[20%_35%_15%_30%] border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid"><span>Category</span><span>Expense Item</span><span>Monthly Amount</span><span>Notes</span></div>
      <div className="divide-y divide-border">{LIVING_EXPENSE_ITEMS.map((item,index)=><div data-testid="expense-row" className="grid gap-3 px-4 py-3 hover:bg-muted/20 md:grid-cols-[20%_35%_15%_30%] md:items-center md:gap-0" key={item.key}>
        <div><span className="text-xs font-medium text-muted-foreground md:hidden">Category</span><p className="text-sm font-medium">{item.category}</p></div>
        <div><span className="text-xs font-medium text-muted-foreground md:hidden">Expense Item</span><p className="text-sm">{item.itemLabel}</p></div>
        <label className="block pr-0 text-xs font-medium text-muted-foreground md:pr-3"><span className="md:sr-only">Monthly Amount</span><input aria-label={`${item.itemLabel} monthly amount`} type="number" min="0" step="0.01" className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:mt-0" {...register(`expenses.${index}.monthlyAmount`,{setValueAs:v=>v===''?0:Number(v)})}/></label>
        <label className="block text-xs font-medium text-muted-foreground"><span className="md:sr-only">Notes</span><input aria-label={`${item.itemLabel} notes`} className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:mt-0" {...register(`expenses.${index}.notes`)}/></label>
      </div>)}</div>
    </section>
  </div>
}
