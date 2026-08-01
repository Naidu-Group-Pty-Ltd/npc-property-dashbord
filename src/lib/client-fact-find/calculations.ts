import type { AdvancedClientCreationPayload, FactFindApplicant, FactFindBrandingSnapshot, FactFindCalculatedTotals, MoneyInput } from './types';

export function safeBlankToZero(value: MoneyInput): number {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return 0;
  const numeric = typeof value === 'number' ? value : Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}
export function dollarsToCents(value: MoneyInput): number { return Math.round((safeBlankToZero(value) + Number.EPSILON) * 100); }
export function centsToDisplay(cents: number, locale='en-AU', currency='AUD'): string {
  return new Intl.NumberFormat(locale,{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);
}
export function fullApplicantName(applicant: Pick<FactFindApplicant,'firstName'|'middleName'|'surname'>): string {
  return [applicant.firstName, applicant.middleName, applicant.surname].map(v=>v.trim()).filter(Boolean).join(' ');
}
export function brandingFooter(branding: Pick<FactFindBrandingSnapshot,'email'|'phone'|'businessAddress'>): string {
  return [branding.email,branding.phone,branding.businessAddress].map(v=>v.trim()).join(' | ');
}
export function formatNetPosition(cents:number): string { return cents < 0 ? `-${centsToDisplay(Math.abs(cents))}` : centsToDisplay(cents); }
/** Normalizes a user-entered percentage to percentage points (5 or "5%" => 5). */
export function normalizePercentage(value:number|string|null|undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const normalized=typeof value==='string'?Number(value.trim().replace(/%$/,'')):value;
  return Number.isFinite(normalized) ? normalized : 0;
}
const income = (employment: AdvancedClientCreationPayload['employment'][number] | undefined) => employment
  ? ['baseSalary','bonus','commission','overtime','otherTaxableIncome'].reduce((sum,key)=>sum+dollarsToCents(employment[key as keyof typeof employment] as MoneyInput),0) : 0;
export function calculateFactFindTotals(payload: Pick<AdvancedClientCreationPayload,'assets'|'liabilities'|'expenses'|'employment'>): FactFindCalculatedTotals {
  const totalAssetsCents=payload.assets.reduce((s,row)=>s+dollarsToCents(row.currentValue),0);
  const totalAssetLinkedDebtCents=payload.assets.reduce((s,row)=>s+dollarsToCents(row.loanBalance),0);
  const totalOtherLiabilitiesCents=payload.liabilities.reduce((s,row)=>s+dollarsToCents(row.currentBalance),0);
  const totalDebtCents=totalAssetLinkedDebtCents+totalOtherLiabilitiesCents;
  const totalMonthlyLivingExpensesCents=payload.expenses.reduce((s,row)=>s+dollarsToCents(row.monthlyAmount),0);
  return {totalAssetsCents,totalAssetLinkedDebtCents,totalOtherLiabilitiesCents,totalDebtCents,
    netPositionCents:totalAssetsCents-totalDebtCents,applicant1AnnualIncomeCents:income(payload.employment.find(e=>e?.applicantNumber===1)),
    applicant2AnnualIncomeCents:income(payload.employment.find(e=>e?.applicantNumber===2)),totalMonthlyLivingExpensesCents,
    clientFormOutputLivingExpensesCents:totalMonthlyLivingExpensesCents};
}
export function totalsMatch(a:FactFindCalculatedTotals,b:FactFindCalculatedTotals):boolean { return (Object.keys(a) as (keyof FactFindCalculatedTotals)[]).every(k=>a[k]===b[k]); }
