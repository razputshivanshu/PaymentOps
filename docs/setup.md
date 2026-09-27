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

The **Overview** page includes a **Reset data** control. It clears demo records and queued Redis stream events while keeping the Render resources. On Render, open `paymentops-api` → **Environment** and copy the `RESET_TOKEN` value when prompted. The control also requires typing `RESET` as confirmation.

## Deploy to Render

The repository includes a root-level [`render.yaml`](../render.yaml) Blueprint for the dashboard, FastAPI, Go worker, PostgreSQL, and Redis-compatible Key Value. All server-side services use the Singapore region. The Blueprint wires the internal database and Redis URLs into both backend services, builds the frontend with the API and worker URLs, and initializes database tables before starting FastAPI.

1. Push the branch containing `render.yaml` to GitHub.
2. In Render, choose **New → Blueprint**, connect `razputshivanshu/PaymentOps`, and select the branch containing the Blueprint.
3. Review the five resources and their plans, then apply the Blueprint. Render Blueprints create and configure resources from a repository YAML file ([Blueprint guide](https://render.com/docs/infrastructure-as-code)).
4. Wait for the API, worker, database, Key Value, and static site to finish provisioning. Open the dashboard URL shown in Render.
5. Check the dashboard health indicators. The API health check is `/health/db`; worker reachability is checked at `/metrics`.

The frontend receives `VITE_API_BASE_URL` and the worker service URL at build time. It requests the worker's `/metrics` endpoint directly, so the Go metrics handler allows cross-origin reads. The API's Blueprint configuration allows cross-origin requests for this demo.

### Render free-plan behavior

- Free web services spin down after 15 minutes without inbound traffic and can take about a minute to wake up. While the dashboard is open, its four-second polling sends requests to the API and worker metrics endpoint; a sleeping service can make the first refresh slow. This is a demo workaround, not a production worker setup. [Render free instance limits](https://render.com/docs/free)
- Free Render Postgres is limited to 1 GB and expires 30 days after creation. Free Key Value has no data persistence and can lose queue contents after a restart. Keep this deployment temporary and do not treat Redis as durable storage. [Free plan limits](https://render.com/docs/free), [Key Value persistence](https://render.com/docs/key-value)
- The payment and dashboard APIs have no authentication or webhook signature verification; only the reset endpoint requires the generated `RESET_TOKEN`. The Blueprint's CORS policy is open. Deploy only as a public demonstration; do not send real payments or sensitive data.

Render requires a web service to bind its HTTP listener to the supplied `PORT` on `0.0.0.0`. The API start command and worker metrics listener are configured for this. [Render web services](https://render.com/docs/web-services#port-binding)

## Troubleshooting

- **API cannot connect to PostgreSQL:** Check that `docker compose ps` shows PostgreSQL running and that port `5433` is available.
- **API cannot connect to Redis:** Check that Redis is running on port `6379`.
- **Worker is offline in the dashboard:** Confirm the worker process is running and that `http://localhost:9090/metrics` responds.
- **Dashboard shows API offline:** Confirm FastAPI is running on port `8000`. If the port differs, set `VITE_API_BASE_URL` in `frontend/.env` and restart Vite.
- **Webhook returns `422`:** Check that the mandate ID is a valid UUID and that the request uses `PAYMENT_SUCCESS` with `SUCCESS`, or `PAYMENT_FAILED` with `FAILED`.

To stop the app processes, press `Ctrl+C` in their terminals. Stop the local containers with `docker compose down`.
