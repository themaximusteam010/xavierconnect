"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { createBooking } from "@/server/services/bookings";
import { CartError } from "@/server/services/cart";
import { rateLimit } from "@/server/rate-limit";

export async function bookServiceAction(fd: FormData) {
  const parsed = z.object({
    serviceId: z.string(), slug: z.string(), packageId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), minute: z.coerce.number().int().min(0).max(1439),
    notes: z.string().max(1000).optional(), address: z.string().max(300).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirect(`/services/${fd.get("slug")}?error=${encodeURIComponent("Choose a package, date and time.")}`);
  const d = parsed.data;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/services/${d.slug}?package=${d.packageId}&date=${d.date}`)}`);
  if (!(await rateLimit("booking", 10, 600, user.id))) redirect(`/services/${d.slug}?error=${encodeURIComponent("Too many attempts. Please wait.")}`);
  let url: string;
  try {
    url = (await createBooking({ customerId: user.id, email: user.email, ...d })).authorizationUrl;
  } catch (e) {
    if (e instanceof CartError) redirect(`/services/${d.slug}?package=${d.packageId}&date=${d.date}&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(url);
}
