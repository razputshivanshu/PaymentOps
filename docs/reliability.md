# Reliability notes

**Source code:** [GitHub repository](https://github.com/razputshivanshu/PaymentOps)

This page summarizes what the current demo implements and what it does not prove. It is an independent engineering demo, not a production payment system.

## Guarantees demonstrated by the code

### Repeated webhook delivery

FastAPI checks the unique `event_id` before inserting a payment event. Every inbound request is also saved in `webhook_deliveries` as `ACCEPTED` or `DUPLICATE`, so repeated deliveries can be inspected after refresh without creating another payment event or ledger effect. The API also exposes in-memory counters for total, accepted, and duplicate webhook requests.

### Repeated financial processing

Before creating a successful financial effect, the worker checks for an existing ledger entry with the same `payment_id` and entry type. PostgreSQL also enforces uniqueness for that pair. If another event refers to a payment that already has a ledger entry, the worker marks that event `IGNORED` and does not add another ledger entry.

### Transaction and ACK ordering

For a successful payment, the worker writes the attempt, ledger entry, and processed-event status in one PostgreSQL transaction. It commits before sending the Redis ACK. If the transaction fails, the worker leaves the message unacknowledged for later delivery or recovery.

### Pending-message recovery

The worker uses a Redis consumer group and `XAUTOCLAIM` to reclaim pending messages that have been idle for at least 10 seconds. The recovery loop runs when the worker starts and while it is running. Recovery metrics and Redis pending counts are not exposed by the dashboard; worker logs are the available confirmation.

### Failed payment retry

The worker stores a failed attempt and its retry time in PostgreSQL. The retry delay is fixed at 10 seconds. The demo retry assumes success, creates a successful second attempt, and writes a single ledger entry. It does not call a payment provider and does not implement exponential backoff or repeated retry limits.

## Important distinctions

- **Webhook event status is not payment status.** A failed payment event can be `PROCESSED` because the worker durably recorded the failure and retry schedule. The corresponding payment attempt is `FAILED`.
- **At-least-once delivery is not exactly-once processing.** A message may be delivered again. The event and ledger idempotency checks make repeated work safer.
- **Ledger rows are the persisted financial effects.** Dashboard charts and counts are derived from current database rows; the displayed success rate is a demo metric, not a service-level guarantee.
- **Metrics counters are in memory.** API and worker counters reset when their respective processes restart. Database records persist separately.

## Limits of this demo

- The payment provider is simulated; there are no real charges or provider credentials.
- The database and Redis addresses and credentials are local development defaults in the service code.
- Webhooks are not authenticated or signature-verified.
- The API persists an event and then publishes it to Redis; there is no transactional outbox or dashboard action to republish an event if Redis publishing fails.
- Render's free Key Value has no persistence, so a service restart can discard queued stream messages even though PostgreSQL records remain. The free deployment is for a short demo, not durable job processing.
- The Render Blueprint opens CORS for the public demo and does not add payment API authentication or webhook signature verification. The reset endpoint separately requires the generated `RESET_TOKEN`. CORS does not protect the API from non-browser clients.
- Free Render web services can sleep after inactivity. The dashboard's polling requests can keep the API and metrics web service active during a presentation, but this is not a reliable always-on worker design.
- The dashboard can show health and worker metrics endpoint reachability, but cannot confirm a specific Redis ACK or display pending/recovered-message counts.
- The UI has no crash-injection control. Stopping the worker before it consumes an event demonstrates queued delivery after restart; it does not by itself demonstrate `XAUTOCLAIM` of an already pending message.
- The fixed retry behavior and local service configuration are for demonstration only.

## Signals available in the dashboard

FastAPI metrics:

- `payment_webhooks_total`
- `payment_webhooks_accepted_total`
- `payment_webhooks_duplicates_total`

Worker metrics:

- `payment_events_processed_total`
- `payment_failures_total`
- `payment_retries_total`
- `payment_ledger_entries_created_total`

Worker metrics are available when the worker is running on port `9090`. The local Vite server proxies the request for the dashboard.
