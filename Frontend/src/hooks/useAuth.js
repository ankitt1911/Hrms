import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { logout as logoutAction, selectAuth, setSession } from "../ReduxFeature/Authenticate/authSlice";
import { STORAGE_KEYS } from "../constants/storage.constants";

const persistTokens = ({ accessToken, refreshToken }) => {
  if (!accessToken || !refreshToken) throw new TypeError("A complete token pair is required");
  localStorage.setItem(STORAGE_KEYS.accessToken, accessToken);
  localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
};

const removeTokens = () => {
  localStorage.removeItem(STORAGE_KEYS.accessToken);
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
};

export default function useAuth() {
  const auth = useSelector(selectAuth);
  const dispatch = useDispatch();

  const login = useCallback((session) => {
    persistTokens(session);
    dispatch(setSession(session));
  }, [dispatch]);

  const logout = useCallback(() => {
    try { removeTokens(); } finally { dispatch(logoutAction()); }
  }, [dispatch]);

  return {
    ...auth,
    role: auth.user?.role || null,
    login,
    logout,
  };
}
