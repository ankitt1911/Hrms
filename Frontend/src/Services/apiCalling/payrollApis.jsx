import { ApprovePayrollPeriodApi, CalculatePayrollPeriodApi, CreatePayrollPeriodApi, GeneratePayslipApi, PayrollPeriodApi, PayrollPeriodsApi, ReopenPayrollPeriodApi, UpdatePayrollLineApi, UpdatePayrollLineBreakdownApi } from "../apiMethod";
import { toData, toResult } from "./responseHandlers";

export const handleCreatePayrollPeriod = (params) => toResult(CreatePayrollPeriodApi(params));
export const handleGetPayrollPeriods = (params) => toData(PayrollPeriodsApi(params));
export const handleGetPayrollPeriod = (id) => toData(PayrollPeriodApi(id));
export const handleCalculatePayrollPeriod = (id) => toResult(CalculatePayrollPeriodApi(id));
export const handleUpdatePayrollLine = (id, params) => toResult(UpdatePayrollLineApi(id, params));
export const handleApprovePayrollPeriod = (id, idempotencyKey) => toResult(ApprovePayrollPeriodApi(id, idempotencyKey));
export const handleReopenPayrollPeriod = (id, params, idempotencyKey) => toResult(ReopenPayrollPeriodApi(id, params, idempotencyKey));
export const handleGeneratePayslip = (payrollLineId) => toResult(GeneratePayslipApi(payrollLineId));
export const handleUpdatePayrollLineBreakdown = (id, params) => toResult(UpdatePayrollLineBreakdownApi(id, params));
