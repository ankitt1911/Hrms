import { ChangePasswordApi, ForgotPasswordApi, LoginApi, LogoutAllApi, LogoutApi, MeApi, RefreshApi, RequestOtpApi, ResetPasswordApi, RevokeSessionApi, SessionsApi, UpdateMeApi, VerifyOtpApi } from "../apiMethod";
import { toData, toResult } from "./responseHandlers";

export const handleLogin = (params) => toResult(LoginApi(params));
export const handleRefresh = (params) => toResult(RefreshApi(params));
export const handleLogout = () => toResult(LogoutApi());
export const handleLogoutAll = () => toResult(LogoutAllApi());
export const handleForgotPassword = (params) => toResult(ForgotPasswordApi(params));
export const handleRequestOtp = (params) => toResult(RequestOtpApi(params));
export const handleVerifyOtp = (params) => toResult(VerifyOtpApi(params));
export const handleResetPassword = (params) => toResult(ResetPasswordApi(params));
export const handleChangePassword = (params) => toResult(ChangePasswordApi(params));
export const handleGetSessions = () => toData(SessionsApi());
export const handleRevokeSession = (id) => toResult(RevokeSessionApi(id));
export const handleGetMe = () => toData(MeApi());
export const handleUpdateMe = (params) => toResult(UpdateMeApi(params));
