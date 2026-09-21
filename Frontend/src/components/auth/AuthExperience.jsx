import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import * as authApis from "../../Services/apiCalling/authApis";
import { logout, setSession } from "../../ReduxFeature/Authenticate/authSlice";
import { STORAGE_KEYS } from "../../constants/storage.constants";
import { callFirst } from "../custom/apiBridge";
import { transitionResult } from "../custom/apiBridge";
import { Button, Field } from "../custom/ui";

const passwordError = (password) => password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)
  ? "Use 10+ characters with uppercase, lowercase, and a number." : "";

export default function AuthExperience({ mode = "login" }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", code: "", newPassword: "", currentPassword: "", confirmPassword: "" });
  const [step, setStep] = useState(mode === "reset" ? "request" : mode);
  const [resetToken, setResetToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  useEffect(() => setError(""), [step]);
  const submit = async (event) => {
    event.preventDefault(); setError("");
    if (["new-password", "change"].includes(step)) {
      const message = passwordError(form.newPassword);
      if (message) return setError(message);
      if (form.newPassword !== form.confirmPassword) return setError("The new passwords do not match.");
    }
    setLoading(true);
    try {
      if (step === "login") {
        const payload = { email: form.email.trim(), password: form.password, deviceId: "web-browser" };
        const data = transitionResult(await callFirst(authApis, ["handleLogin", "handleUserLogin", "login"], payload));
        if (!data?.accessToken || !data?.refreshToken) throw new Error("Login response did not include a session.");
        localStorage.setItem(STORAGE_KEYS.accessToken, data.accessToken);
        localStorage.setItem(STORAGE_KEYS.refreshToken, data.refreshToken);
        dispatch(setSession(data));
        navigate(data.user?.mustChangePassword ? "/change-password" : "/dashboard", { replace: true });
      } else if (step === "request") {
        transitionResult(await callFirst(authApis, ["handleRequestOtp", "requestOtp"], { email: form.email.trim() }));
        setStep("verify");
      } else if (step === "verify") {
        const result = transitionResult(await callFirst(authApis, ["handleVerifyOtp", "verifyOtp"], { email: form.email.trim(), code: form.code }));
        setResetToken(result?.resetToken || ""); setStep("new-password");
      } else if (step === "new-password") {
        transitionResult(await callFirst(authApis, ["handleResetPassword", "resetPassword"], { token: resetToken, newPassword: form.newPassword }));
        setStep("complete");
      } else if (step === "change") {
        transitionResult(await callFirst(authApis, ["handleChangePassword", "changePassword"], { currentPassword: form.currentPassword, newPassword: form.newPassword }));
        localStorage.removeItem(STORAGE_KEYS.accessToken); localStorage.removeItem(STORAGE_KEYS.refreshToken);
        dispatch(logout());
        navigate("/login", { replace: true });
      }
    } catch (requestError) { setError(requestError?.message || "We couldn’t complete that request. Please try again."); }
    finally { setLoading(false); }
  };

  if (step === "complete") return <AuthShell><div className="auth-complete"><CheckCircle2 size={34} /><h1>Password updated</h1><p>Your sessions have been securely closed. Sign in again with your new password.</p><Button onClick={() => navigate("/login")}>Return to sign in</Button></div></AuthShell>;

  const copy = step === "login" ? ["Welcome back", "Sign in to continue to your people workspace."] : step === "request" ? ["Reset your password", "We’ll send a six-digit verification code to your work email."] : step === "verify" ? ["Enter the verification code", `We sent a six-digit code to ${form.email}.`] : step === "change" ? ["Create a permanent password", "For security, your other active sessions will be signed out."] : ["Choose a new password", "Use a password you haven’t used for this account before."];
  return <AuthShell><motion.div className="auth-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><div className="auth-panel__mark"><ShieldCheck size={18} /></div><h1>{copy[0]}</h1><p>{copy[1]}</p><form onSubmit={submit} className="form-stack">
    {step === "login" && <><Field label="Work email" type="email" autoComplete="email" value={form.email} onChange={update("email")} required /><Field label="Password" type="password" autoComplete="current-password" value={form.password} onChange={update("password")} required /></>}
    {step === "request" && <Field label="Work email" type="email" value={form.email} onChange={update("email")} required />}
    {step === "verify" && <Field label="Six-digit code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" value={form.code} onChange={update("code")} required />}
    {step === "change" && <Field label="Current password" type="password" value={form.currentPassword} onChange={update("currentPassword")} required />}
    {["new-password", "change"].includes(step) && <><Field label="New password" type="password" value={form.newPassword} onChange={update("newPassword")} helper="10+ characters, including uppercase, lowercase, and a number." required /><Field label="Confirm new password" type="password" value={form.confirmPassword} onChange={update("confirmPassword")} required /></>}
    {error && <div className="auth-error" role="alert">{error}</div>}
    <Button type="submit" loading={loading} icon={step === "login" ? KeyRound : undefined}>{step === "login" ? "Sign in securely" : step === "request" ? "Send verification code" : step === "verify" ? "Verify code" : "Update password"}</Button>
  </form>{step === "login" ? <Link className="auth-link" to="/reset-password">Forgot your password?</Link> : step !== "change" && <button className="auth-back" onClick={() => step === "verify" ? setStep("request") : navigate("/login")}><ArrowLeft size={15} />Back</button>}</motion.div></AuthShell>;
}

function AuthShell({ children }) {
  return <main className="auth-shell"><section className="auth-story"><div className="auth-brand"><span>l</span><strong>Ledger</strong></div><div><blockquote>“People operations should feel calm enough to trust, and clear enough to act on.”</blockquote><p>Attendance, payroll, hiring, and team communication in one precise workspace.</p></div><small>Smart HRMS · Secure by design</small></section><section className="auth-workspace">{children}</section></main>;
}
