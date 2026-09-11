# يلا نسافر · Yala Nsafr

Intercity carpooling for Egypt. Drivers post trips they are already making, passengers
book a seat, and the platform holds the fare in escrow until the trip completes — taking
a 7% commission and paying the driver out to a mobile wallet or bank account.

| | |
|---|---|
| **Backend** | NestJS 11 · PostgreSQL + PostGIS · Redis · TypeORM |
| **Mobile** | Flutter (Dart SDK ≥ 3.3), Riverpod, GoRouter — Arabic-first, RTL |
| **Payments** | Kashier (authorize → capture escrow, plus payouts) |
| **Push** | Firebase Cloud Messaging |
| **Tests** | 111 end-to-end tests against a real Postgres instance |

The marketing site lives separately at
[and222row/yala-nsafr-website](https://github.com/and222row/yala-nsafr-website).

---

## What it does

**Trips & booking** — search by route and date, seat availability, women-only trips,
preferences (smoking, pets, luggage, A/C, chattiness), per-trip comments and group chat,
live driver location while a trip is running, and an SOS button for every participant.

**Money** — card and wallet payments are *authorized* at booking and only *captured*
when the driver ends the trip, so a passenger's funds are held rather than taken.
Cancellations resolve by policy (free cancel → void the hold, late cancel → capture then
partially refund, no refund → capture in full). Cash trips skip escrow entirely and are
tracked for commission only.

**Drivers** — verification, earnings broken down per trip, withdrawals to Vodafone Cash /
InstaPay / bank, and subscription-gated trip posting.

**Trust & safety** — two-sided ratings revealed after both parties submit (or after 7
days), disputes with admin mediation, user blocking, and an escalating ban for drivers who
repeatedly cancel (3 strikes → 7-day posting ban, 5 → 30 days, 10 → suspension).

**Automation** — scheduled jobs send pre-departure reminders, auto-cancel abandoned trips,
auto-reject bookings a driver never answers, reveal expired ratings, and reconcile payouts
against Kashier.

---

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 16 with PostGIS
- Redis
- Flutter SDK ≥ 3.3
- A Kashier account (test mode is enough — see [Kashier setup](#kashier-setup))

### 1. Database

`backend/docker-compose.yml` brings up Postgres (with PostGIS) and Redis:

```bash
cd backend && docker compose up -d
```

Running Postgres natively instead? Create the role and database to match `.env`:

```bash
psql -U postgres -c "CREATE USER yala_user WITH PASSWORD 'yala_pass';" -c "CREATE DATABASE yala_nsafr OWNER yala_user;"
```

### 2. Backend

```bash
cd backend && npm install && cp .env.example .env
```

Fill in `.env` — at minimum `JWT_SECRET` and the `KASHIER_*` values. Leave
`SMS_PROVIDER=stub` and OTP codes are written to the console instead of being texted.
Set `PAYMENT_MOCK=true` to work without Kashier credentials at all.

```bash
npm run start:dev
```

The API serves on `http://localhost:3000/api/v1`.

> **Schema is created by TypeORM `synchronize`, which is enabled only when
> `NODE_ENV=development`.** There are no migrations yet, so a production deploy will not
> create or alter tables. See [Known gaps](#known-gaps).

### 3. Mobile app

```bash
cd mobile && flutter pub get
```

The app talks to `http://localhost:3000/api/v1`
([`api_client.dart`](mobile/lib/core/api/api_client.dart)). On a **physical Android
device `localhost` is the phone, not your machine**, so map the port back over USB — once
per device, and again after any reconnect:

```bash
adb -s DEVICE_ID reverse tcp:3000 tcp:3000
```

```bash
flutter run -d DEVICE_ID
```

Testing driver and passenger side by side is easiest with two devices in two terminals
(`flutter run -d all` works too, but interleaves the logs).

---

## Kashier setup

Kashier splits its API across two hosts, and sending a call to the wrong one returns a
bare `404` that looks like a missing record:

| Host | Handles |
|---|---|
| `api.kashier.io` | payment sessions, payment status, payout reads |
| `fep.kashier.io` | order operations — `CAPTURE`, `VOID`, `REFUND` — and creating transfers |

Prefix both with `test-` for sandbox.

### Account prerequisites

Two things must be enabled by Kashier before the escrow flow works at all:

1. **Authorization Capture** — without it, sessions charge the passenger immediately
   instead of placing a hold, so there is nothing to capture when the trip ends. Requires
   approval from your account manager.
2. **The `refund` permission** on your key's role — voids and refunds return `403`
   without it, which breaks cancellations and booking rejections.

Also note authorization holds **expire after 7 or 30 days** depending on configuration. A
trip booked further ahead than that can no longer be captured, so keep
`MAX_TRIP_LEAD_DAYS` in [`trips.service.ts`](backend/src/modules/trips/trips.service.ts)
inside your window.

### Webhooks

Register **two separate endpoints** — the payloads and signature schemes differ, and a
transaction event delivered to the payout endpoint is silently dropped:

| Events | Endpoint |
|---|---|
| Transaction (authorize, capture, refund…) | `POST /api/v1/kashier/webhooks/transaction` |
| Transfer (initiated, transferred, failed) | `POST /api/v1/kashier/webhooks/transfer` |

Both are verified via the `x-kashier-signature` header, but **do not share a verifier**:

- **Payment** webhooks sort `signatureKeys` alphabetically, URL-encode each value, and key
  the HMAC with the **Payment API Key**.
- **Payout** webhooks use `signatureKeys` in array order with raw values, keyed with the
  **Transfer API Key**.

For local development, expose your machine and point `APP_URL` at the same address. A
fixed subdomain saves re-registering the webhooks every restart:

```bash
npx localtunnel --port 3000 --subdomain your-subdomain
```

### Sandbox payouts

The sandbox picks a transfer outcome from the recipient number — anything unlisted is
treated as an unknown recipient and fails:

| Recipient | Outcome |
|---|---|
| `01111111111` | success → `TRANSFERRED` |
| `01111111112` | timeout → `IN_TRANSIT` |
| `01111111113` | invalid recipient → `FAILED` |
| `01111111114` | insufficient funds → `FAILED` |

A successful transfer settles asynchronously and stays `openForReturn` (the wallet can
still bounce it back), so withdrawals are confirmed by webhook — or by the reconciliation
job, which re-checks recent payouts directly against Kashier.

---

## Tests

```bash
cd backend && npm run test:e2e
```

These run against the **real development database** rather than mocks, with Kashier calls
stubbed. Two consequences worth knowing:

- Jest sets `NODE_ENV=test`, which disables `synchronize` — so the schema must already
  exist. Start the dev server once after adding an entity field, or apply the column by
  hand, before running the suite.
- Tests that invoke scheduled jobs sweep the whole table. They shield rows they do not
  own and restore them afterwards, so a real trip or withdrawal is not cancelled by a test
  run. Keep that in mind when adding coverage for a cron.

---

## Layout

```
backend/          NestJS API
  src/modules/    admin auth blocks bookings disputes earnings location messages
                  notifications payments ratings scheduler sos subscriptions trips
                  upload users
  src/database/   entities
  test/           end-to-end suite
mobile/           Flutter app (lib/core, lib/features, lib/shared)
```

---

## Known gaps

- **No migrations.** `backend/src/database/migrations/` is empty and unwired, and
  `synchronize` only runs in development — so nothing creates the schema in production.
  This must be resolved before any deploy.
- **Payout webhook signature is unverified against a real delivery.** It follows the
  documented algorithm, but Kashier publishes no test vector for it. If payout webhooks
  start being rejected, the error log prints both the received header and the computed
  payload.
- **Push notifications need FCM credentials** (`FCM_*` in `.env`); without them
  notification sends fail silently in the log.

---

## License

No license has been chosen yet. All rights reserved by default — if you intend this to be
reusable, add a `LICENSE` file.
