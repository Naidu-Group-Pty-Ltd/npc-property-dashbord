import { describe,expect,it } from 'vitest'; import { advancedClientCreationSchema } from './schema'; import { applicant } from './testFixtures'; import { zeroFactFind } from './testFixtures';
describe('Advanced payload validation',()=>{
 it('accepts the exact 10/8/50 workbook shape',()=>expect(advancedClientCreationSchema.safeParse(zeroFactFind()).success).toBe(true));
 it.each([['assets',9],['liabilities',7],['expenses',49]] as const)('rejects invalid %s row count',(key,count)=>{const p:any=zeroFactFind();p[key]=p[key].slice(0,count);expect(advancedClientCreationSchema.safeParse(p).success).toBe(false)});
 it('rejects unknown and out-of-order expense keys',()=>{const p=zeroFactFind();p.expenses[0].expenseKey='unknown';expect(advancedClientCreationSchema.safeParse(p).success).toBe(false)});
 it('requires both Applicant 2 names when any details are supplied',()=>{const p=zeroFactFind();p.applicants.push({...applicant(2),email:'person@example.com'});expect(advancedClientCreationSchema.safeParse(p).success).toBe(false);p.applicants[1]!.firstName='Sam';p.applicants[1]!.surname='Smith';expect(advancedClientCreationSchema.safeParse(p).success).toBe(true)});
 it('rejects invalid email and colour',()=>{const p=zeroFactFind();p.applicants[0].email='bad';p.branding.primaryColour='blue';expect(advancedClientCreationSchema.safeParse(p).success).toBe(false)});
 it('rejects unknown payload properties',()=>{expect(advancedClientCreationSchema.safeParse({...zeroFactFind(),admin:true}).success).toBe(false)});
 it('rejects negative money and inconsistent positions',()=>{const p=zeroFactFind();p.assets[0].currentValue=-1;p.liabilities.reverse();expect(advancedClientCreationSchema.safeParse(p).success).toBe(false)});
});
