# Brief: the SoloWrk website

For whoever builds it. Nothing exists yet — no repo, no code, no domain. This
says what needs to be there and why, so it can be built in one go rather than
discovered piece by piece.

The API contract the desktop app already speaks is in **`docs/licence-api.md`**
beside this file. **Copy that file into the website repo** once it exists —
both sides need it, and it is the one document that must not drift.

---

## What this is

SoloWrk is a Windows desktop app for freelancers: clients, projects, time,
invoices, quotes, expenses, and an optional AI assistant. Everything is stored
locally in a folder the user picks. No cloud, no sync.

It is **a Blockout Digital product** — Blockout is the developer, SoloWrk is
the product, and this is SoloWrk's own site, not a page on blockoutdigital.com.
A "by Blockout Digital" credit is appropriate; Blockout's branding is not.

The site has three jobs:

1. **Sell it.** Explain what it does, what it costs, and take payment.
2. **Accounts.** Sign up, sign in, and a page showing the licence and which
   computers are using it.
3. **Serve the app.** Four API endpoints the installed app calls to activate,
   re-check and release licences.

---

## The product, for writing copy

The pitch is **local-first**. Everything lives in a folder on the user's own
machine — real files and one SQLite database — and keeps working with no
internet. Uninstalling the app does not touch the data, and moving it to
another computer is a folder copy.

That is the differentiator against every subscription SaaS in this space, and
it is worth being specific rather than vague about it. The desktop app's own
first screen says: *"no cloud account, no sync, no subscription holding your
files."*

The account exists **only for the licence**. No work data ever leaves the
machine — the app sends nothing but an email, a password and a device id. The
sign-in screen inside the app states this plainly, so the website should not
contradict it.

What it does today: clients and a contact directory, projects and tasks, time
tracking, invoices and quotes with PDF generation, expenses, a finance summary
with tax set-aside, a calendar, notes, documents, goals, a business plan the
assistant reads, and an AI assistant. Marketing exists but is being greyed out
as coming soon. Windows only.

---

## Stack

Nothing is fixed, so this is a recommendation rather than a constraint:
**Next.js on Vercel, with Postgres**. Reasons — the API routes the app needs
are trivial there, deployment is a git push, and it is the stack already in use
for blockoutdigital.com, so it is one fewer thing to learn.

For accounts, **use an auth library or provider rather than writing it**.
Password hashing, email verification, resets and session handling are all
things that look simple and have sharp edges. Supabase, Auth.js or Clerk all
work; hand-rolled does not.

---

## Payments

**Stripe**, using **Managed Payments** — where Stripe is the merchant of record
and handles VAT and sales tax. Confirm what that covers before building
anything tax-related, since it may remove the need entirely.

The flow:

```
Checkout  →  webhook (checkout.session.completed)
          →  create or find the account
          →  create the licence
          →  email a link to set a password if the account is new
```

Decisions still open, and they change the schema: **one-off purchase or
subscription**, and **how many computers per licence**. A freelancer commonly
has a laptop and a desktop, so one seat is often too strict.

---

## The account system

Minimum tables:

```
accounts   id · email (unique) · name · password_hash · created_at
licences   id · account_id · plan · status · seats · expires_on · stripe_customer_id
devices    id · licence_id · device_id (unique per licence) · last_seen_at
sessions   token (unique) · account_id · device_id · created_at · expires_at
```

Pages: sign up, sign in, password reset, and an account page showing the
licence, its seats, which computers are using them, and a way to release one —
people replace laptops, and a seat they cannot free is a support email.

API routes: the four in `docs/licence-api.md`, plus the Stripe webhook.

---

## The two easiest things to get wrong

**Error messages are customer-facing.** The desktop app takes the `message`
field from any non-2xx JSON response and shows it to the user word for word.
Write them for a person: *"This licence was refunded on 3 August"*, not
`ERR_LICENCE_INVALID`.

**The app fails open.** An unreachable server means *offline*, not
*unlicensed* — the app keeps working and retries, and only stops after 14 days
without a successful check. A server outage must not lock someone out of their
own invoices. Do not design around the server always being reachable.

---

## Also needed before taking money

- Terms, privacy policy and refund policy. Selling digital goods to UK and EU
  consumers carries statutory cancellation rights unless waived at purchase.
- A download page. Installers are published at
  `github.com/cormstonbusiness-eng/solowrk-releases/releases/latest` — the site
  can link straight to it, and the app updates itself from there afterwards.
- Something honest about the SmartScreen warning on first install, since the
  installer is not code-signed. That warning loses sales if it is a surprise.

---

## Testing against the app

No rebuild needed. In SoloWrk: **Settings → Account → Account server**, set it
to `http://localhost:3000/api`, restart, and the app talks to a local dev
server. If a wrong address ever strands you at the sign-in screen, that screen
has a **"Can't sign in? Change the account server"** link that clears it.
