import axios from "axios";
import store from "../ReduxStore/store";
import { logout, setTokens } from "../ReduxFeature/Authenticate/authSlice";
import { STORAGE_KEYS } from "../constants/storage.constants";
import { ErrorMessage } from "../Utlis/Toastify/ToastMessage";
import { apiConstant } from "./apiConstant";

export const ApiRequest = axios.create({ timeout: 20000 });
let refreshPromise = null;
let refreshFailureHandled = false;

const readStorage = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};

const writeTokens = ({ accessToken, refreshToken }) => {
  localStorage.setItem(STORAGE_KEYS.accessToken, accessToken);
  localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
  store.dispatch(setTokens({ accessToken, refreshToken }));
};

export const clearStoredSession = () => {
  try {
    localStorage.removeItem(STORAGE_KEYS.accessToken);
    localStorage.removeItem(STORAGE_KEYS.refreshToken);
  } catch { /* storage may be unavailable */ }
  store.dispatch(logout());
};

const normalizeError = (error) => ({
  statusCode: error?.response?.status ?? null,
  code: error?.response?.data?.code || error?.code || "UNKNOWN_ERROR",
  message: error?.response?.data?.message || error?.message || "Unexpected error occurred.",
  errors: Array.isArray(error?.response?.data?.errors) ? error.response.data.errors : [],
  requestId: error?.response?.data?.meta?.requestId || null,
  data: error?.response?.data?.data ?? null,
});

const showApiError = (error) => {
  if (error.code === "ERR_CANCELED" || error.code === "ERR_ABORTED") return;
  if (error.code === "ERR_NETWORK") return ErrorMessage("Network error. Please check your connection.");
  if (error.statusCode === 403) return ErrorMessage(error.message || "You do not have permission to do that.");
  if (error.statusCode === 423) return ErrorMessage(error.message || "Your account is locked.");
  return ErrorMessage(error.message || "Something went wrong.");
};

const refreshTokens = async () => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = readStorage(STORAGE_KEYS.refreshToken);
      if (!refreshToken) throw new Error("No refresh token is available");
      const response = await axios.post(apiConstant.refresh, { refreshToken }, { timeout: 20000 });
      const tokens = response.data?.data;
      if (!tokens?.accessToken || !tokens?.refreshToken) throw new Error("The refresh response did not include rotated tokens");
      writeTokens(tokens);
      refreshFailureHandled = false;
      return tokens;
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
};

ApiRequest.interceptors.request.use((config) => {
  const token = readStorage(STORAGE_KEYS.accessToken);
  if (token && !config.skipAuth) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

ApiRequest.interceptors.response.use(
  (response) => {
    const hasDataEnvelope = response.data !== null
      && typeof response.data === "object"
      && Object.prototype.hasOwnProperty.call(response.data, "data");
    return {
      statusCode: response.status,
      success: response.data?.success ?? true,
      message: response.data?.message ?? null,
      raw: hasDataEnvelope ? response.data.data : response.data,
      meta: response.data?.meta ?? null,
      headers: response.headers,
    };
  },
  async (axiosError) => {
    const originalRequest = axiosError.config || {};
    const normalized = normalizeError(axiosError);
    const canRefresh = normalized.statusCode === 401 && normalized.code === "AUTH_TOKEN_EXPIRED" && !originalRequest._retried && originalRequest.url !== apiConstant.refresh;

    if (canRefresh) {
      originalRequest._retried = true;
      try {
        const { accessToken } = await refreshTokens();
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return ApiRequest(originalRequest);
      } catch (refreshError) {
        clearStoredSession();
        if (!refreshFailureHandled) {
          refreshFailureHandled = true;
          ErrorMessage("Your session has expired. Please log in again.");
        }
        return Promise.reject({ ...normalizeError(refreshError), code: "AUTH_REFRESH_INVALID", statusCode: 401 });
      }
    }

    const hasAuthHeader = Boolean(originalRequest.headers?.Authorization || originalRequest.headers?.authorization);
    if (normalized.statusCode === 401 && hasAuthHeader && !["AUTH_INVALID_CREDENTIALS", "AUTH_TOKEN_EXPIRED"].includes(normalized.code)) clearStoredSession();
    if (!originalRequest.skipErrorToast) showApiError(normalized);
    return Promise.reject(normalized);
  },
);

const apiRequest = (url, method = "Get", params = {}, _formDataFlag = false, extraHeaders = {}, responseType = "json", requestOptions = {}) => {
  const normalizedMethod = method.toLowerCase();
  const isGet = normalizedMethod === "get";
  return ApiRequest({
    url,
    method: normalizedMethod,
    headers: extraHeaders,
    params: isGet ? params : undefined,
    data: isGet ? undefined : params,
    responseType,
    ...requestOptions,
  });
};

export default apiRequest;
