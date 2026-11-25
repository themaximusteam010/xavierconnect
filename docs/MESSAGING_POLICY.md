# Private messaging, contact protection and moderation — policy and design

## Purpose
Buyers and sellers talk inside XavierConnect so that orders, payments and disputes stay protected. Sharing direct
contact details or arranging payment outside the platform is not allowed in private messages.

## Who can read a conversation
| Who | What they can see |
|---|---|
| The customer | Their own conversations. |
| A store's team | Conversations of stores where their role grants the `messages` capability (owner, vendor staff). |
| Moderators (`messages.moderate`, MFA required) | **Only**: messages the automatic checks held or blocked; attachments awaiting review; the transcript of a conversation **while it has an open user report**. |
| Everyone else, including other staff | Nothing. There is no "browse all conversations" screen. |

Every moderator decision, every transcript view and every flagged-attachment view is written to the audit log
(`moderation.*` actions) and listed under Admin → Message moderation → Moderation log.

## How a message is processed (server-side, before delivery)
1. Receive and authorise (participant check, messaging restriction, conversation block, rate limit).
2. Normalise: Unicode NFKC (full-width digits/letters), zero-width characters removed, look-alike letters mapped, lower-cased.
3. Contact detection: email (plain and obfuscated: "at/dot", brackets, provider names) and phone numbers — parsed and validated with `libphonenumber-js` (country codes, Nigerian default), including spelled-out digits, separators and letter look-alikes.
4. Link detection with `linkify-it`: messaging/social/link-shortener domains, payment domains and any external domain. Links to XavierConnect and admin-allowed domains are fine.
5. Messaging handles: a platform name (WhatsApp, Telegram, WeChat, Instagram, …) **together with** contact intent ("chat me on", "my id is", "send … via"). A bare mention ("does it support WhatsApp?") is allowed. A bare `@handle` is held for review.
6. Payment solicitation: "pay directly / outside the app / avoid fees", account numbers next to bank names, IBANs, crypto wallet addresses. Asking about PayPal/crypto without an instruction is held for review.
7. Attachments: type + signature check (JPG, PNG, WebP, PDF; ≤ 4 MB), optional ClamAV scan, images re-encoded (metadata and appended data removed), OCR (Tesseract, bundled English data) and QR decoding (jsQR); the OCR/QR text goes through steps 3–6. Any QR code blocks the image. PDFs are always reviewed by a moderator (no text extraction). Any inspection error ⇒ review, never approval.
8. Decision: **APPROVED** (delivered) · **BLOCKED** (not delivered; sender sees the standard warning and keeps the draft) · **REVIEW** (held; only the sender sees it, marked "In review") · **ATTACHMENT_BLOCKED** (text delivered, file not stored and never exposed).

Only DELIVERED messages and APPROVED attachments are ever returned to the recipient — by the page, the history API
and the live stream alike. Notifications never contain message text.

## Enforcement (configurable in Admin → Settings)
Confirmed violations (automatic blocks; moderator rejections ticked "count as a violation") within
`msgViolationWindowDays` (30):
1. First: warning shown to the sender.
2. `msgRestrictAfter` (3) or more: sending paused for `msgRestrictHours` (24).
3. `msgReviewAfter` (5) or more: account flagged for moderator review + admin alert.
4. Suspension: only an authorised administrator, from the user's page. Never automatic.
Messages held for review are not violations unless a moderator confirms them.

## Retention
Blocked message text is replaced with "[removed under retention policy]" and unreleased attachments are deleted
after `msgBlockedRetentionDays` (90) by the daily job. Delivered conversations are kept for the account's lifetime
(order and dispute evidence). Moderation events keep only categories and redacted hints (e.g. "+234 …4567").

## Known limitations
- Text in non-Latin scripts (e.g. Chinese) is not OCR'd (English model only) and is only checked by the text rules.
- Letter-spaced platform names without a number ("w h a t s a p p me") are not detected.
- PDFs are not text-scanned; they wait for a moderator.
- Real-time uses Server-Sent Events with database polling (1.5 s ticks, 25 s connections). Suitable for current
  scale; a pub/sub service (e.g. Postgres LISTEN/NOTIFY or a hosted realtime provider) would reduce database load at
  high volume.
- The in-process send rate limit (30/min) is per server instance.
