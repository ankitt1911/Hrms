import { DownloadInvoiceApi, GenerateInvoiceApi, MarkInvoicePaidApi, MarkInvoiceReadyApi, OverridePlacementInvoiceDateApi, PlacementApi, PlacementInvoiceDraftApi, PlacementsApi, PreviewInvoiceApi, RaiseInvoiceApi, ReverseInvoiceApi, SaveInvoiceApi, UpdatePlacementJoiningApi } from "../apiMethod";
import { downloadBase64File } from "../../Utlis/Common/download";
import { toData, toResult } from "./responseHandlers";

export const handleGetPlacements = (params) => toData(PlacementsApi(params));
export const handleGetPlacement = (id) => toData(PlacementApi(id));
export const handleUpdatePlacementJoining = (id, params) => toResult(UpdatePlacementJoiningApi(id, params));
export const handleOverridePlacementInvoiceDate = (id, params) => toResult(OverridePlacementInvoiceDateApi(id, params));
export const handleGenerateInvoice = (id) => toResult(GenerateInvoiceApi(id));
export const handleMarkInvoiceReady = (id) => toResult(MarkInvoiceReadyApi(id));
export const handleRaiseInvoice = (id, params, idempotencyKey) => toResult(RaiseInvoiceApi(id, params, idempotencyKey));
export const handleReverseInvoice = (id, params) => toResult(ReverseInvoiceApi(id, params));
export const handleMarkInvoicePaid = (id) => toResult(MarkInvoicePaidApi(id));

export const handleGetInvoiceDraft = (id) => toData(PlacementInvoiceDraftApi(id));
export const handleSaveInvoice = (id, params) => toResult(SaveInvoiceApi(id, params));
// Both render a PDF on the server, on demand — never stored — and hand it back as base64.
export const handlePreviewInvoice = async (id, params) => {
  const data = await toData(PreviewInvoiceApi(id, params));
  if (!data?.contentBase64) return false;
  downloadBase64File(data);
  return true;
};
export const handleDownloadInvoice = async (id) => {
  const data = await toData(DownloadInvoiceApi(id));
  if (!data?.contentBase64) return false;
  downloadBase64File(data);
  return true;
};
