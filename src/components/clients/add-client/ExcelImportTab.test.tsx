import { useState } from 'react';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import * as XLSX from 'xlsx';
import { describe,expect,it,vi } from 'vitest';
import type { ParsedExcelImport } from '@/lib/client-fact-find/excelImport';
import { ExcelImportTab } from './ExcelImportTab';

function workbook(){const book=XLSX.utils.book_new(),fact=XLSX.utils.aoa_to_sheet([]),expenses=XLSX.utils.aoa_to_sheet([]);Object.assign(fact,{C7:{t:'s',v:'Alex'},C9:{t:'s',v:'Smith'},C28:{t:'s',v:'Aurixa'},A40:{t:'s',v:'Savings'},D40:{t:'n',v:1000}});fact['!ref']='A1:J60';expenses.C5={t:'n',v:125};expenses['!ref']='A1:D55';XLSX.utils.book_append_sheet(book,fact,'Client Fact Find');XLSX.utils.book_append_sheet(book,expenses,'Living Expenses');return XLSX.write(book,{type:'array',bookType:'xlsx'}) as ArrayBuffer}
function Harness({onApply,hasFormValues=false}:{onApply:(parsed:ParsedExcelImport)=>void;hasFormValues?:boolean}){const [file,setFile]=useState<File|null>(null);return <ExcelImportTab file={file} onFileChange={setFile} hasFormValues={hasFormValues} onApply={onApply}/>}
function upload(){const bytes=workbook(),file=new File([bytes],'completed.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes});fireEvent.drop(screen.getByTestId('excel-dropzone'),{dataTransfer:{files:[file],items:[{kind:'file',type:file.type,getAsFile:()=>file}],types:['Files']}})}

describe('ExcelImportTab',()=>{
  it('parses locally and applies the complete editable payload only after review',async()=>{const onApply=vi.fn();render(<Harness onApply={onApply}/>);upload();await waitFor(()=>expect(screen.getByText('completed.xlsx')).toBeInTheDocument());expect(onApply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Review Imported Data'}));expect(onApply).toHaveBeenCalledTimes(1);expect(onApply.mock.calls[0][0].payload.applicants[0]).toMatchObject({firstName:'Alex',surname:'Smith'});expect(onApply.mock.calls[0][0].payload.employment[0].employerOrBusiness).toBe('Aurixa');expect(onApply.mock.calls[0][0].payload.assets[0].currentValue).toBe(1000);expect(onApply.mock.calls[0][0].payload.expenses[0].monthlyAmount).toBe(125)});
  it('requires confirmation before replacing entered form values',async()=>{const onApply=vi.fn();render(<Harness onApply={onApply} hasFormValues/>);upload();await screen.findByText('completed.xlsx');fireEvent.click(screen.getByRole('button',{name:'Review Imported Data'}));expect(screen.getByText('Importing this workbook will replace the current Advanced form values.')).toBeInTheDocument();expect(onApply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Import and Replace'}));expect(onApply).toHaveBeenCalledTimes(1)});
});
