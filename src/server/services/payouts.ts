/**
 * Beneficiaries, payout initiation and provider outcomes.
 *
 * Lifecycle: REQUESTED (vendor) → [finance approves] → PROCESSING (provider accepted the instruction)
 *            → PAID   only on provider confirmation (webhook/status)  → ledger: hold → clearing
 *            → FAILED on provider failure/reversal                     → ledger: hold → available (funds returned)
 * Cross-border payouts first obtain a provider FX quote; the quote (rate, fee, target amount, expiry,
 * provider reference) is stored and must be unexpired when the payout is initiated.
 */
import { db } from "@/server/db";
import { encryptJson } from "@/server/crypto";
import { convertMinor } from "@/server/domain/fx";
import { postLedger, PlatformAccounts, vendorAccountCode } from "@/server/domain/ledger";
import { requirePayment, paymentAdapter } from "@/server/integrations/registry";
import { ProviderUnavailableError, type BeneficiaryInput } from "@/server/integrations/types";
import { FinanceError, failPayout, lockPayout, markPayoutPaid, resolveCorridor } from "./finance";
import { audit } from "./audit";
import { notify } from "./notify";
import { raiseAlert } from "./monitoring";

/** Our payout reference: "xcpo_" + payout id (cuid, 25 lowercase alphanumerics) — fits Paystack's 16–50 [a-z0-9_-] rule. */
export const payoutReference = (payoutId: string) => {
  const r = `xcpo_${payoutId}`;
  if (!/^[a-z0-9_-]{16,50}$/.test(r)) throw new Error("payout id unsuitable for provider reference");
  return r;
};
export const payoutIdFromReference = (ref: string) => (/^xcpo_[a-z0-9]+$/.test(ref) ? ref.slice(5) : null);

/** Corridors open for a vendor's country (for the vendor settings screen). */
export async function corridorsFor(country: string) {
  const rows = await db.payoutCorridor.findMany({ where: { country }, orderBy: { currency: "asc" } });
  const usable = rows.filter((r) => r.status === "LIVE" ? r.complianceApproved : r.status === "SANDBOX" ? process.env.NODE_ENV !== "production" || process.env.ALLOW_SANDBOX_PAYMENTS === "true" : false);
  return { all: rows, usable };
}

/** Payout providers a vendor in this country/currency can register a bank account with right now. */
export async function beneficiaryProvidersFor(country: string, currency: string) {
  const { usable } = await corridorsFor(country);
  const keys = usable.filter((c) => c.currency === currency && paymentAdapter(c.providerKey)?.capabilities.includes("BENEFICIARY_ONBOARDING")).map((c) => c.providerKey);
  if (country === "NG" && currency === "NGN") keys.push("manual");
  return keys;
}

export async function addBeneficiary(vendorId: string, actorId: string, providerKey: string, input: BeneficiaryInput) {
  const vendor = await db.vendor.findUniqueOrThrow({ where: { id: vendorId } });
  if (input.country !== vendor.country) throw new FinanceError("Payout accounts must be in your country of registration.");
  const corridor = await resolveCorridor(db, input.country, input.currency, providerKey);
  void corridor;
  let result: { status: "VERIFIED" | "PENDING_VERIFICATION" | "REJECTED"; recipientRef?: string; verifiedName?: string; message?: string };
  if (providerKey === "manual") {
    // No provider API: details are held encrypted until a finance officer checks the account name with the bank.
    result = { status: "PENDING_VERIFICATION", message: "Finance will confirm the account name with your bank before the first withdrawal." };
  } else try {
    const { adapter, ctx } = await requirePayment(providerKey, "BENEFICIARY_ONBOARDING");
    result = await adapter.createBeneficiary!(ctx, input);
  } catch (e) {
    if (e instanceof ProviderUnavailableError) throw new FinanceError(e.message);
    throw new FinanceError(`The payment provider could not verify this account: ${(e as Error).message}`);
  }
  const ben = await db.$transaction(async (tx) => {
    const isFirst = (await tx.beneficiary.count({ where: { vendorId, status: "VERIFIED", disabledAt: null } })) === 0;
    const b = await tx.beneficiary.create({
      data: {
        vendorId, providerKey, country: input.country, currency: input.currency, routingType: input.routingType,
        bankName: input.bankName, bankCode: input.bankCode, branch: input.branch, accountHolderName: input.accountHolderName,
        verifiedName: result.verifiedName ?? null, accountLast4: input.accountNumber.slice(-4),
        // Keep full details only while the provider still has to verify them; drop once tokenised.
        detailsEnc: result.status === "PENDING_VERIFICATION" ? encryptJson({ accountNumber: input.accountNumber, ...input.extra }) : null,
        providerRecipientRef: result.recipientRef ?? null,
        status: result.status, failureReason: result.status === "REJECTED" ? result.message ?? "Rejected by provider" : null,
        isDefault: result.status === "VERIFIED" && isFirst, verifiedAt: result.status === "VERIFIED" ? new Date() : null,
      },
    });
    await audit(tx, { actorId, action: "beneficiary.add", entityType: "Beneficiary", entityId: b.id, after: { providerKey, country: input.country, currency: input.currency, last4: b.accountLast4, status: b.status } });
    return b;
  });
  return { beneficiary: ben, message: result.message };
}

/** Finance verification of a manually-paid account (name checked against the bank). Never used for provider-tokenised accounts. */
export async function reviewManualBeneficiary(beneficiaryId: string, actorId: string, decision: "VERIFIED" | "REJECTED", note: string) {
  const b = await db.beneficiary.findUnique({ where: { id: beneficiaryId } });
  if (!b || b.providerKey !== "manual" || b.status !== "PENDING_VERIFICATION") throw new FinanceError("Only pending manual accounts can be reviewed here.");
  if (decision === "REJECTED" && note.trim().length < 5) throw new FinanceError("Give the vendor a reason.");
  await db.$transaction(async (tx) => {
    const isFirst = decision === "VERIFIED" && (await tx.beneficiary.count({ where: { vendorId: b.vendorId, status: "VERIFIED", disabledAt: null } })) === 0;
    await tx.beneficiary.update({ where: { id: b.id }, data: decision === "VERIFIED" ? { status: "VERIFIED", verifiedAt: new Date(), verifiedName: note.trim() || b.accountHolderName, isDefault: isFirst } : { status: "REJECTED", failureReason: note.trim() } });
    await audit(tx, { actorId, action: `beneficiary.${decision.toLowerCase()}`, entityType: "Beneficiary", entityId: b.id, after: { note } });
  });
  const v = await db.vendor.findUniqueOrThrow({ where: { id: b.vendorId } });
  await notify(db, { userId: v.ownerId, type: "payout.update", title: decision === "VERIFIED" ? "Bank account verified" : "Bank account not verified", body: decision === "VERIFIED" ? `${b.bankName} ••••${b.accountLast4} can now receive withdrawals.` : note, link: "/vendor/bank-accounts" });
}

export async function setDefaultBeneficiary(vendorId: string, beneficiaryId: string, actorId: string) {
  const b = await db.beneficiary.findFirst({ where: { id: beneficiaryId, vendorId, status: "VERIFIED", disabledAt: null } });
  if (!b) throw new FinanceError("Only verified accounts can be the default.");
  await db.$transaction([
    db.beneficiary.updateMany({ where: { vendorId }, data: { isDefault: false } }),
    db.beneficiary.update({ where: { id: b.id }, data: { isDefault: true } }),
  ]);
  await audit(db, { actorId, action: "beneficiary.default", entityType: "Beneficiary", entityId: b.id });
}

export async function disableBeneficiary(vendorId: string, beneficiaryId: string, actorId: string) {
  const b = await db.beneficiary.findFirst({ where: { id: beneficiaryId, vendorId } });
  if (!b) throw new FinanceError("Account not found.");
  const inFlight = await db.payout.count({ where: { beneficiaryId: b.id, status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } } });
  if (inFlight) throw new FinanceError("This account has a withdrawal in progress.");
  await db.beneficiary.update({ where: { id: b.id }, data: { status: "DISABLED", disabledAt: new Date(), isDefault: false, detailsEnc: null } });
  await audit(db, { actorId, action: "beneficiary.disable", entityType: "Beneficiary", entityId: b.id });
}

/**
 * Finance approval. Sends the instruction to the provider. For cross-border payouts a fresh FX quote is
 * obtained first and stored; we never initiate on an expired quote.
 */
export async function approveAndInitiatePayout(payoutId: string, actorId: string) {
  const p = await db.payout.findUniqueOrThrow({ where: { id: payoutId }, include: { beneficiary: true, vendor: true, fxQuote: true } });
  if (p.status !== "REQUESTED" && p.status !== "APPROVED") throw new FinanceError(`Payout is ${p.status}.`);
  if (!p.beneficiary || p.beneficiary.status !== "VERIFIED") throw new FinanceError("Beneficiary is not verified.");
  await resolveCorridor(db, p.beneficiary.country, p.beneficiary.currency, p.beneficiary.providerKey);
  const key = p.beneficiary.providerKey;

  if (key === "manual") {
    await db.payout.update({ where: { id: p.id }, data: { status: "APPROVED", reviewedById: actorId, reviewedAt: new Date() } });
    await db.payoutEvent.create({ data: { payoutId: p.id, status: "APPROVED", message: "Approved for manual bank transfer" } });
    await audit(db, { actorId, action: "payout.approve", entityType: "Payout", entityId: p.id });
    return { status: "APPROVED" as const };
  }

  const cap = p.method === "CROSS_BORDER" ? "CROSS_BORDER_PAYOUT" : "LOCAL_PAYOUT";
  let adapterCtx;
  try {
    adapterCtx = await requirePayment(key, cap);
  } catch (e) {
    throw new FinanceError((e as Error).message);
  }
  const { adapter, ctx } = adapterCtx;
  let quoteRef: string | undefined;
  let sendAmount = p.amountMinor;
  let sendCurrency = "NGN";

  if (p.method === "CROSS_BORDER") {
    if (!adapter.quoteFx) throw new FinanceError("Provider cannot quote FX.");
    const q = await adapter.quoteFx(ctx, { sourceCurrency: "NGN", targetCurrency: p.beneficiary.currency, sourceAmountMinor: p.amountMinor });
    if (q.expiresAt.getTime() <= Date.now()) throw new FinanceError("Provider returned an already-expired quote.");
    // Sanity check provider maths with our own exact conversion.
    const ours = convertMinor(p.amountMinor - q.feeMinor, q.rate);
    if (ours !== q.targetAmountMinor) {
      await raiseAlert({ dedupeKey: `fx-mismatch:${p.id}`, type: "FX_QUOTE", severity: "WARNING", title: "FX quote amount differs from rate × amount", detail: `Payout ${p.id}: provider ${q.targetAmountMinor}, computed ${ours}`, link: `/admin/payouts?id=${p.id}` });
    }
    await db.fxQuote.upsert({
      where: { payoutId: p.id },
      update: { rate: q.rate, sourceAmountMinor: p.amountMinor, targetAmountMinor: q.targetAmountMinor, feeMinor: q.feeMinor, expiresAt: q.expiresAt, providerQuoteRef: q.providerQuoteRef, status: "ACCEPTED" },
      create: { payoutId: p.id, providerKey: key, sourceCurrency: "NGN", targetCurrency: p.beneficiary.currency, sourceAmountMinor: p.amountMinor, targetAmountMinor: q.targetAmountMinor, rate: q.rate, feeMinor: q.feeMinor, expiresAt: q.expiresAt, providerQuoteRef: q.providerQuoteRef, status: "ACCEPTED" },
    });
    await db.payout.update({ where: { id: p.id }, data: { fxRate: q.rate, providerFeeMinor: q.feeMinor, settlementAmountMinor: q.targetAmountMinor } });
    await db.payoutEvent.create({ data: { payoutId: p.id, status: "FX_QUOTED", message: `Rate ${q.rate} ${p.beneficiary.currency}/NGN, fee ${q.feeMinor} kobo, expires ${q.expiresAt.toISOString()}` } });
    quoteRef = q.providerQuoteRef;
    sendAmount = q.targetAmountMinor;
    sendCurrency = p.beneficiary.currency;
  }

  const reference = payoutReference(p.id);
  let res;
  try {
    res = await adapter.initiatePayout!(ctx, { reference, amountMinor: p.method === "CROSS_BORDER" ? p.amountMinor : sendAmount, currency: p.method === "CROSS_BORDER" ? "NGN" : sendCurrency, recipientRef: p.beneficiary.providerRecipientRef ?? "", reason: `XavierConnect payout ${p.vendor.businessName}`, fxQuoteRef: quoteRef });
  } catch (e) {
    await db.payoutEvent.create({ data: { payoutId: p.id, status: "INITIATION_ERROR", message: (e as Error).message.slice(0, 300) } });
    await raiseAlert({ dedupeKey: `payout-init:${p.id}`, type: "PAYOUT_FAILED", severity: "CRITICAL", title: "Payout could not be sent to the provider", detail: (e as Error).message, link: `/admin/payouts?id=${p.id}` });
    throw new FinanceError(`Provider error: ${(e as Error).message}`);
  }
  if (res.status === "FAILED") {
    await failPayout(p.id, actorId, res.message ?? "Provider rejected the payout", "FAILED");
    return { status: "FAILED" as const };
  }
  await db.payout.update({ where: { id: p.id }, data: { status: "PROCESSING", providerRef: res.providerRef, initiatedAt: new Date(), reviewedById: actorId, reviewedAt: new Date() } });
  await db.payoutEvent.create({ data: { payoutId: p.id, status: res.status === "OTP_REQUIRED" ? "AWAITING_OTP" : "PROCESSING", message: res.message ?? `Sent to ${adapter.name} (${res.providerRef})` } });
  await audit(db, { actorId, action: "payout.initiate", entityType: "Payout", entityId: p.id, after: { provider: key, providerRef: res.providerRef, method: p.method } });
  return { status: "PROCESSING" as const };
}

/** Applies a verified provider event. Idempotent: repeated events change nothing. */
export async function applyPayoutOutcome(providerKey: string, reference: string, outcome: "SUCCESS" | "FAILED" | "REVERSED", message?: string) {
  const id = payoutIdFromReference(reference);
  const p = id ? await db.payout.findFirst({ where: { id, providerKey }, include: { vendor: true } }) : null;
  if (!p) throw new Error(`Unknown payout reference ${reference}`);
  if (outcome === "SUCCESS") {
    if (p.status === "PAID") return "noop";
    await markPayoutPaid(p.id, null, p.providerRef ?? reference, { providerConfirmed: true });
    return "paid";
  }
  if (p.status === "PAID" && outcome === "REVERSED") {
    // Funds came back after a confirmed payout: put them back in the vendor's available balance.
    await db.$transaction(async (tx) => {
      await lockPayout(tx, p.id);
      await postLedger(tx, {
        kind: "PAYOUT_REVERSED", reference: p.id, idempotencyKey: `payout-reversed:${p.id}`, description: `Payout reversed by provider: ${message ?? ""}`,
        entries: [{ account: PlatformAccounts.clearing.code, debit: p.amountMinor }, { account: vendorAccountCode(p.vendorId, "available"), credit: p.amountMinor }],
      });
      await tx.payout.update({ where: { id: p.id }, data: { status: "FAILED", failureReason: `Reversed: ${message ?? "returned by bank"}` } });
      await tx.payoutEvent.create({ data: { payoutId: p.id, status: "REVERSED", message } });
    });
  } else if (p.status !== "FAILED" && p.status !== "REJECTED") {
    await failPayout(p.id, null, message ?? (outcome === "REVERSED" ? "Reversed by provider" : "Failed at provider"), "FAILED");
  } else {
    return "noop";
  }
  await raiseAlert({ dedupeKey: `payout-failed:${p.id}`, type: "PAYOUT_FAILED", severity: "WARNING", title: `Payout failed for ${p.vendor.businessName}`, detail: message ?? outcome, link: `/admin/payouts?id=${p.id}` });
  await notify(db, { userId: p.vendor.ownerId, type: "payout.update", title: "Withdrawal failed", body: `${message ?? "The bank or provider could not complete it"}. The amount is back in your available balance. Check your payout account details.`, link: "/vendor/payouts" });
  return "failed";
}

export function adapterName(key: string | null | undefined) {
  return key ? paymentAdapter(key)?.name ?? key : "—";
}
