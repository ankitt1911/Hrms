import { DeleteDocumentApi, DocumentApi, DownloadDocumentApi, UpdateDocumentScanStatusApi, UploadDocumentApi } from "../apiMethod";
import { openSignedDownload } from "../../Utlis/Common/download";
import { toData, toResult } from "./responseHandlers";

export const handleUploadDocument = (formData) => toResult(UploadDocumentApi(formData));
export const handleGetDocument = (id) => toData(DocumentApi(id));
export const handleGetDocumentDownload = (id) => toData(DownloadDocumentApi(id));
export const handleDownloadDocument = async (id) => {
  const data = await handleGetDocumentDownload(id);
  if (!data) return false;
  openSignedDownload(data);
  return true;
};
export const handleDeleteDocument = (id, params = {}) => toResult(DeleteDocumentApi(id, params));
export const handleUpdateDocumentScanStatus = (id, params) => toResult(UpdateDocumentScanStatusApi(id, params));
