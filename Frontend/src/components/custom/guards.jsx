import { useSelector } from "react-redux";
import { LockKeyhole } from "lucide-react";

export function RequireRole({ role, children }) {
  const user = useSelector((state) => state.auth?.user);
  return user?.role === role ? children : <AccessDenied />;
}

export function AccessDenied() {
  return <main className="page-content"><div className="access-denied"><LockKeyhole size={28} /><h1>This area isn’t in your workspace</h1><p>Your role does not include access to this page.</p></div></main>;
}
