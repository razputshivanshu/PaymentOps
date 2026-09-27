from fastapi import FastAPI

from app.api.routes.mandates import router as mandate_router
from app.database import engine
from app.api.routes.payments import router as payment_router
from app.api.routes.dashboard import router as dashboard_router
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
import os

app = FastAPI(
    title="Aura Payment Orchestrator",
    description="Recurring payment reliability service",
    version="0.1.0",
)

app.include_router(mandate_router)
app.include_router(payment_router)
app.include_router(dashboard_router)
cors_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in cors_origins.split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "payment-orchestrator",
    }


@app.get("/health/db")
async def database_health_check():
    from sqlalchemy import text

    async with engine.connect() as connection:
        result = await connection.execute(text("SELECT 1"))

    return {
        "status": "ok",
        "database": "postgresql",
        "result": result.scalar(),
    }


@app.get("/health/redis")
async def redis_health_check():
    from app.redis import redis_client

    await redis_client.ping()
    return {"status": "ok", "service": "redis"}

@app.get("/metrics")
async def metrics():
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST,
    )
