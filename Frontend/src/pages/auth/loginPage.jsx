import AuthExperience from "../../components/auth/AuthExperience";
export function LoginPage() { return <AuthExperience />; }
export function ResetPasswordPage() { return <AuthExperience mode="reset" />; }
export function ChangePasswordPage() { return <AuthExperience mode="change" />; }
