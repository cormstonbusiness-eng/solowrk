# The licence API

What the SoloWrk desktop app expects a licence server to provide. The app side
is already built and shipped — this describes the contract it talks to, so the
server can be built against it without reading the app's source.

Everything here is implemented in `src/main/services/auth.ts` and covered by
`src/main/services/auth.test.ts`.

---

## How the app finds the server

One base URL, set by the user in **Settings → Account**, stored in
`solo.config.json` in the app's `userData` folder. Paths below are appended to
it, with any trailing slash on the base removed first.

```
base https://solowrk.com/api
  →  POST https://solowrk.com/api/licence/activate
```

**An empty base URL turns licensing off entirely** and the app runs ungated.
That is the current default and how every existing install behaves.

---

## The four endpoints

All four are `POST` with a JSON body and a JSON response. Two carry a bearer
token; two do not.

### `POST /account/register`

Creating an account from inside the app.

```jsonc
// request
{
  "name": "Alex Fisher",
  "email": "alex@example.com",
  "password": "…",
  "deviceId": "uuid",
  "platform": "windows",
  "deviceName": "CRAIG-LAPTOP"
}
```

### `POST /licence/activate`

Signing in. Also claims a seat for this device.

```jsonc
// request
{
  "email": "alex@example.com",
  "password": "…",
  "deviceId": "uuid",
  "platform": "windows",
  "deviceName": "CRAIG-LAPTOP"
}
```

### `POST /licence/status`

Re-confirming the licence. Sent with `Authorization: Bearer <token>`.

```jsonc
// request
{ "deviceId": "uuid", "platform": "windows", "deviceName": "CRAIG-LAPTOP" }
```

The app calls this when the user presses **Check licence** in Settings. It is
the endpoint that should say a licence has lapsed, been refunded, or been
revoked.

### `POST /licence/deactivate`

Signing out. Sent with `Authorization: Bearer <token>`. Should release the seat.

```jsonc
// request
{ "deviceId": "uuid", "platform": "windows", "deviceName": "CRAIG-LAPTOP" }
```

The response body is ignored. The app signs out locally regardless of what
comes back, including a failure — a sign-out that refuses to sign you out is
not a sign-out.

---

## The success response

`register`, `activate` and `status` must all return the **same shape**:

```jsonc
{
  "token": "opaque-session-token",
  "account": {
    "email": "alex@example.com",
    "name": "Alex Fisher",
    "plan": "Pro",                          // shown as-is in the UI
    "features": ["assistant", "marketing"], // what the plan unlocks
    "expiresOn": "2027-01-01"               // yyyy-mm-dd, or ""
  }
}
```

- `token` is opaque to the app. It is stored and sent back as a bearer token.
- `plan` is **display text, not an identifier** — write what you want the user
  to read, and reword it whenever you like.
- `features` is **the part the app acts on.** Opaque names, server's choice.
  Today only `assistant` means anything; `marketing` is reserved. Omit it or
  send `[]` for Basic.
- `expiresOn` is shown as "renews …". `""` for a licence that never expires.

**Keep `plan` and `features` separate even though they look redundant.** It is
what lets pricing be restructured — a feature moved between tiers, a tier
renamed, a promotion — without shipping an app release, and without every
install that never updates disagreeing with you about what Pro includes.

Every field except `features` must be present. The app reads them directly.

---

## The error response

Any non-2xx status. If the body is JSON containing `message`, **the app shows
that message to the user verbatim** — so write it for them, not for a log.

```jsonc
{ "message": "This licence was refunded on 3 August." }
```

Without a `message`, the app falls back on the status code:

| Status | What the user sees |
|---|---|
| `401` | That email and password do not match. |
| `402` | This account does not have an active licence. |
| `409` | That licence is already in use on the maximum number of computers. |
| anything else | The account server returned *N*. |

**`402` and `403` are not interchangeable, and picking the wrong one is the
most damaging mistake this server can make.**

- **`402`** — the account is real, the subscription is not paid. The app stays
  signed in and drops to **read-only**: everything opens, nothing can be
  edited, invoices can still be exported. Paying lifts it on the next check
  with no second sign-in. **Use this for every billing failure**, including a
  cancelled subscription that has run out.
- **`403`** — the licence is disowned: refunded, charged back, revoked. This
  **ends the session** and returns the user to the sign-in screen.

Send `403` for a missed payment and you lock a paying customer out of their own
files over a card that expired. Send `402` for a chargeback and you have given
the app away.

Use `409` when the seat limit is reached, with a `message` naming which limit.

---

## Behaviour the server should know about

**Seats are counted per platform, not in total, and they vary by plan.**

| Plan | `windows` | mobile (`ios` / `android`) |
|---|---|---|
| Basic | **1** | — |
| Pro | **2** | **1**, once a mobile app exists |

So a Pro licence allows two computers *and* a phone — not three devices. A
server that stores a single `seats` integer cannot express that, and
retrofitting the distinction later means changing both sides at once. The app
already sends `platform` for exactly this reason; only `windows` is possible
today.

**Seats are keyed on `deviceId`.** A UUID generated once per installation and
stored in `userData`, so it survives app updates and does not change between
sign-ins. It is not a hardware fingerprint — reinstalling Windows produces a
new one, so leave a way to release seats or expire them after inactivity.

**`deviceName` is the machine's own name**, sent so the account page can offer
"release this seat" against something recognisable. Nobody can choose between
four UUIDs. Treat it as display text — it is not unique and not trustworthy.

**Return `409` when the seat limit for that platform is reached**, with a
`message` naming which limit was hit. "You are already using SoloWrk on two
computers. Sign out on one, or release it from your account page." is the sort
of thing a customer can act on.

**The app fails open, and it never fails shut.** If `/licence/status` cannot be
reached, the app treats it as *offline*, keeps working, and retries later.
After **14 days** without a successful check it drops to read-only — it does
not close. Nothing this server can say will lock a signed-in user out of
reading and exporting their own work; the strongest outcome is `403`, which
returns them to the sign-in screen with their files untouched on disk.

**Requests time out after 20 seconds.**

**Nothing about the user's work is ever sent.** No clients, invoices, projects,
files or hours leave the machine — the app only ever sends the four bodies
above. The sign-in screen tells the user this explicitly, so it needs to stay
true.

---

## Building it

Suggested shape for a Next.js site on Vercel:

- `app/api/licence/activate/route.ts` and siblings — one route handler each.
- A database for accounts, licences and seats. Accounts need password hashing
  (argon2 or bcrypt, never anything home-made), email verification and a reset
  flow. Using an auth provider for that part rather than writing it is the
  safer call.
- A Stripe webhook on `checkout.session.completed` creating the licence and, if
  the account is new, emailing a link to set a password.

Minimum tables:

```
accounts   id · email (unique) · name · password_hash · created_at
licences   id · account_id · tier ('basic'|'pro') · status · expires_on
           · stripe_customer_id · stripe_subscription_id
           · seats_windows · seats_mobile · trial_ends_on
devices    id · licence_id · device_id (unique per licence) · platform
           · device_name · last_seen_at
sessions   token (unique) · account_id · device_id · created_at · expires_at

status: 'trialing' | 'active' | 'past_due' | 'canceled'
        past_due and canceled  →  402  →  the app goes read-only
```

---

## Testing against it

Point the app at a server without touching a build: **Settings → Account →
Account server**, then restart. If a wrong address ever locks you at the
sign-in screen, that screen has a **"Can't sign in? Change the account server"**
link that clears it.

`http://localhost:3000/api` works for local development.
