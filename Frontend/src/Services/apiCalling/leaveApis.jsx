import { ApproveLeaveApi, CancelLeaveApi, CreateLeaveTypeApi, LeaveQueueApi, LeaveTypesApi, MyLeaveApi, RejectLeaveApi, SubmitLeaveApi } from "../apiMethod";
import { toData, toResult } from "./responseHandlers";

export const handleGetLeaveTypes = () => toData(LeaveTypesApi());
export const handleCreateLeaveType = (params) => toResult(CreateLeaveTypeApi(params));
export const handleSubmitLeave = (params) => toResult(SubmitLeaveApi(params));
export const handleGetMyLeave = (params) => toData(MyLeaveApi(params));
export const handleGetLeaveQueue = (params) => toData(LeaveQueueApi(params));
export const handleApproveLeave = (id, params = {}) => toResult(ApproveLeaveApi(id, params));
export const handleRejectLeave = (id, params) => toResult(RejectLeaveApi(id, params));
export const handleCancelLeave = (id, params) => toResult(CancelLeaveApi(id, params));
