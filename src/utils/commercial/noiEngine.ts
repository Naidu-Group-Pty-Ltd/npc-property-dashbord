import type { AssumptionConfidenceTag } from './assumptionRegistry';
import { deriveCalculatedConfidence } from './assumptionRegistry';

export type DataSourceMode = 'global' | 'manualOverride' | 'aiEstimate';
export type LeaseType = 'gross' | 'net' | 'semiGross' | 'tripleNet' | 'unknown';
export type IncomeType = 'passingRent' | 'marketRent' | 'stabilisedRent' | 'relatedPartyRent' | 'vacantEstimatedMarketRent';
export type NoiBasis = 'actual' | 'stabilised' | 'lenderAdjusted';

export type NumericInput = number | string | null | undefined;
export interface OutgoingsRecoverabilityItem { name: string; amount: NumericInput; recoverablePct: NumericInput; verified?: boolean; }

export interface NoiEngineInputs {
  dataSourceMode?: DataSourceMode;
  leaseType: LeaseType;
  incomeType?: IncomeType;
  grossPassingRent: NumericInput;
  otherIncome?: NumericInput;
  marketRent?: NumericInput;
  vacancyAllowancePct?: NumericInput;
  recoveredOutgoings?: NumericInput;
  simpleTotalOperatingExpenses?: NumericInput;
  outgoings?: OutgoingsRecoverabilityItem[];
  normalisedRecoveredOutgoings?: NumericInput;
  normalisedVacancyPct?: NumericInput;
  normalisedExpenses?: NumericInput;
  incentiveAdjustment?: NumericInput;
  rentFreeAdjustment?: NumericInput;
  arrearsAdjustment?: NumericInput;
  overRentAdjustment?: NumericInput;
  waleAdjustment?: NumericInput;
  leaseRiskHaircut?: NumericInput;
  tenantRiskHaircut?: NumericInput;
  documentationRiskHaircut?: NumericInput;
  lenderAdjustedNoiHaircut?: NumericInput;
  fullyLeased?: boolean;
  leaseDocsVerified?: boolean;
  confidenceTags?: AssumptionConfidenceTag[];
}

export interface NoiBridgeItem { label: string; amount: number; }
export interface NoiEngineResult {
  potentialGrossIncome: number;
  vacancyLoss: number;
  effectiveGrossIncome: number;
  totalOperatingExpenses: number;
  ownerBorneExpenses: number;
  recoveredOutgoings: number;
  actualNoi: number;
  stabilisedNoi: number;
  lenderAdjustedNoi: number;
  selectedNoi: number;
  selectedBasis: NoiBasis;
  confidenceTag: AssumptionConfidenceTag;
  bridge: NoiBridgeItem[];
  warnings: string[];
}

const pct = (n = 0) => Math.max(0, n) / 100;
const sum = (arr: number[]) => arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
const parseNumeric = (value: NumericInput, { allowNegative = false }: { allowNegative?: boolean } = {}): number | null => {
  if (value === '' || value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s%]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return !allowNegative && parsed < 0 ? null : parsed;
};
const optional = (value: NumericInput, calculationReady: boolean, opts?: { allowNegative?: boolean }) => parseNumeric(value, opts) ?? (calculationReady ? 0 : null);
const required = (value: NumericInput, opts?: { allowNegative?: boolean }) => parseNumeric(value, opts);

export function calculateNoiEngine(inputs: NoiEngineInputs, selectedBasis: NoiBasis = 'lenderAdjusted'): NoiEngineResult {
  const warnings: string[] = [];
  const grossPassingRent = required(inputs.grossPassingRent);
  const vacancyAllowancePct = required(inputs.vacancyAllowancePct);
  const calculationReady = grossPassingRent !== null && vacancyAllowancePct !== null;
  const otherIncome = optional(inputs.otherIncome, calculationReady) ?? 0;
  const potentialGrossIncome = calculationReady ? grossPassingRent + otherIncome : 0;
  const vacancyLoss = potentialGrossIncome * pct(vacancyAllowancePct ?? 0);
  const outgoings = inputs.outgoings ?? [];
  const simpleTotalOperatingExpenses = parseNumeric(inputs.simpleTotalOperatingExpenses);
  const itemisedOperatingExpenses = calculationReady ? sum(outgoings.map(o => optional(o.amount, true) ?? 0)) : 0;
  const totalOperatingExpenses = simpleTotalOperatingExpenses ?? itemisedOperatingExpenses;
  const matrixRecovered = calculationReady ? sum(outgoings.map(o => (optional(o.amount, true) ?? 0) * Math.min(1, Math.max(0, (optional(o.recoverablePct, true) ?? 0) / 100)))) : 0;
  const recoveredOutgoings = optional(inputs.recoveredOutgoings, calculationReady) ?? matrixRecovered;
  const ownerBorneExpenses = totalOperatingExpenses - recoveredOutgoings;
  const effectiveGrossIncome = potentialGrossIncome - vacancyLoss + recoveredOutgoings;
  const actualNoi = effectiveGrossIncome - totalOperatingExpenses;
  const marketRent = optional(inputs.marketRent, calculationReady) ?? grossPassingRent ?? 0;
  const normalisedVacancyPct = optional(inputs.normalisedVacancyPct, calculationReady) ?? vacancyAllowancePct ?? 0;
  const normalisedVacancy = (marketRent + otherIncome) * pct(normalisedVacancyPct);
  const stabilisedNoi = ((marketRent + otherIncome) * (1 - pct(normalisedVacancyPct))) + (optional(inputs.normalisedRecoveredOutgoings, calculationReady) ?? recoveredOutgoings) - (optional(inputs.normalisedExpenses, calculationReady) ?? totalOperatingExpenses);
  const lenderAdjustments = sum([
    inputs.incentiveAdjustment,
    inputs.rentFreeAdjustment,
    inputs.arrearsAdjustment,
    inputs.overRentAdjustment,
    inputs.waleAdjustment,
    inputs.leaseRiskHaircut,
    inputs.tenantRiskHaircut,
    inputs.documentationRiskHaircut,
    inputs.lenderAdjustedNoiHaircut,
  ].map(n => Math.max(0, optional(n, calculationReady, { allowNegative: true }) ?? 0)));
  const lenderAdjustedNoi = actualNoi - lenderAdjustments;
  if (!calculationReady) warnings.push('NOI calculation pending required gross rent and vacancy allowance inputs.');
  if (inputs.fullyLeased && (grossPassingRent ?? 0) <= 0) warnings.push('Fully leased assets require rent greater than zero.');
  if (inputs.leaseType === 'unknown') warnings.push('Lease type is unknown; NOI cannot be treated as verified.');
  if (recoveredOutgoings > totalOperatingExpenses && totalOperatingExpenses > 0) warnings.push('Recovered outgoings exceed total outgoings; verify recoverability matrix.');
  if (lenderAdjustedNoi > actualNoi) warnings.push('Lender-adjusted NOI exceeds actual NOI; explanation required.');
  if (inputs.leaseDocsVerified === false) warnings.push('Lease documentation is not verified.');
  const confidenceTag = inputs.leaseType === 'unknown' || inputs.leaseDocsVerified === false
    ? 'Specialist Review Required'
    : deriveCalculatedConfidence(inputs.confidenceTags ?? ['Manual Estimate']);
  const selectedNoi = selectedBasis === 'actual' ? actualNoi : selectedBasis === 'stabilised' ? stabilisedNoi : lenderAdjustedNoi;
  return {
    potentialGrossIncome,
    vacancyLoss,
    effectiveGrossIncome,
    totalOperatingExpenses,
    ownerBorneExpenses,
    recoveredOutgoings,
    actualNoi,
    stabilisedNoi,
    lenderAdjustedNoi,
    selectedNoi,
    selectedBasis,
    confidenceTag,
    warnings,
    bridge: [
      { label: 'Potential Gross Income', amount: potentialGrossIncome },
      { label: 'Vacancy Loss', amount: -vacancyLoss },
      { label: 'Recovered Outgoings', amount: recoveredOutgoings },
      { label: 'Total Operating Expenses', amount: -totalOperatingExpenses },
      { label: 'Actual NOI', amount: actualNoi },
      { label: 'Lender Adjustments', amount: -lenderAdjustments },
      { label: 'Lender-Adjusted NOI', amount: lenderAdjustedNoi },
    ],
  };
}
