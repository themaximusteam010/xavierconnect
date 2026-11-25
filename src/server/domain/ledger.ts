/**
 * Double-entry ledger. The ledger is the source of truth for who is owed what.
 * Vendor "balances" shown anywhere in the UI are derived from these entries, never stored.
 *
 * Accounts (normal balance in brackets):
 *   platform:clearing            ASSET     [debit]  funds held by the payment provider/bank for the marketplace
 *   platform:commission          REVENUE   [credit] marketplace commission earned
 *   platform:promotions          EXPENSE   [debit]  platform-funded discounts
 *   platform:tax_payable         LIABILITY [credit] tax collected on behalf of authorities
 *   platform:payment_fees        EXPENSE   [debit]  processor fees borne by the platform
 *   vendor:<id>:pending          LIABILITY [credit] earned but not yet releasable (order not yet delivered/held)
 *   vendor:<id>:available        LIABILITY [credit] releasable; withdrawals draw from here
 *   vendor:<id>:payout_hold      LIABILITY [credit] requested withdrawals awaiting approval/transfer
 */
import type { DbClient, Tx } from "@/server/db";

export type AccountType = "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE";

export const PlatformAccounts = {
  clearing: { code: "platform:clearing", name: "Payment clearing", type: "ASSET" },
  commission: { code: "platform:commission", name: "Commission revenue", type: "REVENUE" },
  promotions: { code: "platform:promotions", name: "Platform-funded promotions", type: "EXPENSE" },
  taxPayable: { code: "platform:tax_payable", name: "Tax payable", type: "LIABILITY" },
  paymentFees: { code: "platform:payment_fees", name: "Payment processing fees", type: "EXPENSE" },
} as const satisfies Record<string, { code: string; name: string; type: AccountType }>;

export type VendorBucket = "pending" | "available" | "payout_hold";
export const vendorAccountCode = (vendorId: string, bucket: VendorBucket) => `vendor:${vendorId}:${bucket}`;

export interface EntryInput {
  account: string; // account code
  debit?: bigint;
  credit?: bigint;
}

export interface PostInput {
  kind: string;
  reference: string;
  idempotencyKey: string;
  description: string;
  entries: EntryInput[];
}

export class LedgerError extends Error {}

export function assertBalanced(entries: EntryInput[]) {
  let d = 0n;
  let c = 0n;
  for (const e of entries) {
    const debit = e.debit ?? 0n;
    const credit = e.credit ?? 0n;
    if (debit < 0n || credit < 0n) throw new LedgerError("negative ledger amount");
    if ((debit > 0n) === (credit > 0n)) throw new LedgerError("entry must be exactly one of debit or credit");
    d += debit;
    c += credit;
  }
  if (d !== c) throw new LedgerError(`unbalanced transaction: debits ${d} credits ${c}`);
}

async function ensureAccount(tx: Tx, code: string) {
  const existing = await tx.ledgerAccount.findUnique({ where: { code } });
  if (existing) return existing;
  const platform = Object.values(PlatformAccounts).find((a) => a.code === code);
  if (platform) {
    return tx.ledgerAccount.upsert({
      where: { code },
      update: {},
      create: { code, name: platform.name, type: platform.type },
    });
  }
  const m = /^vendor:([^:]+):(pending|available|payout_hold)$/.exec(code);
  if (!m) throw new LedgerError(`unknown ledger account ${code}`);
  return tx.ledgerAccount.upsert({
    where: { code },
    update: {},
    create: { code, name: `Vendor ${m[2]}`, type: "LIABILITY", vendorId: m[1] },
  });
}

/**
 * Post a balanced transaction. Idempotent: re-posting the same idempotencyKey returns the
 * existing transaction and writes nothing. Must run inside a DB transaction.
 */
export async function postLedger(tx: Tx, input: PostInput) {
  const entries = input.entries.filter((e) => (e.debit ?? 0n) > 0n || (e.credit ?? 0n) > 0n);
  assertBalanced(entries);
  const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { transaction: existing, created: false };

  const accounts = new Map<string, string>();
  for (const e of entries) {
    if (!accounts.has(e.account)) accounts.set(e.account, (await ensureAccount(tx, e.account)).id);
  }
  const transaction = await tx.ledgerTransaction.create({
    data: {
      kind: input.kind,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      entries: {
        create: entries.map((e) => ({
          accountId: accounts.get(e.account)!,
          debitMinor: e.debit ?? 0n,
          creditMinor: e.credit ?? 0n,
        })),
      },
    },
  });
  return { transaction, created: true };
}

/** Balance in the account's normal direction (credit-normal for liabilities/revenue). */
export async function accountBalance(db: DbClient, code: string): Promise<bigint> {
  const acct = await db.ledgerAccount.findUnique({ where: { code } });
  if (!acct) return 0n;
  const agg = await db.ledgerEntry.aggregate({
    where: { accountId: acct.id },
    _sum: { debitMinor: true, creditMinor: true },
  });
  const d = agg._sum.debitMinor ?? 0n;
  const c = agg._sum.creditMinor ?? 0n;
  return acct.type === "ASSET" || acct.type === "EXPENSE" ? d - c : c - d;
}

export async function vendorBalances(db: DbClient, vendorId: string) {
  const [pending, available, payoutHold] = await Promise.all([
    accountBalance(db, vendorAccountCode(vendorId, "pending")),
    accountBalance(db, vendorAccountCode(vendorId, "available")),
    accountBalance(db, vendorAccountCode(vendorId, "payout_hold")),
  ]);
  return { pending, available, payoutHold };
}
