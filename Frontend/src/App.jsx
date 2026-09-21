import { Component, lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import ProtectedLayout from "./ProtectedLayout";
import PageLoader from "./components/loader/PageLoader";
import { RequireRole } from "./components/custom/guards";
import { LoginPage, ResetPasswordPage, ChangePasswordPage } from "./pages/auth/loginPage";
import { handleGetMe } from "./Services/apiCalling/authApis";
import { logout, setAuthChecked, setUser } from "./ReduxFeature/Authenticate/authSlice";
import { ROLES } from "./constants/roles.constants";

const lazyNamed = (factory, name) => lazy(async () => {
  const module = await factory();
  return { default: module[name] };
});

const DashboardPage = lazy(() => import("./components/dashboard/Dashboard"));
const MyAttendancePage = lazyNamed(() => import("./components/attendance/Attendance"), "MyAttendance");
const AttendanceRegisterPage = lazyNamed(() => import("./components/attendance/Attendance"), "AttendanceRegister");
const MyLeavePage = lazyNamed(() => import("./components/workspaces/CoreWorkspaces"), "MyLeaveWorkspace");
const LeaveQueuePage = lazyNamed(() => import("./components/workspaces/CoreWorkspaces"), "LeaveQueueWorkspace");
const EmployeesPage = lazyNamed(() => import("./components/workspaces/CoreWorkspaces"), "EmployeesWorkspace");
const EmployeeDetailPage = lazyNamed(() => import("./components/workspaces/CoreWorkspaces"), "EmployeeDetail");
const MyProfilePage = lazyNamed(() => import("./components/workspaces/CoreWorkspaces"), "MyProfile");
const PayrollPage = lazyNamed(() => import("./components/payroll/Payroll"), "PayrollPeriods");
const PayrollDetailPage = lazyNamed(() => import("./components/payroll/Payroll"), "PayrollDetail");
const PayslipsPage = lazyNamed(() => import("./components/payroll/Payroll"), "Payslips");
const VendorsPage = lazyNamed(() => import("./components/workspaces/CoreWorkspaces"), "VendorsWorkspace");
const VendorDetailPage = lazyNamed(() => import("./components/workspaces/CoreWorkspaces"), "VendorDetail");
const JobsPage = lazyNamed(() => import("./components/workspaces/CoreWorkspaces"), "JobsWorkspace");
const CrmPipelinePage = lazyNamed(() => import("./components/crm/Crm"), "CrmPipeline");
const CandidateBucketPage = lazyNamed(() => import("./components/crm/Crm"), "CandidateBucketWorkspace");
const CrmMonitoringPage = lazyNamed(() => import("./components/crm/Crm"), "CrmMonitoring");
const CandidatePoolPage = lazyNamed(() => import("./components/crm/CandidatePool"), "CandidatePoolWorkspace");
const AssignedCandidatesPage = lazyNamed(() => import("./components/crm/CandidatePool"), "AssignedCandidatesWorkspace");
const CandidateCalendarPage = lazy(() => import("./components/crm/CandidateCalendar"));
const PlacementsPage = lazy(() => import("./components/placements/Placements"));
const MessagesPage = lazy(() => import("./components/messages/Messages"));
const NotificationsPage = lazy(() => import("./components/notifications/Notifications"));
const DocumentsPage = lazy(() => import("./components/documents/Documents"));
const AuditPage = lazyNamed(() => import("./components/workspaces/CoreWorkspaces"), "AuditWorkspace");
const ReportsPage = lazyNamed(() => import("./components/workspaces/CoreWorkspaces"), "ReportsWorkspace");
const CompanyPage = lazyNamed(() => import("./components/workspaces/CoreWorkspaces"), "CompanyWorkspace");

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) { return { error }; }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="page-content"><div className="access-denied" role="alert"><h1>This page could not be displayed</h1><p>The rest of your workspace is safe. Reload this page to try again.</p><button className="button button--primary" type="button" onClick={() => window.location.reload()}>Reload page</button></div></main>;
  }
}

function ResettingRouteBoundary({ children }) {
  const location = useLocation();
  return <RouteErrorBoundary key={location.pathname}>{children}</RouteErrorBoundary>;
}

const NotFoundPage = () => <main className="page-content"><div className="access-denied"><h1>Page not found</h1><p>The page may have moved or may not be part of your workspace.</p><Link className="button button--primary" to="/dashboard">Return to dashboard</Link></div></main>;
const Gate = ({ role, children }) => <RequireRole role={role}>{children}</RequireRole>;

export default function App() {
  const dispatch = useDispatch();
  const auth = useSelector((state) => state.auth);
  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      if (!auth.accessToken) return dispatch(setAuthChecked(true));
      try { const user = await handleGetMe(); if (active) dispatch(setUser(user)); }
      catch { if (active) dispatch(logout()); }
      finally { if (active) dispatch(setAuthChecked(true)); }
    };
    bootstrap(); return () => { active = false; };
  }, [auth.accessToken, dispatch]);
  if (!auth.isAuthChecked) return <PageLoader />;
  return <BrowserRouter><Suspense fallback={<PageLoader />}><ResettingRouteBoundary><Routes>
    <Route path="/login" element={auth.isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route element={<ProtectedLayout />}>
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/attendance/me" element={<Gate role={ROLES.RECRUITER}><MyAttendancePage /></Gate>} />
      <Route path="/profile" element={<Gate role={ROLES.RECRUITER}><MyProfilePage /></Gate>} />
      <Route path="/attendance" element={<Gate role={ROLES.SUPER_ADMIN}><AttendanceRegisterPage /></Gate>} />
      <Route path="/leave/me" element={<Gate role={ROLES.RECRUITER}><MyLeavePage /></Gate>} />
      <Route path="/leave/queue" element={<Gate role={ROLES.SUPER_ADMIN}><LeaveQueuePage /></Gate>} />
      <Route path="/employees" element={<Gate role={ROLES.SUPER_ADMIN}><EmployeesPage /></Gate>} />
      <Route path="/employees/:id" element={<EmployeeDetailPage />} />
      <Route path="/payroll" element={<Gate role={ROLES.SUPER_ADMIN}><PayrollPage /></Gate>} />
      <Route path="/payroll/:id" element={<Gate role={ROLES.SUPER_ADMIN}><PayrollDetailPage /></Gate>} />
      <Route path="/payslips/me" element={<Gate role={ROLES.RECRUITER}><PayslipsPage /></Gate>} />
      <Route path="/vendors" element={<Gate role={ROLES.SUPER_ADMIN}><VendorsPage /></Gate>} />
      <Route path="/vendors/:id" element={<Gate role={ROLES.SUPER_ADMIN}><VendorDetailPage /></Gate>} />
      <Route path="/jobs" element={<Gate role={ROLES.SUPER_ADMIN}><JobsPage /></Gate>} />
      <Route path="/jobs/assigned" element={<Gate role={ROLES.RECRUITER}><JobsPage assignedOnly /></Gate>} />
      <Route path="/crm/my-pipeline" element={<Gate role={ROLES.RECRUITER}><CrmPipelinePage /></Gate>} />
      <Route path="/crm/candidates" element={<Gate role={ROLES.SUPER_ADMIN}><CrmPipelinePage /></Gate>} />
      <Route path="/crm/candidate-pool" element={<Gate role={ROLES.SUPER_ADMIN}><CandidatePoolPage /></Gate>} />
      <Route path="/crm/my-candidates" element={<Gate role={ROLES.RECRUITER}><AssignedCandidatesPage /></Gate>} />
      <Route path="/crm/submissions" element={<CandidateBucketPage bucket="SUBMISSIONS" />} />
      <Route path="/crm/shortlisted" element={<CandidateBucketPage bucket="SHORTLISTED" />} />
      <Route path="/crm/interview-scheduled" element={<CandidateBucketPage bucket="INTERVIEW_SCHEDULED" />} />
      <Route path="/crm/selected" element={<CandidateBucketPage bucket="SELECTED" />} />
      <Route path="/crm/rejected" element={<CandidateBucketPage bucket="REJECTED" />} />
      <Route path="/crm/joined" element={<CandidateBucketPage bucket="JOINED" />} />
      <Route path="/crm/calendar" element={<CandidateCalendarPage />} />
      <Route path="/crm/monitoring" element={<Gate role={ROLES.SUPER_ADMIN}><CrmMonitoringPage /></Gate>} />
      <Route path="/placements" element={<Gate role={ROLES.SUPER_ADMIN}><PlacementsPage /></Gate>} />
      <Route path="/messages" element={<MessagesPage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/documents/me" element={<Gate role={ROLES.RECRUITER}><DocumentsPage /></Gate>} />
      <Route path="/audit" element={<Gate role={ROLES.SUPER_ADMIN}><AuditPage /></Gate>} />
      <Route path="/reports" element={<Gate role={ROLES.SUPER_ADMIN}><ReportsPage /></Gate>} />
      <Route path="/admin/company" element={<Gate role={ROLES.SUPER_ADMIN}><CompanyPage /></Gate>} />
    </Route>
    <Route path="/" element={<Navigate to={auth.isAuthenticated ? "/dashboard" : "/login"} replace />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes></ResettingRouteBoundary></Suspense></BrowserRouter>;
}
