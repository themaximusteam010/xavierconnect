import { ResetForm } from "@/components/auth-forms";
import { Alert } from "@/components/ui/feedback";
export const metadata = { title: "Choose a new password" };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Choose a new password</h1>
      {token ? <ResetForm token={token} /> : <Alert tone="danger">This link is incomplete. Request a new reset email.</Alert>}
    </>
  );
}
