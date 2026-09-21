import { AttendanceCorrectionApi, AttendanceMeHistoryApi, AttendanceMeStateApi, AttendanceRegisterApi, ClockBreakApi, ClockInApi, ClockOutApi, ClockResumeApi } from "../apiMethod";
import { toData, toResult } from "./responseHandlers";

export const handleGetAttendanceState = () => toData(AttendanceMeStateApi());
export const handleGetAttendanceMeState = handleGetAttendanceState;
export const handleClockIn = () => toResult(ClockInApi());
export const handleClockBreak = () => toResult(ClockBreakApi());
export const handleBreak = handleClockBreak;
export const handleClockResume = () => toResult(ClockResumeApi());
export const handleResume = handleClockResume;
export const handleClockOut = () => toResult(ClockOutApi());
export const handleGetMyAttendanceHistory = (params) => toData(AttendanceMeHistoryApi(params));
export const handleGetAttendanceRegister = (params) => toData(AttendanceRegisterApi(params));
export const handleCorrectAttendance = (id, params) => toResult(AttendanceCorrectionApi(id, params));
export const handleAttendanceCorrection = handleCorrectAttendance;
