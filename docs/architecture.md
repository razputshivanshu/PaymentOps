# Architecture

This document describes the code in this repository. It is an independent engineering demo inspired by recurring-payment reliability challenges, not Aura Gold's production architecture.

## Services

```text
Dashboard (React / Vite)
         │ HTTP
         ▼
FastAPI ───────► PostgreSQL
   │                 ▲
   │                 │ attempts, retry state, ledger
   ▼                 │
Redis Streams ──► Go worker
```

- **React dashboard:** Reads data from FastAPI and submits mandate and webhook requests. It never connects to PostgreSQL or Redis directly.
- **FastAPI:** Creates mandates, accepts payment webhooks, stores new events, publishes them to Redis, and serves dashboard read endpoints.
- **PostgreSQL:** Stores mandates, payment events, attempts, and ledger entries. The ledger is the persisted record of successful financial effects.
- **Redis Streams:** Delivers accepted webhook events to a consumer group for asynchronous processing.
- **Go worker:** Reads stream messages, updates PostgreSQL in transactions, schedules failed-payment retries, and recovers idle pending messages.
- **Metrics:** FastAPI serves `/metrics`; the worker serves `/metrics` on port `9090`.

The “payment provider” is simulated in the worker. A successful webhook produces a successful attempt. A failed webhook produces a failed attempt; the later retry is assumed to succeed. No external payment provider is called.

## Successful payment flow

1. The dashboard submits a webhook to `POST /webhooks/payment`.
2. FastAPI checks `event_id`. If it is new, it writes a `payment_events` row and publishes the event to the `payment_events` Redis stream.
3. The Go worker reads the message and starts a PostgreSQL transaction.
4. The worker locks the mandate and checks whether the payment already has a `GOLD_CREDIT` ledger entry.
5. For a new successful payment, it writes a successful attempt, a ledger entry, and the event's `PROCESSED` status in one transaction.
6. After the transaction commits, the worker ACKs the Redis message.

The dashboard can observe the persisted database records. It does not expose Redis ACK state.

## Failed payment and retry flow

For a webhook with `provider_status: FAILED`, the worker stores a failed attempt and `next_retry_at` in PostgreSQL, marks the webhook event processed, commits, and ACKs the stream message. The worker checks for due retries in its loop. The demo delay is fixed at 10 seconds; it is not exponential backoff. The retry assumes success and writes a second successful attempt and one ledger entry in a transaction.

## Idempotency

The demo uses two separate keys:

- **Webhook delivery:** `payment_events.event_id` is unique. Repeating the same event ID returns `duplicate` from FastAPI and does not insert another event row.
- **Financial effect:** The worker checks for a ledger entry with the same `payment_id` and `GOLD_CREDIT` type. The ledger table also has a unique constraint on that pair. This protects against a second event for a payment that already succeeded.

An event status describes webhook processing, not the payment outcome. A failed payment webhook can have status `PROCESSED` while its attempt is `FAILED` and waiting for retry.

## Main API routes

| Route | Purpose |
|---|---|
| `POST /mandates` | Create a mandate |
| `GET /mandates` | List mandates for the dashboard |
| `POST /webhooks/payment` | Accept a payment event |
| `GET /payments` | List payment summaries |
| `GET /payments/{payment_id}` | Read attempts, events, and ledger rows for a payment |
| `GET /events` | List recent webhook events |
| `GET /attempts` | List recent payment attempts |
| `GET /ledger` | List recent ledger entries |
| `GET /health`, `/health/db`, `/health/redis` | Check API, PostgreSQL, and Redis separately |
| `GET /metrics` | Read FastAPI Prometheus counters |

Worker metrics are served separately at `http://localhost:9090/metrics`.

## Data shown in the dashboard

- **Mandates:** ID, amount, currency, frequency, status, and dates.
- **Events:** event ID, payment ID, provider status, processing status, and received time.
- **Attempts:** attempt number, status, provider reference, failure details, and retry time.
- **Ledger:** payment ID, entry type, quantity, asset, and creation time.
- **Payment detail:** associated events, attempts, and ledger entries.

Lists are read through FastAPI. The browser is not given database or Redis credentials.
