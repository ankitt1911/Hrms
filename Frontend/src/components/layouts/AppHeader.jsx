import { Bell, LogOut, Menu, Search } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { handleLogout } from "../../Services/apiCalling/authApis";
import { clearStoredSession } from "../../Services/apiService";

const titleMap = { profile: "My profile", employees: "Employees", attendance: "Attendance", leave: "Leave", payroll: "Payroll", payslips: "Payslips", vendors: "Vendors", jobs: "Job openings", crm: "Recruitment CRM", placements: "Placements", messages: "Messages", notifications: "Notifications", documents: "Documents", audit: "Audit trail", reports: "Reports", admin: "Administration" };

export default function AppHeader({ onMenu }) {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();
  const unread = useSelector((state) => state.notifications?.unreadCount || 0);
  const section = location.pathname.split("/").filter(Boolean)[0];
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const signOut = async () => { try { await handleLogout(); } finally { clearStoredSession(); dispatch({ type: "notifications/clearUnreadCount" }); navigate("/login", { replace: true }); } };
  return <header className="app-header"><div className="app-header__title"><button type="button" className="icon-button menu-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button><div><span>{titleMap[section] || "Workspace"}</span><small>{today}</small></div></div><div className="global-search"><Search size={17} /><input aria-label="Search workspace" placeholder="Search the workspace" /><kbd aria-hidden="true">⌘ K</kbd></div><button type="button" className="notification-button" onClick={() => navigate("/notifications")} aria-label={`${unread} unread notifications`}><Bell size={19} />{unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}</button><button type="button" className="icon-button header-logout" onClick={signOut} aria-label="Sign out"><LogOut size={18}/></button></header>;
}
