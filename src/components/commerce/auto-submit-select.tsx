"use client";
import type { SelectHTMLAttributes } from "react";
import { Select } from "@/components/ui/form";

export function AutoSubmitSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <Select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
