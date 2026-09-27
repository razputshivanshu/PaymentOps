# Local setup

**Source code:** [GitHub repository](https://github.com/razputshivanshu/PaymentOps)

This guide starts the complete demo: PostgreSQL and Redis, the FastAPI service, the Go worker, and the dashboard.

## Requirements

- Docker with the Compose plugin
- Python 3.12 or newer
- Go (to run the worker)
- Node.js and npm (to run the dashboard)

Run all commands from the repository root unless a step says otherwise.

## 1. Start PostgreSQL and Redis

```bash
docker compose up -d
```

The local services use PostgreSQL at `localhost:5433` and Redis at `localhost:6379`. The demo uses the local credentials in the API and worker source; these are for development only.

## 2. Install and start FastAPI

In a terminal from the repository root:

```bash
cd services/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m app.init_db
uvicorn app.main:app --reload --port 8000
```

Keep this terminal open. The API is at `http://localhost:8000`; its Swagger page is at `http://localhost:8000/docs`.

## 3. Start the Go worker

In a second terminal from the repository root:

```bash
cd services/worker
go run ./cmd/worker
```

The worker connects to the local PostgreSQL and Redis services. It exposes Prometheus metrics at `http://localhost:9090/metrics`.

## 4. Start the dashboard

In a third terminal from the repository root:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. The default API URL is `http://localhost:8000`. To use another API host, set `VITE_API_BASE_URL` in `frontend/.env` and restart Vite. During local development, Vite proxies worker metrics from port `9090`.

## 5. Check service health

Open these URLs or run the `curl` commands:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/health/db
curl http://localhost:8000/health/redis
curl http://localhost:9090/metrics
```

The dashboard header reports API, PostgreSQL, Redis, and worker metrics endpoint status separately. The API's `/health` checks that FastAPI is responding; database and Redis health are checked by their own endpoints.

## Dashboard controls

1. Open **Mandates** and create a mandate. The form creates a UUID for the user ID and submits the amount and frequency to FastAPI.
2. Open **Payments** and run one of the scenarios described in [Demo walkthrough](demo.md).
3. Use **Events**, **Payment Attempts**, and **Ledger** to inspect the records written by the backend.

The dashboard refreshes data every four seconds. The failure-and-retry scenario takes about 10 seconds for the retry to become due, plus up to one refresh interval.

## Troubleshooting

- **API cannot connect to PostgreSQL:** Check that `docker compose ps` shows PostgreSQL running and that port `5433` is available.
- **API cannot connect to Redis:** Check that Redis is running on port `6379`.
- **Worker is offline in the dashboard:** Confirm the worker process is running and that `http://localhost:9090/metrics` responds.
- **Dashboard shows API offline:** Confirm FastAPI is running on port `8000`. If the port differs, set `VITE_API_BASE_URL` in `frontend/.env` and restart Vite.
- **Webhook returns `422`:** Check that the mandate ID is a valid UUID and that the request uses `PAYMENT_SUCCESS` with `SUCCESS`, or `PAYMENT_FAILED` with `FAILED`.

To stop the app processes, press `Ctrl+C` in their terminals. Stop the local containers with `docker compose down`.
