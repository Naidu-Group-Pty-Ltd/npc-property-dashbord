import * as XLSX from 'xlsx';
import { createAdvancedDefaults } from '@/components/clients/add-client/defaults';
import { ADDRESS_FIELDS, APPLICANT_FIELDS, ASSET_COLUMNS, EMPLOYMENT_FIELDS, LIABILITY_COLUMNS, LIVING_EXPENSE_ITEMS, WHITE_LABEL_FIELDS } from './fieldDefinitions';
import type { AdvancedClientCreationPayload } from './types';

export const ADVANCED_TEMPLATE_URL='/templates/advanced-client/Aurixa-Systems-Client-Fact-Find-Template.xlsx';
export const MAX_EXCEL_FILE_BYTES=10*1024*1024;
export const EXCEL_ACCEPT={
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx'],
  'application/vnd.ms-excel':['.xls'],
};
const REQUIRED_SHEETS=['Client Fact Find','Living Expenses'] as const;

export interface ExcelImportSummary { applicantsFound:number; addressesFound:number; employmentRecordsFound:number; assetsPopulated:number; liabilitiesPopulated:number; livingExpensesPopulated:number; warnings:number }
export interface ParsedExcelImport { payload:AdvancedClientCreationPayload; summary:ExcelImportSummary; warnings:string[] }

export function validateExcelFile(file:Pick<File,'name'|'size'>):string|null {
  if(!/\.(xlsx|xls)$/i.test(file.name))return 'Unsupported file type. Select an .xlsx or .xls workbook.';
  if(file.size>MAX_EXCEL_FILE_BYTES)return 'The workbook is larger than the 10 MB maximum.';
  return null;
}
const value=(sheet:XLSX.WorkSheet,cell:string)=>sheet[cell]?.v;
const text=(sheet:XLSX.WorkSheet,cell:string)=>String(value(sheet,cell)??'').trim();
const number=(sheet:XLSX.WorkSheet,cell:string)=>{const raw=value(sheet,cell);if(raw==null||raw==='')return 0;const parsed=typeof raw==='number'?raw:Number(String(raw).replace(/[$,%\s,]/g,''));return Number.isFinite(parsed)?parsed:0};
const date=(sheet:XLSX.WorkSheet,cell:string):string|null=>{const raw=value(sheet,cell);if(raw==null||raw==='')return null;if(typeof raw==='number'){const d=XLSX.SSF.parse_date_code(raw);return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:null}const parsed=new Date(String(raw));return Number.isNaN(parsed.valueOf())?null:parsed.toISOString().slice(0,10)};
const hasContent=(record:object)=>Object.entries(record).some(([key,v])=>!['displayOrder','applicantNumber','relationship','expenseKey','category','itemLabel'].includes(key)&&v!==''&&v!==null&&v!==0);

export function parseAdvancedClientWorkbook(data:ArrayBuffer):ParsedExcelImport {
  const workbook=XLSX.read(data,{type:'array',cellDates:false});
  const missing=REQUIRED_SHEETS.filter(name=>!workbook.Sheets[name]);
  if(missing.length)throw new Error(`Required worksheet${missing.length>1?'s are':' is'} missing: ${missing.join(', ')}.`);
  const payload=createAdvancedDefaults(),warnings:string[]=[];
  const branding=workbook.Sheets['White Label Setup'];
  if(branding){for(const field of WHITE_LABEL_FIELDS){if(field.key==='primaryColour'||field.key==='accentColour')continue;const target=field.cell.startsWith('E')?field.cell:field.cell;const next=text(branding,target);if(next)(payload.branding as unknown as Record<string,unknown>)[field.key]=next}}
  else warnings.push('White Label Setup was not found; current white-label defaults will be used.');
  const fact=workbook.Sheets['Client Fact Find'];
  ([0,1] as const).forEach(index=>{
    const column=index===0?'C':'G',applicant=payload.applicants[index]!;
    APPLICANT_FIELDS.forEach(field=>{const cell=`${column}${XLSX.utils.decode_cell(field.cell).r+1}`;const raw=field.type==='date'?date(fact,cell):field.type==='integer'?number(fact,cell):text(fact,cell);(applicant as unknown as Record<string,unknown>)[field.key]=raw});
    const addressRows=[['current',19,20,21,0],['previous',22,23,24,1]] as const;
    addressRows.forEach(([addressType,addressRow,livingRow,movedRow,displayOrder])=>{const address=payload.addresses.find(a=>a.applicantNumber===index+1&&a.addressType===addressType)!;address.address=text(fact,`${column}${addressRow}`);address.livingSituation=text(fact,`${column}${livingRow}`);address.movedInDate=date(fact,`${column}${movedRow}`);address.displayOrder=displayOrder});
    const employment=payload.employment[index]!;
    EMPLOYMENT_FIELDS.forEach(field=>{const row=XLSX.utils.decode_cell(field.cell).r+1,cell=`${column}${row}`;(employment as unknown as Record<string,unknown>)[field.key]=field.type==='date'?date(fact,cell):field.type==='money'?number(fact,cell):text(fact,cell)});
  });
  payload.assets.forEach((asset,index)=>ASSET_COLUMNS.forEach((field,column)=>{const cell=XLSX.utils.encode_cell({r:39+index,c:column});(asset as unknown as Record<string,unknown>)[field.key]=field.type==='money'||field.type==='percentage'?number(fact,cell):field.type==='date'?date(fact,cell):text(fact,cell)}));
  payload.liabilities.forEach((liability,index)=>LIABILITY_COLUMNS.forEach((field,column)=>{const cell=XLSX.utils.encode_cell({r:52+index,c:column});(liability as unknown as Record<string,unknown>)[field.key]=field.type==='money'||field.type==='percentage'?number(fact,cell):text(fact,cell)}));
  const expenses=workbook.Sheets['Living Expenses'];
  payload.expenses=LIVING_EXPENSE_ITEMS.map(item=>({...item,expenseKey:item.key,monthlyAmount:number(expenses,item.amountCell),notes:text(expenses,item.notesCell)}));
  const summary={
    applicantsFound:payload.applicants.filter(hasContent).length,
    addressesFound:payload.addresses.filter(a=>Boolean(a.address||a.livingSituation||a.movedInDate)).length,
    employmentRecordsFound:payload.employment.filter(hasContent).length,
    assetsPopulated:payload.assets.filter(hasContent).length,
    liabilitiesPopulated:payload.liabilities.filter(hasContent).length,
    livingExpensesPopulated:payload.expenses.filter(e=>Number(e.monthlyAmount)>0||Boolean(e.notes.trim())).length,
    warnings:0,
  };
  if(!summary.applicantsFound)warnings.push('No applicant details were found.');
  summary.warnings=warnings.length;
  return {payload,summary,warnings};
}
