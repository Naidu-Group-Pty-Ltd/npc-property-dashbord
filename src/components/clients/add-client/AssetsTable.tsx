import { memo, useMemo } from 'react';
import { useFormContext, useWatch, type UseFormRegister } from 'react-hook-form';
import { Landmark } from 'lucide-react';
import { ASSET_COLUMNS } from '@/lib/client-fact-find/fieldDefinitions';
import { calculateAssetTotalsCents, centsToDisplay } from '@/lib/client-fact-find/calculations';
import type { AdvancedClientCreationPayload } from '@/lib/client-fact-find/types';
import { AdvancedSectionHeader, premiumSectionClass } from './AdvancedSectionHeader';
import { ASSET_ROW_INDEXES, ASSET_TOTAL_NAMES, ASSET_VALUE_NAMES } from './factFindWatchers';

const names = ['assetType', 'descriptionOrAddress', 'owner', 'currentValue', 'rentalOrOtherIncome', 'financialInstitution', 'loanBalance', 'monthlyRepayment', 'interestRate', 'maturityDate'] as const;
const numericNames = new Set<string>(['currentValue', 'rentalOrOtherIncome', 'loanBalance', 'monthlyRepayment', 'interestRate']);
const wideNames = new Set<string>(['descriptionOrAddress', 'financialInstitution']);

export function AssetsTable() {
  const { register } = useFormContext<AdvancedClientCreationPayload>();
  return <section data-testid="assets-table" className={`${premiumSectionClass} min-w-0 max-w-full`}>
    <AdvancedSectionHeader icon={Landmark} title="Assets" description="10 fixed workbook positions with linked lending details." trailing={<AssetsTotals />} />
    <div className="grid min-w-0 gap-4 p-3 sm:p-5">
      {ASSET_ROW_INDEXES.map(row => <AssetRow key={row} row={row} register={register} />)}
    </div>
  </section>;
}

const AssetRow = memo(function AssetRow({ row, register }: { row: number; register: UseFormRegister<AdvancedClientCreationPayload> }) {
  return <fieldset data-testid="asset-card" className="group w-full min-w-0 max-w-full rounded-xl border border-border/70 border-l-2 border-l-success/40 bg-background/45 p-3 transition-[border-color,background-color] duration-150 focus-within:border-success/45 focus-within:bg-muted/20 motion-reduce:transition-none sm:p-4">
    <legend className="rounded-full border border-success/25 bg-card px-3 py-1 text-xs font-bold uppercase tracking-wider text-success">Asset {row + 1}</legend>
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      {names.map((name, column) => {
        const label = ASSET_COLUMNS[column].label;
        return <label key={name} className={`min-w-0 space-y-1.5 text-sm ${wideNames.has(name) ? 'sm:col-span-2' : ''}`}>
          <span className="block break-words text-xs font-semibold text-foreground/90">{label}</span>
          <input aria-label={`Asset ${row + 1} ${label}`} type={numericNames.has(name) ? 'number' : name === 'maturityDate' ? 'date' : 'text'} min={numericNames.has(name) ? 0 : undefined} step={name === 'interestRate' ? '0.0001' : numericNames.has(name) ? '0.01' : undefined} className="h-11 w-full min-w-0 max-w-full rounded-lg border border-input bg-background/80 px-3 text-sm transition-[border-color,box-shadow] duration-150 focus-visible:border-brand-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none" {...register(`assets.${row}.${name}` as const, { setValueAs: value => numericNames.has(name) ? (value === '' ? 0 : Number(value)) : value })} />
        </label>;
      })}
    </div>
  </fieldset>;
});

function AssetsTotals() { const { control } = useFormContext<AdvancedClientCreationPayload>(); const values = useWatch({ control, name: ASSET_TOTAL_NAMES }); const totals = useMemo(() => calculateAssetTotalsCents(ASSET_VALUE_NAMES.map((_, index) => ({ currentValue: values[index], loanBalance: values[ASSET_VALUE_NAMES.length + index] }))), [values]); return <div data-testid="asset-totals" className="flex flex-wrap gap-2"><Kpi label="Total Assets" value={centsToDisplay(totals.totalAssetsCents)} /><Kpi label="Asset-Linked Debt" value={centsToDisplay(totals.totalAssetLinkedDebtCents)} /></div>; }
function Kpi({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-right"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><strong className="text-sm">{value}</strong></div>; }
