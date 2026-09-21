import { CreateEmployeeApi, EmployeeApi, EmployeeBankDetailsApi, EmployeeDocumentsApi, EmployeesApi, ResetEmployeeCredentialsApi, UpdateEmployeeApi, UpdateEmployeeBankDetailsApi, UpdateEmployeeRecruiterAccessApi, UpdateEmployeeStatusApi, UploadEmployeeDocumentApi } from "../apiMethod";
import { toData, toResult } from "./responseHandlers";

export const handleGetEmployees = (params) => toData(EmployeesApi(params));
export const handleCreateEmployee = (params) => toResult(CreateEmployeeApi(params));
export const handleGetEmployee = (id) => toData(EmployeeApi(id));
export const handleUpdateEmployee = (id, params) => toResult(UpdateEmployeeApi(id, params));
export const handleUpdateEmployeeStatus = (id, params) => toResult(UpdateEmployeeStatusApi(id, params));
export const handleUpdateEmployeeRecruiterAccess = (id, params) => toResult(UpdateEmployeeRecruiterAccessApi(id, params));
export const handleResetEmployeeCredentials = (id, idempotencyKey, body) => toResult(ResetEmployeeCredentialsApi(id, idempotencyKey, body));
export const handleGetEmployeeBankDetails = (id) => toData(EmployeeBankDetailsApi(id));
export const handleUpdateEmployeeBankDetails = (id, params) => toResult(UpdateEmployeeBankDetailsApi(id, params));
export const handleGetEmployeeDocuments = (id) => toData(EmployeeDocumentsApi(id));
export const handleUploadEmployeeDocument = (id, formData) => toResult(UploadEmployeeDocumentApi(id, formData));
