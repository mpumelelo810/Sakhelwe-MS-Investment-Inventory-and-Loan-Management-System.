# Sakhelwe Business Control

Private recordkeeping for Sakhelwe MS Investments: stock, sales, customers, expenses, loans and reports. Live site: https://sakhelwe.netlify.app/. GitHub main automatically deploys to Netlify. A dedicated Supabase project (`hkwmhajogglgqvmxxrxs`) has the schema and row-level security installed.

## Owner setup

The app offers **First time? Create owner account**, prefills `sakhelweinvestment@gmail.com`, checks password confirmation and requires email verification. Only that verified email can bootstrap the first owner; other signups receive no business access. Keep Supabase email confirmation enabled.

Custom SMTP is not configured yet. Supabase default email delivery is restricted to project-team addresses, so self-service confirmation and password reset may be blocked. An owner-linked Auth account is present in the current production project; do not create a duplicate. If the owner cannot sign in before SMTP is configured, an administrator should recover the existing account through Supabase Authentication. Never put passwords in chat, SQL or GitHub.

Sign in online once on each device using the same account. Extra helpers require separate Auth accounts and explicit staff roles; do not share the owner password.

## Connected and offline records

Cloud mode caches the last authorized snapshot and saves new entries to a durable, per-user IndexedDB outbox. The app syncs on reconnect, focus and every 30 seconds while visible. Pending entries are displayed separately and excluded from confirmed totals. First use requires an online authorized snapshot. A closed app syncs when reopened; this is not guaranteed background sync.

Retries keep the original UUID, so a lost response does not create duplicate ledger entries. Rejected entries remain visible, block later queued entries, and can be retried explicitly. Server date/order, cash and stock checks still apply. Concurrent devices can cause conflicts, especially older offline entries after newer cloud records; there is no automatic overwrite or conflict editing yet. Newly queued products/customers cannot be used in dependent forms until confirmed. Download the pending-entry backup if a conflict needs administrator assistance.

The downloadable `dist/Sakhelwe-Offline.html` embeds all assets and supports the same cloud account plus offline queue. Its legacy **device workspace** is separate and does not sync or merge. Existing device-only data must be retained/exported separately. Sample data is temporary. Local caches and backups are not encrypted; browser-data deletion can remove unsynced records. Use protected personal devices and keep backups.

The hosted edition is installable as a web app with the Sakhelwe drumstick icon. First installation requires internet. Close old app tabs and reopen after updates so the new service worker activates.

## Development and deployment

Use Node.js 24:

```bash
npm ci
npm run dev
npm test
npm run build
```

Build produces `dist` and the standalone download. `netlify.toml` configures publication. Supabase URL and publishable key are public client configuration; never expose service-role credentials. Environment variables can override defaults.

For a new dedicated database apply, in order: `database/schema.sql`, `database/sync-api.sql`, `database/owner-onboarding.sql`. Do not rerun the initial schema against an existing configured database. Set the Supabase Site URL to the published app URL and configure SMTP before self-service signup/password reset.

## Integrity and verification

Server transactions atomically post ledger, stock and audit changes. Exact numeric money, FIFO costing, nonnegative cash, protected staff roles and actor/payload idempotency checks are enforced. All ten public business tables have RLS; writes use controlled RPCs. Sync RPCs bind requests to the expected signed-in user. On 10 October 2026, the audit found that the unused legacy `sakhelwe_apply_loan_interest` RPC could be executed anonymously; the production migration now revokes execute permission from `PUBLIC`, `anon` and `authenticated`, and a verification query confirmed that only the database owner can execute it. Remaining Supabase advisor warnings include leaked-password protection being disabled and three authenticated `SECURITY DEFINER` RPCs; the latter check for authorized staff and are called by the app. Enable leaked-password protection in Supabase Auth settings if the project plan supports it, and do not revoke the app's RPCs without updating and testing the frontend.

All 19 automated tests cover ledger calculations, permissions, customer registration, livestock catalogue repair, Excel workbook packaging, offline persistence, reconnect syncing, rejected entries and lost-response retries. The production build passes. Actual browser login and synchronization between two physical devices still require acceptance testing on the live site.

## Limits

This app records money; it does not transfer funds. Remaining controls include authorized ledger corrections, opening legacy balances, period closing, evidence uploads, cash-account separation, expense allocation, backup/restore rehearsal and deployed authenticated acceptance. VAT and statutory financial reports are not calculated. Loan interest is fixed at 30% per month and compounds automatically from the due date.


## Chicken batch cycle accounting

Chicken records are now organized by month and automatic batch letters, for example **September 2026 — Batch A**, then Batch B for another September intake. Each batch keeps its own day-old chick cost, batch expenses, mortality, growing/ready status, live and dressed stock, sales, paid/owing amounts and profit. At six weeks the batch is shown as **Ready Batch**. When all birds are accounted for, the owner can close the cycle and the site keeps a final batch report showing total costs, revenue, money received, outstanding amounts and profit/loss. Monthly chicken totals are also shown separately.
