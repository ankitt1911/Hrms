import { AuditEventsApi } from "../apiMethod";
import { toData } from "./responseHandlers";

export const handleGetAuditEvents = (params) => toData(AuditEventsApi(params));
