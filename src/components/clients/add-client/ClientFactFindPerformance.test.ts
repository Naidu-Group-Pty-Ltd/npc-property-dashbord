import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const read=(name:string)=>readFileSync(new URL(name,import.meta.url),'utf8');
describe('Client Fact Find subscription boundaries',()=>{
 it('keeps the structural tab free of broad form subscriptions',()=>{const source=read('./ClientFactFindTab.tsx');expect(source).not.toContain('useWatch');expect(source).not.toContain('useFormContext');expect(source).toContain('<FactFindSummary/>')});
 it('watches only calculation inputs in isolated totals',()=>{const summary=read('./FactFindSummary.tsx'),watchers=read('./factFindWatchers.ts');expect(summary).toContain('name:SUMMARY_NAMES');expect(watchers).toContain("'baseSalary','bonus','commission','overtime','otherTaxableIncome'");expect(watchers).toContain('.currentValue');expect(watchers).toContain('.loanBalance');expect(watchers).toContain('.currentBalance');for(const unrelated of ['descriptionOrAddress','rentalOrOtherIncome','monthlyRepayment','notes'])expect(watchers).not.toContain(unrelated)});
 it('isolates table totals and memoizes stable uncontrolled rows',()=>{const assets=read('./AssetsTable.tsx'),liabilities=read('./LiabilitiesTable.tsx');expect(assets).not.toContain("name:'assets'");expect(liabilities).not.toContain("name:'liabilities'");expect(assets).toContain('memo(function AssetRow');expect(liabilities).toContain('memo(function LiabilityRow');expect(assets).toContain('register(`assets.');expect(liabilities).toContain('register(`liabilities.')});
 it('subscribes FormField validation to its exact field name',()=>{const source=read('./FormField.tsx');expect(source).toContain('useFormState({ control, name, exact: true })');expect(source).not.toContain('formState: { errors }')});
});
