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
    "features": ["marketing", "chasing"],   // legacy; see below
    "expiresOn": "2027-01-01"               // yyyy-mm-dd, or ""
  },
  "licence": "eyJ2IjoxLC...Qw.7mK9...bA"    // Ed25519, and the part that counts
}
```

- `token` is opaque to the app. It is stored and sent back as a bearer token.
  It authenticates the *session*; it grants nothing.
- **`licence` is what actually grants anything.** An Ed25519-signed token the
  app verifies offline against a public key compiled into the binary. Its
  claims are in §3.2 of the Pricing spec. Absent means nothing granted, which
  the app treats as Free rather than as an error.
- `plan` is **display text, not an identifier** — write what you want the user
  to read, and reword it whenever you like.
- `features` is **legacy.** Builds before the signed licence read it; current
  builds ignore it entirely and derive everything from the tier inside
  `licence`, using the same entitlement map they ship with. Keep sending it
  until those builds are gone.
- `expiresOn` is shown as "renews …". `""` for a licence that never expires.

**Why the licence is signed.** The account-server URL is editable from the
app's own Settings screen. While the feature list arrived as plain JSON,
anybody could point SoloWrk at a server of their own and grant themselves Pro.
Forging one now means breaking Ed25519. It is also what makes a lifetime
licence possible: verification touches no network, so somebody who bought one
can be offline for a decade and still be Pro.

**Keep `plan` and the tier separate even though they look redundant.** `plan`
is a sentence for a human — "Pro · payment needed", "Trial", "Free" — and the
tier is a fact the app acts on. Merging them means every wording change is a
release.

Every field except `features` and `licence` must be present. The app reads
them directly.

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
| Free | **1** | — |
| Basic+ | **2** | — |
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

**`fingerprint` is the hardware one**, and is what the signed licence is bound
to. Hashed motherboard serial and machine GUID, never the MAC address, which
changes with a dock. It is a one-way hash: the serials themselves never leave
the machine, because the sign-in screen promises only the licence, the email
and the computer's name are sent. It can be **absent** — a virtual machine or
an OEM board with a blank serial produces nothing usable — and a server that
refuses those refuses paying customers on the strength of their BIOS. Fall
back to `deviceId`.

**`deviceName` is the machine's own name**, sent so the account page can offer
"release this seat" against something recognisable. Nobody can choose between
four UUIDs. Treat it as display text — it is not unique and not trustworthy.

**Return `409` when the seat limit for that platform is reached**, with a
`message` naming which limit was hit. "You are already using SoloWrk on two
computers. Sign out on one, or release it from your account page." is the sort
of thing a customer can act on.

**The app fails open, and it never fails shut.** If `/licence/status` cannot be
reached, the app treats it as *offline*, keeps working, and retries later.
After **14 days** past the licence's own expiry it drops to **Free** — never to
read-only, and never to a wall. Read-only was removed as a state entirely: a
lapsed licence is a Free one, fully editable, and only *creating* past a Free
limit is refused. Nothing this server can say will lock a signed-in user out of
their own work; the strongest outcome is `403`, which returns them to the
sign-in screen with their files untouched on disk.

**`402` means "raise a banner", not "stop".** It is the failed-payment case.
The app keeps the licence it already holds and shows a line saying the card
needs updating — §3.4 holds the tier open through Stripe's retry window plus
five days, because somebody whose card merely expired should not lose anything
in the week they are least pleased with you.

**A cancelled subscription answers `200`, not `402`.** It keeps the tier it
paid for, forever, and loses only updates — issue it a licence with
`expires_at: null` and `updates: false`. Sending an expiry would make "working
forever" run out on its own a month later.

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
