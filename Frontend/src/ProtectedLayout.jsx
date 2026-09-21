import { Navigate, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import AppLayout from "./AppLayout";
import { AccessDenied } from "./components/custom/guards";
import { ROLES } from "./constants/roles.constants";

export default function ProtectedLayout() {
  const auth = useSelector((state) => state.auth || {});
  const location = useLocation();
  if (!auth.isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (![ROLES.SUPER_ADMIN, ROLES.RECRUITER].includes(auth.user?.role)) return <AccessDenied />;
  if (auth.user?.mustChangePassword && location.pathname !== "/change-password") return <Navigate to="/change-password" replace />;
  return <AppLayout />;
}
