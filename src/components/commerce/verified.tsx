import { BadgeCheck } from "lucide-react";

const LABEL: Record<string, string> = {
  IDENTITY_VERIFIED: "ID verified",
  BUSINESS_VERIFIED: "Verified business",
  PREMIUM_VERIFIED: "Premium verified",
};

/** Shown only when an admin actually verified the vendor (see vendors.reviewApplication). */
export function VerifiedMark({ level, withLabel }: { level: string; withLabel?: boolean }) {
  if (!LABEL[level]) return null;
  return (
    <span className="inline-flex items-center gap-1 text-brand" title={LABEL[level]}>
      <BadgeCheck className="size-3.5" aria-label={LABEL[level]} />
      {withLabel && <span className="text-[12px] font-medium">{LABEL[level]}</span>}
    </span>
  );
}
