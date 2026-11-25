import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { DashShell } from "@/components/layout/dash-shell";
export const dynamic = "force-dynamic";
export default async function DeliveryLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser("/delivery");
  if (!u.permissions.has("delivery.perform")) redirect("/account");
  return <DashShell title="Deliveries" subtitle={u.name} nav={[{ href: "/delivery", label: "Assigned to me" }]}>{children}</DashShell>;
}
