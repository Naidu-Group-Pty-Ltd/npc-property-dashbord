import { memo, useMemo } from 'react';
import { useFormContext, useWatch, type UseFormRegister } from 'react-hook-form';
import { CreditCard } from 'lucide-react';
import { LIABILITY_COLUMNS } from '@/lib/client-fact-find/fieldDefinitions';
import { calculateOtherLiabilitiesCents, centsToDisplay } from '@/lib/client-fact-find/calculations';
import type { AdvancedClientCreationPayload } from '@/lib/client-fact-find/types';
import { AdvancedSectionHeader, premiumSectionClass } from './AdvancedSectionHeader';
import { LIABILITY_BALANCE_NAMES, LIABILITY_ROW_INDEXES } from './factFindWatchers';

const names = ['liabilityType', 'lender', 'accountOrDescription', 'owner', 'limitOrOriginalAmount', 'currentBalance', 'monthlyRepayment', 'interestRate', 'remainingTerm', 'notes'] as const;
const numericNames = new Set<string>(['limitOrOriginalAmount', 'currentBalance', 'monthlyRepayment', 'interestRate']);
const doubleNames = new Set<string>(['lender', 'accountOrDescription']);

export function LiabilitiesTable() {
  const { register } = useFormContext<AdvancedClientCreationPayload>();
  return <section data-testid="liabilities-table" className={`${premiumSectionClass} min-w-0 max-w-full`}>
    <AdvancedSectionHeader icon={CreditCard} title="Other Liabilities" description="8 fixed workbook positions for non-asset-linked debt." trailing={<LiabilityTotals />} />
    <div className="grid min-w-0 gap-4 p-3 sm:p-5">
      {LIABILITY_ROW_INDEXES.map(row => <LiabilityRow key={row} row={row} register={register} />)}
    </div>
  </section>;
}

const LiabilityRow = memo(function LiabilityRow({ row, register }: { row: number; register: UseFormRegister<AdvancedClientCreationPayload> }) {
  return <fieldset data-testid="liability-card" className="group w-full min-w-0 max-w-full rounded-xl border border-border/70 border-l-2 border-l-warning/40 bg-background/45 p-3 transition-[border-color,background-color] duration-150 focus-within:border-warning/45 focus-within:bg-muted/20 motion-reduce:transition-none sm:p-4">
    <legend className="rounded-full border border-warning/25 bg-card px-3 py-1 text-xs font-bold uppercase tracking-wider text-warning">Liability {row + 1}</legend>
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      {names.map((name, column) => {
        const label = LIABILITY_COLUMNS[column].label;
        const span = name === 'notes' ? 'sm:col-span-2 lg:col-span-3 2xl:col-span-5' : doubleNames.has(name) ? 'sm:col-span-2' : '';
        return <label key={name} className={`min-w-0 space-y-1.5 text-sm ${span}`}>
          <span className="block break-words text-xs font-semibold text-foreground/90">{label}</span>
          <input aria-label={`Liability ${row + 1} ${label}`} type={numericNames.has(name) ? 'number' : 'text'} min={numericNames.has(name) ? 0 : undefined} step={name === 'interestRate' ? '0.0001' : numericNames.has(name) ? '0.01' : undefined} className="h-11 w-full min-w-0 max-w-full rounded-lg border border-input bg-background/80 px-3 text-sm transition-[border-color,box-shadow] duration-150 focus-visible:border-brand-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none" {...register(`liabilities.${row}.${name}` as const, { setValueAs: value => numericNames.has(name) ? (value === '' ? 0 : Number(value)) : value })} />
        </label>;
      })}
    </div>
  </fieldset>;
});

function LiabilityTotals() { const { control } = useFormContext<AdvancedClientCreationPayload>(); const balances = useWatch({ control, name: LIABILITY_BALANCE_NAMES }); const total = useMemo(() => calculateOtherLiabilitiesCents(balances.map(currentBalance => ({ currentBalance }))), [balances]); return <div data-testid="liability-totals" className="rounded-xl border border-border bg-muted/30 px-4 py-2 text-right"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Other Liabilities</p><strong className="text-sm">{centsToDisplay(total)}</strong></div>; }
