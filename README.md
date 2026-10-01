# Sakhelwe Business Control

A web application for Sakhelwe MS Investments to record chicken and pig stock, sales, customer accounts, expenses and loans. This rebuild replaces the earlier device-only cash tracker with a React interface and a PostgreSQL transaction service prepared for Supabase and Netlify.

## Current status

- The production build passes.
- Ten automated tests pass using embedded PostgreSQL through PGlite, the JavaScript reporting model and a built-interface test in a simulated DOM.
- The app includes a clearly labelled, session-only sample workspace.
- A dedicated live Supabase project has NOT been created. The account's two active free-project slots were occupied, and the owner chose to keep both existing projects running.
- Netlify publication has NOT been completed. Sign-in remains pending.
- The built-interface test opens the sample workspace, navigates all eight pages and records a stock delivery without a runtime error. It does not verify browser layout.
- Browser layout and live Supabase authentication, multi-session concurrency, backups and restoration have NOT been verified. Do not use this release for live business money until those checks and the outstanding controls below are complete.

## Implemented flows

1. Register products and customers.
2. Record verified capital contributions before paying for stock or making loans.
3. Receive paid stock deliveries with quantities, supplier and acquisition cost.
4. Sell stock using FIFO purchase costs. Stock units and pricing units are separate, so one animal can be priced by its measured weight.
5. Record fully paid walk-in sales or partial customer payments on credit sales.
6. Capture stock losses with a reason and expenses against a business section.
7. Approve an explicit annual loan policy, issue one active loan per eligible customer and record repayments.
8. Calculate simple daily interest on outstanding principal with actual days / 365. Allocate repayments to interest first, then principal. Accrual and repayment dates cannot precede the latest business entry.
9. Transfer operating cash to a reserve account without treating the transfer as an expense.
10. Review monthly sales, batch costs, expenses and posted interest income separately from current cash and debt. Download CSV records, export journal lines and print transaction records.

The recorded-profit report includes posted interest only. Loan accounts also show interest accrued through today that has not yet been posted. Use **Post earned interest** for active loans at month end before reviewing profit. Shared costs are shown once under Business and included once in combined results; allocation to individual sections is not implemented.

## Run locally

Use Node.js 24 and npm.

```bash
npm ci
npm run dev
```

Open the address Vite prints. Without database environment variables, choose **Open sample workspace**. Demo changes exist only in memory and reset when leaving or refreshing the app. Sample and live data are never merged.

```bash
npm test
npm run build
npm run preview
```

## Set up a dedicated Supabase project

1. Create a NEW Supabase PostgreSQL project on the free plan after a project slot becomes available. This setup must not be applied to an unrelated application's database.
2. Run `database/schema.sql` once in its SQL editor. The transaction creates the tables, row access policies and functions. If it fails, it rolls back. Do not rerun it against an already configured project.
3. In Supabase Authentication, create the owner's email/password account using the dashboard. Keep public signups disabled for this staff-only workspace.
4. Grant that existing Auth user access with `database/bootstrap-owner.sql`, replacing the sample email with the owner's address. Do not put passwords in SQL or GitHub.
5. Copy `.env.example` to `.env` locally. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using the project's URL and publishable key. Never use a secret key or a `service_role` key in a browser or a `VITE_` variable.
6. Set the production Site URL and permitted password-reset redirect URLs under Supabase Authentication URL configuration.
7. Enable strong passwords and the available Auth security controls. Review Supabase security advisors before live use.

Additional staff are created in Auth by the owner, then granted a role through the SQL editor:

```sql
insert into public.sakhelwe_staff(user_id, role)
select id, 'cashier' from auth.users where email = 'cashier@example.com';
```

Roles are stored in a protected table, not user-editable profile metadata. Owner can configure products/policies, contribute capital, issue loans and transfer reserve cash. Cashier can receive stock, register customers, record sales, losses, expenses and repayments. Analyst is a trusted internal read-only role; this release gives it access to customer records and exportable reports, so do not grant it to external users. No user can directly change or delete the posted ledger through the Data API.

## Publish on Netlify

1. Sign in to Netlify and import this GitHub repository.
2. Choose the `main` branch. `netlify.toml` sets `npm run build`, publish directory `dist` and Node.js 24.
3. Add the two `VITE_` environment variables in Netlify's project environment settings. Use only the public project URL and publishable key.
4. Deploy. Netlify will rebuild subsequent pushes to `main` when GitHub integration is active.
5. Open the resulting `netlify.app` URL, configure it in Supabase Auth and verify an owner sign-in, a cashier sign-in and an unapproved account. Confirm password-reset links return to the app.

The code can be deployed before the dedicated database is available; in that state it offers the sample workspace and clearly states that the live database is pending. A demo deployment is not a live financial system.

## Data integrity and security

- Every business operation posts its stock effects, invoice/loan changes, journal lines and audit event in one database transaction.
- A transaction-level advisory lock serializes writes for the single business, guarding simultaneous last-stock sales and competing loans. The deployment still needs a real PostgreSQL two-session concurrency test.
- A unique request UUID, actor and payload check makes identical retries idempotent and rejects reuse for changed inputs.
- Database money uses exact `numeric` fields. FIFO batch costing assigns any rounding remainder when a batch is exhausted.
- Cash cannot become negative. Walk-in credit sales, overpayments and new loans while debts remain are rejected.
- Tables have RLS and authenticated read grants. Client write grants are revoked. Explicitly authorized internal functions perform controlled changes after checking the authenticated staff role.
- Privileged functions are kept in a private schema with fixed empty search paths, explicitly revoked public execution and authenticated membership checks. Public RPC wrappers use security invoker.
- CSV export quotes values and neutralises common spreadsheet formula prefixes.
- Real customer records, password files and secret keys must never be committed to this repository.

## Scope still to implement before live financial use

This is a tested development release, not a replacement for all requirements in the design guide. Remaining work includes authorised reversal/replacement of posted entries, period closing, opening legacy loan and stock balances, private evidence uploads, cash-account separation by payment method, expense allocation across sections, backup/restore rehearsal, owner usability acceptance and deployed end-to-end verification. VAT and statutory financial reporting are not calculated. Printable records are explicitly labelled as transaction records, not tax invoices. This app records money; it does not move money or perform bank/mobile-money transactions.

Loan rates are never seeded for the live workspace. The owner must approve the chosen terms, allocation method and daily calculation before lending is enabled. Do not infer terms from sample data or an older project.

## Files

- `src/main.jsx`: UI, forms, sign-in, reports and printable records.
- `src/model.js`: demo engine, reporting calculations and CSV output.
- `src/style.css`: responsive design and print styling.
- `database/schema.sql`: Supabase PostgreSQL schema and transaction functions.
- `database/bootstrap-owner.sql`: access setup for an existing Auth user.
- `tests/`: database integrity, access and reporting checks.
- `netlify.toml`: build, redirect and response-header configuration.

## Original project goal

Sakhelwe MS Investment needs a reliable way to manage chicken stock, pig stock and customer loans. Without connected delivery notes, receipts and customer histories, it is difficult to verify stock, control lending, track cash and calculate monthly profit. The business needs one simple system that supports daily operations.


## Dedicated database provisioned

Sakhelwe Business Control (`hkwmhajogglgqvmxxrxs`) is provisioned on the free plan in eu-west-1. The initial schema is installed; all ten public Sakhelwe tables have RLS enabled and the security advisor returned no findings. The app includes the public project URL and publishable key as defaults; environment variables can override them. These are client configuration, never a service-role key.

The owner Auth account and staff membership still need setup. Netlify deployment and authenticated save/reload verification remain pending. Do not enter business records in the sample workspace.
