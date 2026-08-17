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
base https://www.blockoutdigital.com/api
  →  POST https://www.blockoutdigital.com/api/licence/activate
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
{ "name": "Alex Fisher", "email": "alex@example.com", "password": "…", "deviceId": "uuid" }
```

### `POST /licence/activate`

Signing in. Also claims a seat for this device.

```jsonc
// request
{ "email": "alex@example.com", "password": "…", "deviceId": "uuid" }
```

### `POST /licence/status`

Re-confirming the licence. Sent with `Authorization: Bearer <token>`.

```jsonc
// request
{ "deviceId": "uuid" }
```

The app calls this when the user presses **Check licence** in Settings. It is
the endpoint that should say a licence has lapsed, been refunded, or been
revoked.

### `POST /licence/deactivate`

Signing out. Sent with `Authorization: Bearer <token>`. Should release the seat.

```jsonc
// request
{ "deviceId": "uuid" }
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
    "plan": "Solo",          // shown as-is in the UI. "" is fine
    "expiresOn": "2027-01-01" // yyyy-mm-dd, or "" for a licence that never expires
  }
}
```

- `token` is opaque to the app. It is stored and sent back as a bearer token.
- `plan` is display text, not an identifier — write what you want the user to
  read.
- `expiresOn` is shown as "renews …". Use `""` for a one-off purchase.

Every field must be present. The app reads them directly.

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

Use `402` for a valid account with no licence, and `409` when the seat limit is
reached — those two are the cases worth getting right, because they are the
ones a paying customer will actually hit.

---

## Behaviour the server should know about

**Seats are keyed on `deviceId`.** A UUID generated once per installation and
stored in `userData`, so it survives app updates and does not change between
sign-ins. It is not a hardware fingerprint — reinstalling Windows produces a
new one, so leave a way to release seats or expire them after inactivity.

**The app fails open.** If `/licence/status` cannot be reached, the app treats
it as *offline*, keeps working, and retries later. Only a response that
actually says no ends the session. After **14 days** without a successful check
the app stops. So a server that is down does not lock out your customers, but a
cancelled licence still takes effect within a fortnight.

**Requests time out after 20 seconds.**

**Nothing about the user's work is ever sent.** No clients, invoices, projects,
files or hours leave the machine — the app only ever sends the four bodies
above. The sign-in screen tells the user this explicitly, so it needs to stay
true.

---

## Building it

Suggested shape, given the site is Next.js on Vercel:

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
licences   id · account_id · plan · status · seats · expires_on · stripe_customer_id
devices    id · licence_id · device_id (unique per licence) · last_seen_at
sessions   token (unique) · account_id · device_id · created_at · expires_at
```

---

## Testing against it

Point the app at a server without touching a build: **Settings → Account →
Account server**, then restart. If a wrong address ever locks you at the
sign-in screen, that screen has a **"Can't sign in? Change the account server"**
link that clears it.

`http://localhost:3000/api` works for local development.
