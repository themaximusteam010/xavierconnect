"use client";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "./button";
import type { ComponentProps } from "react";

/**
 * Submit button with pending state. When given name/value, the value is written into a hidden
 * field on click so multi-button forms (approve/reject, save/submit) always send which button
 * was pressed — we don't rely on the submitter being serialised.
 */
export function SubmitButton({ children, pendingLabel, confirm, name, value, ...props }: ComponentProps<typeof Button> & { pendingLabel?: string; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) { e.preventDefault(); return; }
        const form = e.currentTarget.form;
        if (form && !name) form.querySelectorAll("input[data-submitter]").forEach((el) => el.remove());
        if (form && name) {
          let h = form.querySelector<HTMLInputElement>(`input[data-submitter="${name}"]`);
          if (!h) { h = document.createElement("input"); h.type = "hidden"; h.name = name; h.dataset.submitter = name; form.appendChild(h); }
          h.value = String(value ?? "");
        }
      }}
      data-value={value as string | undefined}
      value={value}
      {...props}
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending ? pendingLabel ?? children : children}
    </Button>
  );
}
