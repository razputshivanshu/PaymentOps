# Recurring Payment Reliability Demo

**Code repository:** [github.com/razputshivanshu/PaymentOps](https://github.com/razputshivanshu/PaymentOps)

An independent engineering demo of webhook idempotency, asynchronous payment processing, retry handling, and ledger safety. It is inspired by publicly documented recurring-payment reliability challenges. **It is not Aura Gold's production system or architecture.**

## What the demo runs

```text
FastAPI → PostgreSQL → Redis Streams → Go worker → PostgreSQL ledger
```

The React dashboard shows persisted mandates, events, attempts, and ledger entries. Its payment buttons send real requests to FastAPI; payment attempts and ledger rows are created by the worker, not by the browser.

## Run locally

Start PostgreSQL, Redis, FastAPI, and the Go worker by following [Local setup](docs/setup.md). Then, in a new terminal:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

## Demo guide

Use [Demo walkthrough](docs/demo.md) to show:

1. Successful payment and ledger creation
2. Duplicate webhook delivery
3. Failed attempt followed by a successful retry
4. Queued work and optional worker crash recovery
5. Health and Prometheus metrics

## Documentation

- [Local setup](docs/setup.md) — start the services and dashboard
- [Render deployment](docs/setup.md#deploy-to-render) — deploy the complete demo with the included Blueprint
- [Demo walkthrough](docs/demo.md) — run and explain the scenarios
- [Architecture](docs/architecture.md) — components, API, and data flow
- [Reliability notes](docs/reliability.md) — actual guarantees and limits

## Scope

This is a local demonstration. The payment provider is simulated in the Go worker; no real payment is sent. Retry uses a fixed 10-second delay and assumes the retry succeeds. See [Reliability notes](docs/reliability.md) for other demo limitations.
