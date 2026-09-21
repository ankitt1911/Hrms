import { AdminDashboardApi, AdminDashboardDrilldownApi, AdminDashboardLiveApi, ExportReportApi, RecruiterDashboardApi } from "../apiMethod";
import { downloadBase64File } from "../../Utlis/Common/download";
import { toData, toResult } from "./responseHandlers";

export const handleGetAdminDashboard = (params) => toData(AdminDashboardApi(params));
export const handleGetAdminDashboardLive = () => toData(AdminDashboardLiveApi());
export const handleGetAdminDashboardDrilldown = (params) => toData(AdminDashboardDrilldownApi(params));
export const handleGetRecruiterDashboard = (params) => toData(RecruiterDashboardApi(params));
export const handleExportReport = (params) => toResult(ExportReportApi(params));
export const handleDownloadReport = async (params) => {
  const result = await handleExportReport(params);
  if (!result.ok) return result;
  downloadBase64File(result.data);
  return result;
};
