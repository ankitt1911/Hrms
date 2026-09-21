import { createSlice } from "@reduxjs/toolkit";
import { STORAGE_KEYS } from "../../constants/storage.constants";

const getStoredToken = (key) => {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(key); } catch { return null; }
};

const initialState = {
  isAuthenticated: Boolean(getStoredToken(STORAGE_KEYS.accessToken)),
  accessToken: getStoredToken(STORAGE_KEYS.accessToken),
  refreshToken: getStoredToken(STORAGE_KEYS.refreshToken),
  user: null,
  isAuthChecked: false,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setSession: (state, { payload }) => {
      state.accessToken = payload.accessToken;
      state.refreshToken = payload.refreshToken;
      state.user = payload.user || null;
      state.isAuthenticated = Boolean(payload.accessToken);
      state.isAuthChecked = true;
    },
    setTokens: (state, { payload }) => {
      state.accessToken = payload.accessToken;
      state.refreshToken = payload.refreshToken;
      state.isAuthenticated = Boolean(payload.accessToken);
    },
    setUser: (state, { payload }) => { state.user = payload; state.isAuthenticated = Boolean(state.accessToken); },
    setAuthChecked: (state, { payload = true }) => { state.isAuthChecked = payload; },
    logout: () => ({ ...initialState, accessToken: null, refreshToken: null, user: null, isAuthenticated: false, isAuthChecked: true }),
  },
});

export const { setSession, setTokens, setUser, setAuthChecked, logout } = authSlice.actions;
export const selectAuth = (state) => state.auth;
export const selectCurrentUser = (state) => state.auth.user;
export const selectRole = (state) => state.auth.user?.role || null;
export const selectIsAuthenticated = (state) => state.auth.isAuthenticated;
export default authSlice.reducer;
