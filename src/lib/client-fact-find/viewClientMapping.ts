import type { AdvancedClientCreationPayload, FactFindAsset } from './types';

export type SecureInvoke=(name:string,body:Record<string,unknown>)=>Promise<{data?:any;error?:any}>;
const n=(value:unknown)=>Number(value)||0;
const present=(row:object)=>Object.entries(row).some(([key,value])=>!['displayOrder','applicantNumber','relationship','expenseKey','category','itemLabel','addressType'].includes(key)&&value!==''&&value!==null&&value!==0);
const propertyPattern=/\b(property|real estate|owner occupied|principal place of residence|investment property|rental property|smsf property)\b/i;
export const isPropertyAsset=(asset:FactFindAsset)=>propertyPattern.test(`${asset.assetType} ${asset.descriptionOrAddress}`);
const propertyType=(asset:FactFindAsset)=>/smsf/i.test(asset.assetType)?'smsf':/owner occupied|principal place/i.test(asset.assetType)?'owner_occupied':'investment';
const assetType=(value:string)=>/vehicle|car|boat|motor/i.test(value)?'vehicle':/saving|deposit|cash/i.test(value)?'savings':/super/i.test(value)?'superfund':/crypto|share|stock|fund|collect/i.test(value)?'alternative':'other';
const liabilityType=(value:string)=>/mortgage|home loan/i.test(value)?'mortgage':/credit card/i.test(value)?'credit_card':/vehicle|car/i.test(value)?'vehicle_loan':/student|hecs|help/i.test(value)?'student_loan':/personal/i.test(value)?'personal_loan':'other';

export function mapAdvancedToViewClient(payload:AdvancedClientCreationPayload){
  const primary=payload.applicants[0],secondary=payload.applicants[1];
  const current=(applicantNumber:1|2)=>payload.addresses.find(a=>a.applicantNumber===applicantNumber&&a.addressType==='current');
  const personal={primary_first_name:primary.firstName.trim(),primary_middle_name:primary.middleName||null,primary_surname:primary.surname.trim(),primary_mobile:primary.mobile||null,primary_email:primary.email||null,primary_gender:primary.gender||null,primary_dob:primary.dateOfBirth||null,current_address:current(1)?.address||null,living_situation:current(1)?.livingSituation||null,residential_status:primary.residencyStatus||null,marital_status:primary.maritalStatus||null,dependents_count:primary.numberOfDependants??null,
    secondary_first_name:secondary?.firstName||null,secondary_middle_name:secondary?.middleName||null,secondary_surname:secondary?.surname||null,secondary_mobile:secondary?.mobile||null,secondary_email:secondary?.email||null,secondary_gender:secondary?.gender||null,secondary_dob:secondary?.dateOfBirth||null,secondary_current_address:current(2)?.address||null,secondary_living_situation:current(2)?.livingSituation||null,secondary_residential_status:secondary?.residencyStatus||null};
  const addresses=payload.addresses.filter(present).map(a=>({contact_type:a.applicantNumber===1?'primary':'secondary',additional_contact_id:null,address:a.address,current_suburb:null,current_state:null,current_postcode:null,country:'Australia',living_situation:a.livingSituation||null,residential_status:null,start_date:a.movedInDate||null,end_date:null,is_current:a.addressType==='current',notes:null}));
  const employment=payload.employment.filter((e):e is NonNullable<typeof e>=>Boolean(e&&present(e))).map(e=>({contact_type:e.applicantNumber===1?'primary':'secondary',additional_contact_id:null,is_current:true,employment_type:e.employmentType||'other',occupation_role:e.roleOrPosition||null,employer_name:e.employerOrBusiness||null,start_date:e.startDate||null,salary_amount:n(e.baseSalary),salary_frequency:'annual',gross_annual_salary:n(e.baseSalary),bonus:n(e.bonus),commission:n(e.commission),overtime_essential:n(e.overtime),overtime_non_essential:0,allowance:0,other_taxable_income:n(e.otherTaxableIncome),workplace_address_line_1:e.employerAddress||null,workplace_suburb:null,workplace_state:null,workplace_postcode:null,workplace_country:null,work_arrangement:null}));
  const properties=payload.assets.filter(a=>present(a)&&isPropertyAsset(a)).map(a=>({property_type:propertyType(a),address:a.descriptionOrAddress,value:n(a.currentValue),loan_remaining:n(a.loanBalance),interest_rate:n(a.interestRate),ownership_percentage:100,monthly_interest_repayment:n(a.monthlyRepayment),repayment_type:'principal_interest',monthly_body_corporate:0,monthly_council_rates:0,monthly_water_rates:0,monthly_repairs_maintenance:0,monthly_property_management:0,monthly_landlord_insurance:0,monthly_building_insurance:0,monthly_rental_income:n(a.rentalOrOtherIncome),weekly_rental_income:n(a.rentalOrOtherIncome)*12/52,total_monthly_expenditure:n(a.monthlyRepayment),net_monthly_cashflow:n(a.rentalOrOtherIncome)-n(a.monthlyRepayment)}));
  const assets=payload.assets.filter(a=>present(a)&&!isPropertyAsset(a)).map(a=>({asset_type:assetType(a.assetType),description:a.descriptionOrAddress||a.assetType||null,value:n(a.currentValue),institution_name:a.financialInstitution||null,vehicle_type:/vehicle|car|boat|motor/i.test(a.assetType)?'other':null,make_model:null}));
  const liabilities=payload.liabilities.filter(present).map(l=>({liability_type:liabilityType(l.liabilityType),provider_name:l.lender||l.accountOrDescription||null,current_balance:n(l.currentBalance),credit_limit:n(l.limitOrOriginalAmount)||null,interest_rate:n(l.interestRate),monthly_repayment:n(l.monthlyRepayment),repayment_type:'principal_interest'}));
  const expenses=payload.expenses.filter(e=>n(e.monthlyAmount)>0||Boolean(e.notes.trim())).map(e=>({expense_category:e.category,expense_name:e.itemLabel,monthly_amount:n(e.monthlyAmount),frequency:'monthly',notes:e.notes||null,is_essential:true}));
  return {personal,addresses,employment,properties,assets,liabilities,expenses};
}

export async function saveAdvancedViewClientData(clientId:string,payload:AdvancedClientCreationPayload,invoke:SecureInvoke){
  const mapped=mapAdvancedToViewClient(payload),failed:string[]=[];
  const call=async(label:string,table:string,data:Record<string,unknown>)=>{try{const result=await invoke('manage-client-data',{operation:table==='clients'?'update':'create',table,clientId,data:{...data,...(table==='clients'?{}:{client_id:clientId})}});if(result.error||!result.data?.success)throw new Error()}catch{failed.push(label)}};
  await call('Personal information','clients',mapped.personal);
  for(const data of mapped.addresses)await call('Address History','client_address_history',data);
  for(const data of mapped.employment)await call('Employment and Income','client_employment',data);
  for(const data of mapped.properties)await call('Properties','client_properties',data);
  for(const data of mapped.assets)await call('Financial assets','client_assets',data);
  for(const data of mapped.liabilities)await call('Liabilities','client_liabilities',data);
  for(const data of mapped.expenses)await call('Living Expenses','client_expenses',data);
  return [...new Set(failed)];
}
