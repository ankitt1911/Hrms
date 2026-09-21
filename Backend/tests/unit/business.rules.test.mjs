import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { createRequire } from 'node:module';
import rules from '../../src/modules/business/rules.js';
import payrollService from '../../src/modules/business/payroll.service.js';
const require = createRequire(import.meta.url);
const { migrationPatch } = require('../../scripts/maintenance/migrate-candidate-workflow.js');
const { payrollFormula, canTransitionCandidate, addClauseDays, deriveInvoiceState, canonicalParticipants, isObjectId, serialize, publicJob } = rules;

describe('business rules', () => {
  it('calculates hourly payroll without floating point drift', () => {
    expect(payrollFormula({ salaryType: 'HOURLY', hourlyRate: '123.45', workedHours: '160.5', deductionPct: '10', extraDeductions: '25.10' })).toEqual({
      workedHours: '160.50', grossPay: '19813.73', basicPay: '9906.86', allowances: '9906.86', deductions: '2006.47', netPay: '17807.25', extraDeductions: '25.10',
    });
  });

  it('caps salaried gross and clamps negative net to zero', () => {
    const result = payrollFormula({ salaryType: 'SALARIED', monthlyCtc: '5000', workedHours: '300', salariedHoursBase: '208', deductionPct: '10', extraDeductions: '99999' });
    expect(result.grossPay).toBe('5000.00'); expect(result.netPay).toBe('0.00');
  });

  it('pays a per-joining recruiter at the rate matching each joined candidate’s job type', () => {
    const result = payrollFormula({ salaryType: 'PER_JOINING', itJoiningRate: '5000', nonItJoiningRate: '3000', itJoinings: '3', nonItJoinings: '2', workedHours: '0', deductionPct: '10' });
    expect(result.grossPay).toBe('21000.00'); // 3 x 5000 + 2 x 3000
    expect(result.basicPay).toBe('21000.00');
    expect(result.allowances).toBe('0.00');
    expect(result.deductions).toBe('2100.00');
    expect(result.netPay).toBe('18900.00');
  });

  it('pays nothing for a per-joining recruiter with no joinings in the period', () => {
    expect(payrollFormula({ salaryType: 'PER_JOINING', itJoiningRate: '5000', nonItJoiningRate: '3000', workedHours: '0' }).netPay).toBe('0.00');
  });

  it('builds salaried gross from the configured earnings and deduction rows', () => {
    const result = payrollFormula({
      salaryType: 'SALARIED', monthlyCtc: '99999', workedHours: '208', salariedHoursBase: '208',
      earnings: [{ label: 'Basic', amount: '20000' }, { label: 'HRA', amount: '8000' }, { label: 'Special Allowance', amount: '2000' }],
      deductionItems: [{ label: 'Professional Tax', amount: '200' }],
    });
    expect(result.grossPay).toBe('30000.00'); // the rows win over monthlyCtc
    expect(result.basicPay).toBe('20000.00'); // the row named Basic, not half of gross
    expect(result.allowances).toBe('10000.00');
    expect(result.deductions).toBe('200.00'); // the row, not the 10% default
    expect(result.netPay).toBe('29800.00');
  });

  it('pro-rates a configured pay structure by attendance and keeps the percentage default without rows', () => {
    const half = payrollFormula({ salaryType: 'SALARIED', workedHours: '104', salariedHoursBase: '208', earnings: [{ label: 'Basic', amount: '20000' }, { label: 'HRA', amount: '10000' }], deductionPct: '10' });
    expect(half.grossPay).toBe('15000.00');
    expect(half.basicPay).toBe('10000.00');
    expect(half.deductions).toBe('1500.00'); // no deduction rows, so 10% still applies
    const legacy = payrollFormula({ salaryType: 'SALARIED', monthlyCtc: '30000', workedHours: '208', salariedHoursBase: '208', deductionPct: '10' });
    expect(legacy).toMatchObject({ grossPay: '30000.00', basicPay: '15000.00', deductions: '3000.00' });
  });

  it('enforces forward-only candidate stage transitions and pause states', () => {
    expect(canTransitionCandidate('NEW_LEAD', 'SELECTED', 0)).toBe(true);
    expect(canTransitionCandidate('NEW_LEAD', 'JOINED', 0)).toBe(false);
    expect(canTransitionCandidate('INTERESTED', 'CALLED', 2)).toBe(false);
    expect(canTransitionCandidate('RNR', 'CALLED', 1)).toBe(true);
    expect(canTransitionCandidate('ON_HOLD', 'INTERVIEW_SCHEDULED', 3)).toBe(true);
    expect(canTransitionCandidate('NOT_INTERESTED', 'SHORTLISTED', 2)).toBe(false);
    expect(canTransitionCandidate('REJECTED', 'JOINED', 4)).toBe(false);
  });

  it('maps legacy candidate stages and languages without rewriting history', () => {
    const history = [{ toStage: 'CONTACTED' }, { toStage: 'INTERVIEWED' }];
    expect(migrationPatch({ stage: 'INTERVIEWED', language: 'English, German', stageHistory: history })).toEqual({
      stage: 'INTERVIEW_SCHEDULED', progressionRank: 4, candidateType: 'NON_IT', languages: ['ENGLISH', 'OTHER'], otherLanguage: 'German',
    });
    expect(history).toEqual([{ toStage: 'CONTACTED' }, { toStage: 'INTERVIEWED' }]);
  });

  it('calculates invoice dates in UTC and derives state', () => {
    const due = addClauseDays('2026-01-31T00:00:00.000Z', 45);
    expect(due.toISOString()).toBe('2026-03-17T00:00:00.000Z');
    expect(deriveInvoiceState({ actualDoj: new Date(), invoiceDueDate: due, invoiceState: 'NOT_READY' }, new Date('2026-03-16T23:59:59Z'))).toBe('FUTURE_DUE');
    expect(deriveInvoiceState({ actualDoj: new Date(), invoiceDueDate: due, invoiceState: 'NOT_READY' }, new Date('2026-03-17T00:00:00Z'))).toBe('DUE');
    expect(deriveInvoiceState({ invoiceState: 'RAISED' })).toBe('RAISED');
    expect(deriveInvoiceState({ invoiceState: 'PAID' })).toBe('PAID');
  });

  it('canonicalizes conversation IDs and validates ObjectIds', () => {
    const a = new mongoose.Types.ObjectId().toString(); const b = new mongoose.Types.ObjectId().toString();
    expect(canonicalParticipants(b, a)).toEqual([a, b].sort());
    expect(isObjectId(a)).toBe(true); expect(isObjectId('not-an-id')).toBe(false);
    expect(() => canonicalParticipants(a, a)).toThrow();
  });

  it('serializes Decimal128/ObjectId and never leaks internal job payment', () => {
    const id = new mongoose.Types.ObjectId(); const output = serialize({ _id: id, amount: mongoose.Types.Decimal128.fromString('10.25') });
    expect(output).toEqual({ _id: id.toString(), amount: '10.25' });
    expect(publicJob({ title: 'Safe', internalPaymentDetails: { fee: 100 } })).toEqual({ title: 'Safe' });
  });

  it('builds a private-storage-ready payslip PDF', () => {
    const pdf = payrollService.simplePdf(['Payslip', 'Net pay: 1000.00']);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString().endsWith('%%EOF')).toBe(true);
  });
});
