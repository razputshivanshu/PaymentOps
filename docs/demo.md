# Demo walkthrough

Use this guide after starting all services in [Local setup](setup.md). The dashboard is intended to make the behavior visible without relying on terminal logs.

## Before presenting

1. Confirm PostgreSQL, Redis, FastAPI, and the Go worker are running.
2. Open the dashboard and check the four indicators in the top bar.
3. Create a mandate on **Mandates** if the database does not already contain one.
4. Keep the **Payments** page open for the three main scenarios.

Each scenario creates a new payment ID. The backend records the webhook event; the Go worker creates attempts and ledger entries. The dashboard polls for those records every four seconds.

## 1. Successful payment

On **Payments**, click **Simulate successful payment**.

Show the resulting sequence:

```text
Webhook accepted → event stored → Redis stream → worker → successful attempt → ledger entry
```

Check the scenario panel, then open **Events**, **Payment Attempts**, and **Ledger**. Once processing finishes, expect one persisted event, one successful attempt, and one ledger entry for the payment.

**Explain:** FastAPI persists and publishes the webhook. The worker handles it asynchronously and commits the successful attempt, ledger entry, and processed event in a PostgreSQL transaction.

## 2. Duplicate webhook

On **Payments**, click **Send duplicate webhook**.

The dashboard sends the same webhook payload twice, including the same `event_id`. FastAPI should return `accepted` for the first request and `duplicate` for the second.

Show the two responses in the scenario panel. After the worker finishes, expect one persisted event, one payment attempt, and one ledger entry. The duplicate delivery increments the API's duplicate counter but does not create a second event row.

**Explain:** Webhook idempotency uses `event_id`. Payment-level idempotency is a separate guard that prevents a second ledger effect if another event refers to a payment that already has a ledger entry.

## 3. Failed payment and retry

On **Payments**, click **Simulate failed payment**. The initial worker attempt records `MOCK_PAYMENT_FAILED` and schedules a retry for 10 seconds later. The worker's demo retry assumes success.

Wait for the retry. The dashboard should show a failed first attempt, a successful second attempt, and one ledger entry. Because updates are polled every four seconds, allow roughly 10–14 seconds for the final state to appear.

**Explain:** The payment event is considered processed once the failed attempt and retry time are durably recorded. The payment itself succeeds later through the worker's retry loop. The retry is a deterministic mock; it does not call an external provider.

## 4. Worker restart and recovery

For a simple queue demonstration, stop the worker, submit a successful payment, and restart the worker. The event remains in Redis and the restarted worker can consume it.

That demonstrates queued work surviving a worker outage. To demonstrate `XAUTOCLAIM` recovery specifically, a message must first be delivered to the worker and left pending without an ACK; after it has been idle for at least 10 seconds, the recovery loop can claim it. The demo has no crash-injection button, and the dashboard does not expose pending or recovered-message counts. Use worker logs to confirm a reclaim if you arrange that failure condition.

**Explain:** The worker acknowledges a stream message after its database transaction commits. The worker checks for idle pending messages at startup and during its processing loop.

## 5. Metrics and health

Open **Metrics** to show the FastAPI webhook counters and Go worker counters. Open **Reliability** for the service flow and safeguards. The dashboard marks worker metrics unavailable if port `9090` cannot be reached.

The Prometheus counters are in-memory process counters and reset when the corresponding service restarts. Database tables are the persisted source for event, attempt, mandate, and ledger views.

## Suggested short explanation

> “This independent engineering demo focuses on safe processing when webhooks are duplicated, workers are asynchronous, and a payment can fail. Delivery is at least once, so the system uses event and payment idempotency plus a PostgreSQL transaction to protect the ledger. The dashboard reads the backend's records so we can follow those outcomes.”

Do not present this as Aura Gold's production architecture. It is an independent demo inspired by publicly documented recurring-payment reliability challenges.
