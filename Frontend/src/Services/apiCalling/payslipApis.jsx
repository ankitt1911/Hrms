import { ApprovePayslipApi, DownloadPayslipApi, MyPayslipsApi, PayslipApi, PublishPayslipApi } from "../apiMethod";
import { downloadBase64File } from "../../Utlis/Common/download";
import { toData, toResult } from "./responseHandlers";

export const handleApprovePayslip = (id) => toResult(ApprovePayslipApi(id));
export const handlePublishPayslip = (id) => toResult(PublishPayslipApi(id));
export const handleGetMyPayslips = () => toData(MyPayslipsApi());
export const handleGetPayslip = (id) => toData(PayslipApi(id));
export const handleGetPayslipDownload = (id) => toData(DownloadPayslipApi(id));
// The PDF is built by the server only at this point, never stored.
export const handleDownloadPayslip = async (id) => {
  const data = await handleGetPayslipDownload(id);
  if (!data?.contentBase64) return false;
  downloadBase64File(data);
  return true;
};
