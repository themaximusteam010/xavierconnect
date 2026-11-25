import { ForgotForm } from "@/components/auth-forms";
export const metadata = { title: "Reset password" };
export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mb-6 mt-1 text-sm text-ink-muted">Enter the email on your account and we will send you a link.</p>
      <ForgotForm />
    </>
  );
}
