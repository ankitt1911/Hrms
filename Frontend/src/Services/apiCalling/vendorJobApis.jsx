import { CreateJobOpeningApi, CreateVendorApi, JobOpeningApi, JobOpeningsApi, UpdateJobOpeningApi, UpdateJobOpeningRecruitersApi, UpdateJobOpeningStatusApi, UpdateVendorApi, UploadVendorDocumentApi, VendorApi, VendorDocumentsApi, VendorsApi } from "../apiMethod";
import { toData, toResult } from "./responseHandlers";

export const handleGetVendors = (params) => toData(VendorsApi(params));
export const handleCreateVendor = (params) => toResult(CreateVendorApi(params));
export const handleGetVendor = (id) => toData(VendorApi(id));
export const handleUpdateVendor = (id, params) => toResult(UpdateVendorApi(id, params));
export const handleGetVendorDocuments = (id) => toData(VendorDocumentsApi(id));
export const handleUploadVendorDocument = (id, formData) => toResult(UploadVendorDocumentApi(id, formData));
export const handleGetJobOpenings = (params) => toData(JobOpeningsApi(params));
export const handleCreateJobOpening = (params) => toResult(CreateJobOpeningApi(params));
export const handleGetJobOpening = (id) => toData(JobOpeningApi(id));
export const handleUpdateJobOpening = (id, params) => toResult(UpdateJobOpeningApi(id, params));
export const handleUpdateJobOpeningStatus = (id, params) => toResult(UpdateJobOpeningStatusApi(id, params));
export const handleUpdateJobOpeningRecruiters = (id, params) => toResult(UpdateJobOpeningRecruitersApi(id, params));
