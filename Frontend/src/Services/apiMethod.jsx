import { apiConstant } from "./apiConstant";
import apiRequest from "./apiService";

const idempotencyHeaders = (key) => key ? { "Idempotency-Key": key } : {};

export const HealthLiveApi = () => apiRequest(apiConstant.healthLive, "Get", {}, false, {}, "json", { skipAuth: true });
export const HealthReadyApi = () => apiRequest(apiConstant.healthReady, "Get", {}, false, {}, "json", { skipAuth: true });

export const LoginApi = (params) => apiRequest(apiConstant.login, "Post", params, true, {}, "json", { skipAuth: true });
export const RefreshApi = (params) => apiRequest(apiConstant.refresh, "Post", params, true, {}, "json", { skipAuth: true });
export const LogoutApi = () => apiRequest(apiConstant.logout, "Post", {});
export const LogoutAllApi = () => apiRequest(apiConstant.logoutAll, "Post", {});
export const ForgotPasswordApi = (params) => apiRequest(apiConstant.forgotPassword, "Post", params, true, {}, "json", { skipAuth: true });
export const RequestOtpApi = (params) => apiRequest(apiConstant.requestOtp, "Post", params, true, {}, "json", { skipAuth: true });
export const VerifyOtpApi = (params) => apiRequest(apiConstant.verifyOtp, "Post", params, true, {}, "json", { skipAuth: true });
export const ResetPasswordApi = (params) => apiRequest(apiConstant.resetPassword, "Post", params, true, {}, "json", { skipAuth: true });
export const ChangePasswordApi = (params) => apiRequest(apiConstant.changePassword, "Post", params, true);
export const SessionsApi = () => apiRequest(apiConstant.sessions, "Get");
export const RevokeSessionApi = (id) => apiRequest(apiConstant.revokeSession(id), "Delete");
export const MeApi = () => apiRequest(apiConstant.me, "Get");
export const UpdateMeApi = (params) => apiRequest(apiConstant.me, "Patch", params, true);

export const CompanyApi = () => apiRequest(apiConstant.company, "Get");
export const UpdateCompanyApi = (params) => apiRequest(apiConstant.company, "Patch", params, true);

export const EmployeesApi = (params) => apiRequest(apiConstant.employees, "Get", params);
export const CreateEmployeeApi = (params) => apiRequest(apiConstant.employees, "Post", params, true);
export const EmployeeApi = (id) => apiRequest(apiConstant.employee(id), "Get");
export const UpdateEmployeeApi = (id, params) => apiRequest(apiConstant.employee(id), "Patch", params, true);
export const UpdateEmployeeStatusApi = (id, params) => apiRequest(apiConstant.employeeStatus(id), "Patch", params, true);
export const UpdateEmployeeRecruiterAccessApi = (id, params) => apiRequest(apiConstant.employeeRecruiterAccess(id), "Patch", params, true);
export const ResetEmployeeCredentialsApi = (id, key, body = {}) => apiRequest(apiConstant.employeeCredentialsReset(id), "Post", body, false, idempotencyHeaders(key));
export const EmployeeBankDetailsApi = (id) => apiRequest(apiConstant.employeeBankDetails(id), "Get");
export const UpdateEmployeeBankDetailsApi = (id, params) => apiRequest(apiConstant.employeeBankDetails(id), "Patch", params, true);
export const EmployeeDocumentsApi = (id) => apiRequest(apiConstant.employeeDocuments(id), "Get");
export const UploadEmployeeDocumentApi = (id, formData) => apiRequest(apiConstant.employeeDocuments(id), "Post", formData, true);

export const AttendanceMeStateApi = () => apiRequest(apiConstant.attendanceMeState, "Get");
export const ClockInApi = () => apiRequest(apiConstant.attendanceClockIn, "Post", {});
export const ClockBreakApi = () => apiRequest(apiConstant.attendanceBreak, "Post", {});
export const ClockResumeApi = () => apiRequest(apiConstant.attendanceResume, "Post", {});
export const ClockOutApi = () => apiRequest(apiConstant.attendanceClockOut, "Post", {});
export const AttendanceMeHistoryApi = (params) => apiRequest(apiConstant.attendanceMeHistory, "Get", params);
export const AttendanceRegisterApi = (params) => apiRequest(apiConstant.attendanceRegister, "Get", params);
export const AttendanceCorrectionApi = (id, params) => apiRequest(apiConstant.attendanceCorrection(id), "Patch", params, true);

export const LeaveTypesApi = () => apiRequest(apiConstant.leaveTypes, "Get");
export const CreateLeaveTypeApi = (params) => apiRequest(apiConstant.leaveTypes, "Post", params, true);
export const SubmitLeaveApi = (params) => apiRequest(apiConstant.leaveRequests, "Post", params, true);
export const MyLeaveApi = (params) => apiRequest(apiConstant.leaveRequestsMe, "Get", params);
export const LeaveQueueApi = (params) => apiRequest(apiConstant.leaveRequests, "Get", params);
export const ApproveLeaveApi = (id, params = {}) => apiRequest(apiConstant.leaveApprove(id), "Post", params, true);
export const RejectLeaveApi = (id, params) => apiRequest(apiConstant.leaveReject(id), "Post", params, true);
export const CancelLeaveApi = (id, params) => apiRequest(apiConstant.leaveCancel(id), "Post", params, true);

export const CreatePayrollPeriodApi = (params) => apiRequest(apiConstant.payrollPeriods, "Post", params, true);
export const PayrollPeriodsApi = (params) => apiRequest(apiConstant.payrollPeriods, "Get", params);
export const PayrollPeriodApi = (id) => apiRequest(apiConstant.payrollPeriod(id), "Get");
export const CalculatePayrollPeriodApi = (id) => apiRequest(apiConstant.payrollCalculate(id), "Post", {});
export const UpdatePayrollLineApi = (id, params) => apiRequest(apiConstant.payrollLine(id), "Patch", params, true);
export const ApprovePayrollPeriodApi = (id, key) => apiRequest(apiConstant.payrollApprove(id), "Post", {}, false, idempotencyHeaders(key));
export const ReopenPayrollPeriodApi = (id, params, key) => apiRequest(apiConstant.payrollReopen(id), "Post", params, true, idempotencyHeaders(key));
export const UpdatePayrollLineBreakdownApi = (id, params) => apiRequest(apiConstant.payrollLineBreakdown(id), "Patch", params, true);
export const GeneratePayslipApi = (id) => apiRequest(apiConstant.payrollLinePayslip(id), "Post", {});
export const ApprovePayslipApi = (id) => apiRequest(apiConstant.payslipApprove(id), "Post", {});
export const PublishPayslipApi = (id) => apiRequest(apiConstant.payslipPublish(id), "Post", {});
export const MyPayslipsApi = () => apiRequest(apiConstant.payslipsMe, "Get");
export const PayslipApi = (id) => apiRequest(apiConstant.payslip(id), "Get");
export const DownloadPayslipApi = (id) => apiRequest(apiConstant.payslipDownload(id), "Get");

export const VendorsApi = (params) => apiRequest(apiConstant.vendors, "Get", params);
export const CreateVendorApi = (params) => apiRequest(apiConstant.vendors, "Post", params, true);
export const VendorApi = (id) => apiRequest(apiConstant.vendor(id), "Get");
export const UpdateVendorApi = (id, params) => apiRequest(apiConstant.vendor(id), "Patch", params, true);
export const VendorDocumentsApi = (id) => apiRequest(apiConstant.vendorDocuments(id), "Get");
export const UploadVendorDocumentApi = (id, formData) => apiRequest(apiConstant.vendorDocuments(id), "Post", formData, true);
export const JobOpeningsApi = (params) => apiRequest(apiConstant.jobOpenings, "Get", params);
export const CreateJobOpeningApi = (params) => apiRequest(apiConstant.jobOpenings, "Post", params, true);
export const JobOpeningApi = (id) => apiRequest(apiConstant.jobOpening(id), "Get");
export const UpdateJobOpeningApi = (id, params) => apiRequest(apiConstant.jobOpening(id), "Patch", params, true);
export const UpdateJobOpeningStatusApi = (id, params) => apiRequest(apiConstant.jobOpeningStatus(id), "Patch", params, true);
export const UpdateJobOpeningRecruitersApi = (id, params) => apiRequest(apiConstant.jobOpeningRecruiters(id), "Patch", params, true);

export const CrmCandidatesApi = (params) => apiRequest(apiConstant.crmCandidates, "Get", params);
export const CreateCrmCandidateApi = (params) => apiRequest(apiConstant.crmCandidates, "Post", params, true);
export const CrmCandidateApi = (id) => apiRequest(apiConstant.crmCandidate(id), "Get");
export const UpdateCrmCandidateApi = (id, params) => apiRequest(apiConstant.crmCandidate(id), "Patch", params, true);
export const TransitionCrmCandidateStageApi = (id, params) => apiRequest(apiConstant.crmCandidateStage(id), "Post", params, true);
export const UpdateCrmCandidateInterviewApi = (id, params) => apiRequest(apiConstant.crmCandidateInterview(id), "Patch", params, true);
export const CrmCandidateHistoryApi = (id) => apiRequest(apiConstant.crmCandidateHistory(id), "Get");
export const UpdateCrmCandidateRecruiterApi = (id, params) => apiRequest(apiConstant.crmCandidateRecruiter(id), "Patch", params, true);
export const CrmCandidateProfilesApi = (params) => apiRequest(apiConstant.crmCandidateProfiles, "Get", params);
export const CreateCrmCandidateProfileApi = (params) => apiRequest(apiConstant.crmCandidateProfiles, "Post", params, true);
export const CrmCandidateProfileApi = (id) => apiRequest(apiConstant.crmCandidateProfile(id), "Get");
export const UpdateCrmCandidateProfileApi = (id, params) => apiRequest(apiConstant.crmCandidateProfile(id), "Patch", params, true);
export const AssignCrmCandidateProfilesApi = (params) => apiRequest(apiConstant.crmCandidateProfilesAssign, "Post", params, true);
export const SubmitCrmCandidateProfileApi = (id, params) => apiRequest(apiConstant.crmCandidateProfileSubmit(id), "Post", params, true);
export const CrmMonitoringApi = (params) => apiRequest(apiConstant.crmMonitoring, "Get", params);
export const CrmMonitoringAnalyticsApi = (params) => apiRequest(apiConstant.crmMonitoringAnalytics, "Get", params);
export const CrmMonitoringDrilldownApi = (params) => apiRequest(apiConstant.crmMonitoringDrilldown, "Get", params);

export const PlacementsApi = (params) => apiRequest(apiConstant.placements, "Get", params);
export const PlacementApi = (id) => apiRequest(apiConstant.placement(id), "Get");
export const UpdatePlacementJoiningApi = (id, params) => apiRequest(apiConstant.placementJoining(id), "Patch", params, true);
export const OverridePlacementInvoiceDateApi = (id, params) => apiRequest(apiConstant.placementInvoiceOverride(id), "Patch", params, true);
export const GenerateInvoiceApi = (id) => apiRequest(apiConstant.placementInvoiceGenerate(id), "Post", {});
export const MarkInvoiceReadyApi = (id) => apiRequest(apiConstant.placementInvoiceReady(id), "Post", {});
export const RaiseInvoiceApi = (id, params, key) => apiRequest(apiConstant.placementInvoiceRaise(id), "Post", params, true, idempotencyHeaders(key));
export const ReverseInvoiceApi = (id, params) => apiRequest(apiConstant.placementInvoiceReverse(id), "Post", params, true);
export const PlacementInvoiceDraftApi = (id) => apiRequest(apiConstant.placementInvoiceDraft(id), "Get");
export const PreviewInvoiceApi = (id, params) => apiRequest(apiConstant.placementInvoicePreview(id), "Post", params, true);
export const SaveInvoiceApi = (id, params) => apiRequest(apiConstant.placementInvoiceSave(id), "Post", params, true);
export const DownloadInvoiceApi = (id) => apiRequest(apiConstant.placementInvoiceDownload(id), "Get");
export const MarkInvoicePaidApi = (id) => apiRequest(apiConstant.placementInvoicePaid(id), "Post", {});

export const MessagePartnersApi = () => apiRequest(apiConstant.messagePartners, "Get");
export const CreateConversationApi = (params) => apiRequest(apiConstant.conversations, "Post", params, true);
export const ConversationsApi = () => apiRequest(apiConstant.conversations, "Get");
export const ConversationMessagesApi = (id, params) => apiRequest(apiConstant.conversation(id), "Get", params);
export const SendConversationMessageApi = (id, params) => apiRequest(apiConstant.conversationMessages(id), "Post", params, true);
export const MarkConversationReadApi = (id) => apiRequest(apiConstant.conversationRead(id), "Post", {});
export const AdminConversationsApi = (params) => apiRequest(apiConstant.adminConversations, "Get", params);

export const NotificationsApi = (params) => apiRequest(apiConstant.notifications, "Get", params);
export const MarkNotificationReadApi = (id) => apiRequest(apiConstant.notificationRead(id), "Post", {});
export const MarkAllNotificationsReadApi = () => apiRequest(apiConstant.notificationsReadAll, "Post", {});

export const UploadDocumentApi = (formData) => apiRequest(apiConstant.documents, "Post", formData, true);
export const DocumentApi = (id) => apiRequest(apiConstant.document(id), "Get");
export const DownloadDocumentApi = (id) => apiRequest(apiConstant.documentDownload(id), "Get");
export const DeleteDocumentApi = (id, params = {}) => apiRequest(apiConstant.document(id), "Delete", params, true);
export const UpdateDocumentScanStatusApi = (id, params) => apiRequest(apiConstant.documentScanStatus(id), "Patch", params, true);

export const AuditEventsApi = (params) => apiRequest(apiConstant.auditEvents, "Get", params);
export const AdminDashboardApi = (params) => apiRequest(apiConstant.dashboardAdmin, "Get", params);
export const AdminDashboardLiveApi = () => apiRequest(apiConstant.dashboardAdminLive, "Get");
export const AdminDashboardDrilldownApi = (params) => apiRequest(apiConstant.dashboardAdminDrilldown, "Get", params);
export const RecruiterDashboardApi = (params) => apiRequest(apiConstant.dashboardRecruiter, "Get", params);
export const ExportReportApi = (params) => apiRequest(apiConstant.reportsExport, "Post", params, true);
