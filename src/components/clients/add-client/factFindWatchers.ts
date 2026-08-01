export const INCOME_KEYS=['baseSalary','bonus','commission','overtime','otherTaxableIncome'] as const;
export const incomeNames=(index:0|1)=>INCOME_KEYS.map(key=>`employment.${index}.${key}` as const);
export const ASSET_VALUE_NAMES=Array.from({length:10},(_,index)=>`assets.${index}.currentValue` as const);
export const ASSET_LOAN_NAMES=Array.from({length:10},(_,index)=>`assets.${index}.loanBalance` as const);
export const ASSET_TOTAL_NAMES=[...ASSET_VALUE_NAMES,...ASSET_LOAN_NAMES] as const;
export const LIABILITY_BALANCE_NAMES=Array.from({length:8},(_,index)=>`liabilities.${index}.currentBalance` as const);
export const ASSET_ROW_INDEXES=Array.from({length:10},(_,index)=>index);
export const LIABILITY_ROW_INDEXES=Array.from({length:8},(_,index)=>index);
