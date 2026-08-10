/**
 * Native stamp duty calculator.
 *
 * Replaces an iframe that loaded a third-party widget from
 * calculatorsonline.com.au and read its answer back out by scraping the
 * rendered DOM for the string "Stamp Duty" next to a dollar sign. That
 * arrangement had four problems, all of which this component removes: the
 * vendor's rate tables were a financial year out of date, the vendor holds a
 * remote block-list that can replace the widget with an error message on any
 * domain it chooses, every "Calculate" click posted the property value and the
 * full report URL to the vendor's server, and the state we detected from the
 * property address never reached the widget at all.
 *
 * Figures come from `@/utils/stampDutyCalculator`, which is the single
 * schedule set for the whole product. The panel deliberately shows its working
 * — base duty, concession, surcharge — and cites the financial year and the
 * revenue office page, because these numbers go into client-facing reports and
 * an adviser needs to be able to defend them.
 */

import { useCallback, useMemo } from 'react';
import { Building2, Check, ExternalLink, Info } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  AUSTRALIAN_STATES,
  calculateStampDuty,
  type AustralianState,
  type PropertyCategory,
  type PurchaseIntent,
} from '@/utils/stampDutyCalculator';

export interface StampDutyCalculatorPanelProps {
  /** Dutiable value. Normally the report's purchase price. */
  propertyValue: number;
  state: AustralianState;
  onStateChange: (state: AustralianState) => void;
  intent: PurchaseIntent;
  onIntentChange: (intent: PurchaseIntent) => void;
  category: PropertyCategory;
  onCategoryChange: (category: PropertyCategory) => void;
  isFirstHomeBuyer: boolean;
  onFirstHomeBuyerChange: (value: boolean) => void;
  isForeignBuyer: boolean;
  onForeignBuyerChange: (value: boolean) => void;
  /** Called with the assessed total when the user accepts the figure. */
  onUseValue?: (totalDuty: number) => void;
  /** Label for the accept button; omit `onUseValue` to hide it entirely. */
  useValueLabel?: string;
  disabled?: boolean;
  className?: string;
}

const STATE_LABELS: Record<AustralianState, string> = {
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  WA: 'Western Australia',
  SA: 'South Australia',
  TAS: 'Tasmania',
  NT: 'Northern Territory',
  ACT: 'Australian Capital Territory',
};

const CATEGORY_LABELS: Record<PropertyCategory, string> = {
  established: 'An established home',
  new: 'A new home',
  vacant_land: 'Vacant land',
};

const currency = (value: number) =>
  value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

/** One line of the assessment. `tone` picks the semantic token, never a palette. */
function DutyLine({
  label,
  amount,
  tone = 'default',
  signed = false,
}: {
  label: string;
  amount: number;
  tone?: 'default' | 'credit' | 'debit';
  signed?: boolean;
}) {
  const toneClass =
    tone === 'credit' ? 'text-success' : tone === 'debit' ? 'text-destructive' : 'text-foreground';
  const prefix = signed ? (tone === 'credit' ? '−' : '+') : '';
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium tabular-nums', toneClass)}>
        {prefix}
        {currency(Math.abs(amount))}
      </span>
    </div>
  );
}

export function StampDutyCalculatorPanel({
  propertyValue,
  state,
  onStateChange,
  intent,
  onIntentChange,
  category,
  onCategoryChange,
  isFirstHomeBuyer,
  onFirstHomeBuyerChange,
  isForeignBuyer,
  onForeignBuyerChange,
  onUseValue,
  useValueLabel = 'Use this figure',
  disabled = false,
  className,
}: StampDutyCalculatorPanelProps) {
  const result = useMemo(
    () =>
      calculateStampDuty({
        propertyValue,
        state,
        intent,
        category,
        isFirstHomeBuyer,
        isForeignBuyer,
      }),
    [propertyValue, state, intent, category, isFirstHomeBuyer, isForeignBuyer],
  );

  const handleUse = useCallback(() => {
    onUseValue?.(result.totalDuty);
  }, [onUseValue, result.totalDuty]);

  // A first home buyer is only a coherent idea for an owner-occupier, and the
  // engine ignores the flag otherwise; hiding the control avoids offering a
  // switch that silently does nothing.
  const showFirstHomeBuyer = intent === 'owner_occupier';
  const hasValue = propertyValue > 0;

  return (
    <div className={cn('glass-subtle space-y-4 rounded-lg p-4', className)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="stamp-duty-state" className="text-sm font-medium">
            State or territory
          </Label>
          <Select
            value={state}
            onValueChange={(value) => onStateChange(value as AustralianState)}
            disabled={disabled}
          >
            <SelectTrigger id="stamp-duty-state">
              <SelectValue placeholder="Select a jurisdiction" />
            </SelectTrigger>
            <SelectContent>
              {AUSTRALIAN_STATES.map((code) => (
                <SelectItem key={code} value={code}>
                  {code} — {STATE_LABELS[code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="stamp-duty-intent" className="text-sm font-medium">
            Purchasing as
          </Label>
          <Select
            value={intent}
            onValueChange={(value) => onIntentChange(value as PurchaseIntent)}
            disabled={disabled}
          >
            <SelectTrigger id="stamp-duty-intent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owner_occupier">Owner-occupier</SelectItem>
              <SelectItem value="investor">Investor</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="stamp-duty-category" className="text-sm font-medium">
            Buying
          </Label>
          <Select
            value={category}
            onValueChange={(value) => onCategoryChange(value as PropertyCategory)}
            disabled={disabled}
          >
            <SelectTrigger id="stamp-duty-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CATEGORY_LABELS) as PropertyCategory[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {CATEGORY_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Dutiable value</Label>
          <div className="glass-inset flex h-10 items-center rounded-md px-3 text-sm font-medium tabular-nums">
            {hasValue ? currency(propertyValue) : 'Set a purchase price'}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {showFirstHomeBuyer && (
          <div className="glass-inset flex items-center justify-between rounded-md p-3">
            <div>
              <Label htmlFor="stamp-duty-fhb" className="cursor-pointer text-sm font-medium">
                First home buyer
              </Label>
              <p className="text-xs text-muted-foreground">Applies the concession for this jurisdiction</p>
            </div>
            <Switch
              id="stamp-duty-fhb"
              checked={isFirstHomeBuyer}
              onCheckedChange={onFirstHomeBuyerChange}
              disabled={disabled}
            />
          </div>
        )}

        <div className="glass-inset flex items-center justify-between rounded-md p-3">
          <div>
            <Label htmlFor="stamp-duty-foreign" className="cursor-pointer text-sm font-medium">
              Foreign purchaser
            </Label>
            <p className="text-xs text-muted-foreground">Adds the surcharge where the jurisdiction levies one</p>
          </div>
          <Switch
            id="stamp-duty-foreign"
            checked={isForeignBuyer}
            onCheckedChange={onForeignBuyerChange}
            disabled={disabled}
          />
        </div>
      </div>

      <Separator />

      {hasValue ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <DutyLine label="Transfer duty on the applicable scale" amount={result.baseDuty} />
            {result.fhbConcession > 0 && (
              <DutyLine label="First home buyer concession" amount={result.fhbConcession} tone="credit" signed />
            )}
            {result.foreignSurcharge > 0 && (
              <DutyLine label="Foreign purchaser surcharge" amount={result.foreignSurcharge} tone="debit" signed />
            )}
          </div>

          <div className="glass-accent flex items-baseline justify-between gap-4 rounded-md px-3 py-2.5">
            <span className="text-sm font-semibold">Stamp duty payable</span>
            <span className="text-lg font-bold tabular-nums">{currency(result.totalDuty)}</span>
          </div>

          <p className="text-xs text-muted-foreground">
            {result.effectiveRate.toFixed(2)}% of the purchase price
          </p>

          {result.notes.length > 0 && (
            <ul className="space-y-1">
              {result.notes.map((note) => (
                <li key={note} className="flex gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}

          {onUseValue && (
            <Button type="button" onClick={handleUse} disabled={disabled} className="w-full gap-2">
              <Check className="h-4 w-4" aria-hidden="true" />
              {useValueLabel} — {currency(result.totalDuty)}
            </Button>
          )}
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Enter a purchase price to assess stamp duty.
        </p>
      )}

      <Separator />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            {result.state} schedule, financial year {result.scheduleYear}
          </span>
        </div>
        {result.sourceUrl && (
          <a
            href={result.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Revenue office rates
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </div>

      <Badge variant="outline" className="text-xs font-normal">
        Estimate only — confirm with a conveyancer before settlement
      </Badge>
    </div>
  );
}

export default StampDutyCalculatorPanel;
