import { z } from "zod";

export const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara",
] as const;

export const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
export const phoneNg = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .refine((s) => /^(\+?234|0)[789][01]\d{8}$/.test(s), "Enter a valid Nigerian phone number, e.g. 0803 123 4567");
export const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((s) => /[a-zA-Z]/.test(s) && /\d/.test(s), "Use letters and at least one number");

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(100),
  email,
  password,
  terms: z.literal("on", { message: "You must accept the terms to continue" }),
});

export const addressSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the recipient's name").max(100),
  phone: phoneNg,
  line1: z.string().trim().min(3, "Enter a street address").max(200),
  line2: z.string().trim().max(200).optional().transform((s) => s || null),
  city: z.string().trim().min(2, "Enter a city").max(100),
  state: z.enum(NIGERIAN_STATES, { message: "Choose a state" }),
  country: z.literal("NG").default("NG"),
});

export type FieldErrors = Record<string, string[] | undefined>;
export type ActionState = { ok: boolean; message?: string; errors?: FieldErrors; values?: Record<string, string> } | null;

export function fieldErrors(e: z.ZodError): FieldErrors {
  return z.flattenError(e).fieldErrors as FieldErrors;
}

export function formValues(fd: FormData, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? "")]));
}
