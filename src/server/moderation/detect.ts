/**
 * Deterministic contact-information and off-platform-payment detection.
 *
 * Pipeline (moderateText): normalise → contact info (email, phone) → URLs/domains → messaging handles
 * → payment solicitation → admin rules → decision. Pure and synchronous so it can run before any
 * delivery and be unit-tested. No AI is involved; an optional external classifier could only ever add
 * REVIEW findings on top of these rules, never approve something the rules block.
 *
 * Findings carry a category and a *redacted* hint (e.g. "…4567"), never the full contact detail, so
 * moderation logs do not themselves become a directory of phone numbers.
 */
import { findPhoneNumbersInText, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { linkifyit } from "linkify-it";

export type Category = "EMAIL" | "PHONE" | "URL" | "MESSAGING_HANDLE" | "SOCIAL_HANDLE" | "PAYMENT_ACCOUNT" | "OFF_PLATFORM_PAYMENT" | "CUSTOM_RULE" | "QR_CODE";
export type Severity = "BLOCK" | "REVIEW";
export interface Finding { category: Category; severity: Severity; hint: string }
export type Decision = "APPROVED" | "BLOCKED" | "REVIEW";
export interface RuleSet { blockTerms: string[]; reviewTerms: string[]; allowDomains: string[]; disabled: Category[] }
export const EMPTY_RULES: RuleSet = { blockTerms: [], reviewTerms: [], allowDomains: [], disabled: [] };

// ─── Normalisation ───────────────────────────────────────────────────────────

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;
// Common Cyrillic/Greek look-alikes used to dodge filters ("whаtsapp" with Cyrillic а).
const HOMOGLYPHS: Record<string, string> = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "ο": "o", "α": "a", "ν": "v", "τ": "t", "ι": "i", "κ": "k" };
const WORD_DIGITS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };

/** NFKC (folds full-width digits/letters), strips zero-width characters, maps homoglyphs, lowercases. */
export function normalizeText(input: string) {
  let s = input.normalize("NFKC").replace(ZERO_WIDTH, "");
  s = [...s].map((c) => HOMOGLYPHS[c] ?? HOMOGLYPHS[c.toLowerCase()] ?? c).join("");
  return s.toLowerCase();
}

/**
 * Digit normalisation for phone detection: spelled-out digits ("zero eight one"), letter look-alikes
 * inside digit runs (0803l23 → 0803123), and separators between digits are collapsed.
 * Returns candidate runs of 7–16 digits (with a leading + when present).
 */
export function digitRuns(lower: string): string[] {
  let s = lower.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => WORD_DIGITS[w]);
  // o/O → 0 and l/i/| → 1 only when sandwiched between digits (keeps ordinary words intact).
  s = s.replace(/(?<=\d)[o](?=[\d\s.\-]*\d)/g, "0").replace(/(?<=\d)[li|](?=[\d\s.\-]*\d)/g, "1");
  const out: string[] = [];
  // A run = digits possibly separated by spaces, dots, dashes, slashes, brackets or underscores.
  for (const m of s.matchAll(/\+?\s*\(?\d[\d\s.\-_/()]{5,30}\d/g)) {
    const raw = m[0];
    // Money and quantities: "45,000", "₦45000", "x 2" are not phones — commas never appear in a run, and
    // runs adjacent to a currency marker are skipped.
    const before = s.slice(Math.max(0, m.index! - 2), m.index!);
    if (/[₦$€£¥]|ngn|n$/.test(before.trim())) continue;
    const digits = raw.replace(/[^\d+]/g, "");
    const plus = digits.startsWith("+");
    const d = digits.replace(/\+/g, "");
    if (d.length >= 7 && d.length <= 16) out.push((plus ? "+" : "") + d);
  }
  return out;
}

// ─── Detectors ───────────────────────────────────────────────────────────────

const redact = (s: string) => `…${s.replace(/\s/g, "").slice(-4)}`;
const TLD = "(?:com|net|org|ng|co|io|cn|uk|us|gh|ke|za|info|biz|me|edu|gov|app|xyz|online|store|shop)";
const MAIL_PROVIDERS = "(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|icloud|me|aol|proton|protonmail|qq|163|126|yandex|mail)";
const AT = String.raw`(?:@|＠|\s*[\(\[\{<]\s*at\s*[\)\]\}>]\s*|\s+at\s+)`;
const DOT = String.raw`(?:\.|\s*[\(\[\{<]\s*dot\s*[\)\]\}>]\s*|\s+dot\s+)`;

export function detectEmails(lower: string): Finding[] {
  const found: Finding[] = [];
  const plain = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/g;
  const obfuscated = new RegExp(String.raw`[a-z0-9._%+-]{2,}${AT}[a-z0-9-]{2,}(?:${DOT}[a-z0-9-]{2,})*${DOT}${TLD}\b`, "g");
  const provider = new RegExp(String.raw`\b[a-z0-9._%+-]{3,}${AT}${MAIL_PROVIDERS}\b`, "g");
  for (const re of [plain, obfuscated, provider]) for (const m of lower.matchAll(re)) found.push({ category: "EMAIL", severity: "BLOCK", hint: `…@${m[0].split(/@|\bat\b|\(at\)|\[at\]/).pop()?.trim().slice(0, 12)}` });
  return dedupe(found);
}

export function detectPhones(original: string, lower: string, defaultCountry: CountryCode = "NG"): Finding[] {
  const found: Finding[] = [];
  // 1) Library parsing on the text as written (handles "+86 138 0013 8000", "(0803) 123-4567").
  for (const n of findPhoneNumbersInText(original, defaultCountry)) {
    if (n.number.isValid()) found.push({ category: "PHONE", severity: "BLOCK", hint: `+${n.number.countryCallingCode} ${redact(n.number.nationalNumber)}` });
  }
  // 2) Normalised digit runs (spelled-out, look-alikes, odd separators) re-parsed with country-code recognition.
  for (const run of digitRuns(lower)) {
    const candidates = run.startsWith("+") ? [run] : [run, `+${run}`];
    for (const c of candidates) {
      const p = parsePhoneNumberFromString(c, defaultCountry);
      if (p?.isValid()) { found.push({ category: "PHONE", severity: "BLOCK", hint: `+${p.countryCallingCode} ${redact(p.nationalNumber)}` }); break; }
    }
  }
  return dedupe(found);
}

const linkify = linkifyit({ fuzzyLink: true, fuzzyEmail: false, fuzzyIP: false });
const CONTACT_DOMAINS = /(^|\.)(wa\.me|whatsapp\.com|chat\.whatsapp\.com|t\.me|telegram\.(me|org)|wechat\.com|weixin\.qq\.com|u\.wechat\.com|signal\.(me|org)|viber\.com|m\.me|messenger\.com|facebook\.com|fb\.com|fb\.me|instagram\.com|instagr\.am|ig\.me|tiktok\.com|twitter\.com|x\.com|snapchat\.com|linkedin\.com|discord\.(gg|com)|skype\.com|line\.me|linktr\.ee|bit\.ly|tinyurl\.com)$/;
const PAYMENT_DOMAINS = /(^|\.)(paypal\.(com|me)|cash\.app|venmo\.com|wise\.com|payoneer\.com|skrill\.com|paystack\.(com|shop)|flutterwave\.com|selar\.co|opay(web)?\.com|palmpay\.com|moniepoint\.com|kuda\.com|alipay\.com|binance\.com|blockchain\.com)$/;

export function detectUrls(lower: string, rules: RuleSet, ownHosts: string[]): Finding[] {
  // Undo " dot " / "(dot)" / " slash " obfuscation before link detection.
  const deob = lower.replace(new RegExp(DOT, "g"), ".").replace(/\s*[\(\[]?\s*slash\s*[\)\]]?\s*/g, "/").replace(/\s*\.\s*(?=[a-z]{2,}\b)/g, ".");
  const found: Finding[] = [];
  for (const m of linkify.match(deob) ?? []) {
    let host: string;
    try { host = new URL(m.url.startsWith("http") ? m.url : `https://${m.url}`).hostname.replace(/^www\./, ""); } catch { continue; }
    if (ownHosts.some((h) => host === h || host.endsWith(`.${h}`)) || rules.allowDomains.some((d) => host === d || host.endsWith(`.${d}`))) continue;
    if (CONTACT_DOMAINS.test(host)) found.push({ category: "MESSAGING_HANDLE", severity: "BLOCK", hint: host });
    else if (PAYMENT_DOMAINS.test(host)) found.push({ category: "OFF_PLATFORM_PAYMENT", severity: "BLOCK", hint: host });
    else found.push({ category: "URL", severity: "BLOCK", hint: host });
  }
  return dedupe(found);
}

const PLATFORMS = String.raw`(?:whats\s*app|whatsap+|watsap+|wassap|wats\s*app|w\.?a\b|telegram|tele\s*gram|\btg\b|we\s*chat|weixin|\bwx\b|signal\s+app|viber|\bimo\b|instagram|insta\b|\big\b|face\s*book|\bfb\b|messenger|snap\s*chat|\bsnap\b|tik\s*tok|twitter|\bline\s+app|skype|discord|threads)`;
// Contact intent: asking to be contacted, sharing "my number/handle", or moving the conversation onto a platform.
const INTENT = /\b(?:chat|dm|d\.m|message|msg|text|txt|call|ring|reach|contact|add|find|follow|hit|holla|buzz|ping|inbox|talk\s+to)\s+(?:me|us)\b|\bmy\s+(?:number|digits|line|contact|handle|id|username|user\s*name|page)\b/;
const MOVE = new RegExp(String.raw`\b(?:send|share|chat|talk|reach|contact|message|text|call|continue|discuss|move|connect|meet|pictures?|photos?|pics?|videos?|details|more|it)\b[^.?!\n]{0,25}\b(?:on|via|through|thru|over|to)\s+${PLATFORMS}`);
const ID_LIKE = /(?:^|\s)@[a-z0-9_.]{3,30}\b|\b(?:id|handle|username|user\s*name)\s*(?:is|:|=)\s*[a-z0-9_.-]{3,}/;

export function detectHandles(lower: string): Finding[] {
  const found: Finding[] = [];
  const platform = lower.match(new RegExp(PLATFORMS));
  // A platform mention alone ("does it support WhatsApp?") is fine; with contact intent it is not.
  if (platform && (INTENT.test(lower) || MOVE.test(lower) || ID_LIKE.test(lower))) {
    found.push({ category: "MESSAGING_HANDLE", severity: "BLOCK", hint: platform[0].replace(/\s+/g, "") });
  }
  // A bare "@handle" (not part of an email) is likely a social profile → hold for review.
  for (const m of lower.matchAll(/(?:^|[\s(])@([a-z][a-z0-9_.]{2,29})\b(?![a-z0-9.-]*\.[a-z]{2,})/g)) {
    if (!found.length) found.push({ category: "SOCIAL_HANDLE", severity: "REVIEW", hint: `@${m[1].slice(0, 3)}…` });
  }
  return dedupe(found);
}

const BANKS = String.raw`(?:gt\s*b(?:ank)?|guaranty|access|zenith|uba|first\s*bank|fbn|opay|palm\s*pay|moniepoint|kuda|wema|fidelity|sterling|union\s*bank|polaris|fcmb|stanbic|ecobank|keystone|providus|vfd|carbon|fairmoney|globus|jaiz|taj|heritage|unity|alat)`;

export function detectPayment(lower: string): Finding[] {
  const found: Finding[] = [];
  const block: [RegExp, Category][] = [
    [/\b(?:pay|send|transfer|deposit|remit)\b[^.?!\n]{0,40}\b(?:directly|direct|outside|off(?:\s|-)?(?:line|platform|app|site))\b/, "OFF_PLATFORM_PAYMENT"],
    [/\b(?:outside|off)\s+(?:of\s+)?(?:xavier\s*connect|the\s+(?:app|platform|site|website|marketplace))\b/, "OFF_PLATFORM_PAYMENT"],
    [/\b(?:avoid|skip|save|dodge|escape)\b[^.?!\n]{0,30}\b(?:fees?|charges?|commission|platform)\b/, "OFF_PLATFORM_PAYMENT"],
    [/\b(?:don'?t|do\s+not|no\s+need\s+to)\s+(?:pay|order|buy|checkout)\s+(?:through|on|via|with)\s+(?:the\s+)?(?:app|site|platform|xavier\s*connect|here)\b/, "OFF_PLATFORM_PAYMENT"],
    [new RegExp(String.raw`\b(?:account|acct|a/c|acc)\s*(?:no\.?|number|num|#)?\s*[:\-]?\s*\d[\d\s-]{8,14}\d`), "PAYMENT_ACCOUNT"],
    [new RegExp(String.raw`${BANKS}[^\n]{0,40}\b\d{10}\b|\b\d{10}\b[^\n]{0,40}${BANKS}`), "PAYMENT_ACCOUNT"],
    [/\b(?:bc1|[13])[a-hj-np-z0-9]{25,39}\b/, "PAYMENT_ACCOUNT"], // bitcoin address (lower-cased)
    [/\b0x[a-f0-9]{40}\b/, "PAYMENT_ACCOUNT"], // EVM wallet
    [/\biban\s*[:\-]?\s*[a-z]{2}\d{2}[a-z0-9]{10,30}\b/, "PAYMENT_ACCOUNT"],
  ];
  for (const [re, cat] of block) { const m = lower.match(re); if (m) found.push({ category: cat, severity: "BLOCK", hint: cat === "PAYMENT_ACCOUNT" ? redact(m[0]) : m[0].slice(0, 40) }); }
  // Off-platform payment brands asked about without a clear instruction: a human decides.
  const brand = lower.match(/\b(?:paypal|cash\s*app|zelle|venmo|western\s+union|moneygram|bitcoin|\bbtc\b|usdt|crypto|payoneer|skrill|alipay|wechat\s*pay|weixin\s*pay|gift\s*card)\b/);
  if (brand && !found.length) found.push({ category: "OFF_PLATFORM_PAYMENT", severity: "REVIEW", hint: brand[0] });
  return found;
}

function detectCustom(lower: string, rules: RuleSet): Finding[] {
  const out: Finding[] = [];
  for (const t of rules.blockTerms) if (t && lower.includes(normalizeText(t))) out.push({ category: "CUSTOM_RULE", severity: "BLOCK", hint: t.slice(0, 20) });
  for (const t of rules.reviewTerms) if (t && lower.includes(normalizeText(t))) out.push({ category: "CUSTOM_RULE", severity: "REVIEW", hint: t.slice(0, 20) });
  return out;
}

function dedupe(fs: Finding[]) {
  const seen = new Set<string>();
  return fs.filter((f) => { const k = `${f.category}:${f.hint}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Full text pipeline. ownHosts = the marketplace's own domains (links to listings are fine). */
export function moderateText(text: string, opts: { rules?: RuleSet; ownHosts?: string[]; defaultCountry?: CountryCode } = {}): { decision: Decision; findings: Finding[] } {
  const rules = opts.rules ?? EMPTY_RULES;
  const lower = normalizeText(text);
  const on = (c: Category) => !rules.disabled.includes(c);
  const findings = [
    ...(on("EMAIL") ? detectEmails(lower) : []),
    ...(on("PHONE") ? detectPhones(text.normalize("NFKC").replace(ZERO_WIDTH, ""), lower, opts.defaultCountry) : []),
    ...(on("URL") ? detectUrls(lower, rules, opts.ownHosts ?? []) : []),
    ...(on("MESSAGING_HANDLE") ? detectHandles(lower) : []),
    ...(on("OFF_PLATFORM_PAYMENT") ? detectPayment(lower) : []),
    ...detectCustom(lower, rules),
  ];
  const decision: Decision = findings.some((f) => f.severity === "BLOCK") ? "BLOCKED" : findings.length ? "REVIEW" : "APPROVED";
  return { decision, findings };
}

export const SENDER_BLOCK_MESSAGE =
  "Your message may contain contact information or an external payment request that cannot be shared through XavierConnect. Please edit your message and continue your conversation here.";
