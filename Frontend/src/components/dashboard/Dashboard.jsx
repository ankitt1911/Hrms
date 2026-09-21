import { useSelector } from "react-redux";
import { ROLES } from "../../constants/roles.constants";
import { selectCurrentUser } from "../../ReduxFeature/Authenticate/authSlice";
import CrmMonitorDashboard from "../crm/CrmMonitorDashboard";
import AdminOverview from "./overview/AdminOverview";

const EMPTY_USER = Object.freeze({});
const greet = (user) => `Good day, ${(user.displayName || user.email || "there").split(" ")[0]}`;

/*
 * One route, two audiences. The owner gets the workforce overview; recruiters get
 * the CRM monitor, which the server scopes to their own candidates on assigned jobs
 * and which omits the owner-only peer leaderboard and placement revenue.
 */
export default function Dashboard() {
  const user = useSelector(selectCurrentUser) || EMPTY_USER;
  if (user.role === ROLES.SUPER_ADMIN) return <AdminOverview meta="Workforce overview" title={greet(user)} />;
  return <CrmMonitorDashboard meta="My pipeline overview" title={greet(user)} />;
}
