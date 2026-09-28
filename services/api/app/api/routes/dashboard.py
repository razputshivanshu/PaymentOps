import hmac
import os

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import desc, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, engine
from app.models import (
    LedgerEntry,
    Mandate,
    PaymentAttempt,
    PaymentEvent,
    WebhookDelivery,
)
from app.redis import redis_client

router = APIRouter(tags=["Dashboard"])
PAYMENT_STREAM = "payment_events"


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


def row(model):
    return {column.name: getattr(model, column.name) for column in model.__table__.columns}


@router.get("/mandates")
async def list_mandates(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Mandate).order_by(desc(Mandate.created_at)))
    return [row(item) for item in result.scalars()]


@router.get("/events")
async def list_events(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PaymentEvent).order_by(desc(PaymentEvent.received_at)).limit(250))
    return [row(item) for item in result.scalars()]


@router.get("/deliveries")
async def list_webhook_deliveries(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(WebhookDelivery)
        .order_by(desc(WebhookDelivery.received_at))
        .limit(250)
    )
    return [row(item) for item in result.scalars()]


@router.get("/attempts")
async def list_attempts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PaymentAttempt).order_by(desc(PaymentAttempt.created_at)).limit(250))
    return [row(item) for item in result.scalars()]


@router.get("/ledger")
async def list_ledger(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LedgerEntry).order_by(desc(LedgerEntry.created_at)).limit(250))
    return [row(item) for item in result.scalars()]


@router.get("/payments")
async def list_payments(db: AsyncSession = Depends(get_db)):
    attempts = await db.execute(select(PaymentAttempt).order_by(desc(PaymentAttempt.created_at)))
    events = await db.execute(select(PaymentEvent).order_by(desc(PaymentEvent.received_at)))
    items = {}
    for attempt in attempts.scalars():
        item = items.setdefault(attempt.payment_id, {"payment_id": attempt.payment_id, "mandate_id": str(attempt.mandate_id), "status": attempt.status, "attempts": 0, "updated_at": attempt.updated_at})
        item["attempts"] += 1
        if item["attempts"] == 1:
            item["status"] = attempt.status
            item["updated_at"] = attempt.updated_at
    for event in events.scalars():
        item = items.setdefault(event.payment_id, {"payment_id": event.payment_id, "mandate_id": str(event.mandate_id), "status": "PENDING", "attempts": 0, "updated_at": event.received_at})
        item.setdefault("event_id", event.event_id)
    return sorted(items.values(), key=lambda item: item["updated_at"], reverse=True)


@router.get("/payments/{payment_id}")
async def payment_detail(payment_id: str, db: AsyncSession = Depends(get_db)):
    attempts = await db.execute(select(PaymentAttempt).where(PaymentAttempt.payment_id == payment_id).order_by(PaymentAttempt.attempt_number))
    events = await db.execute(select(PaymentEvent).where(PaymentEvent.payment_id == payment_id).order_by(PaymentEvent.received_at))
    ledger = await db.execute(select(LedgerEntry).where(LedgerEntry.payment_id == payment_id))
    return {"payment_id": payment_id, "attempts": [row(item) for item in attempts.scalars()], "events": [row(item) for item in events.scalars()], "ledger": [row(item) for item in ledger.scalars()]}


@router.post("/admin/reset")
async def reset_demo_data(
    reset_token: str | None = Header(default=None, alias="X-Reset-Token"),
):
    expected_token = os.getenv("RESET_TOKEN")
    if not expected_token:
        raise HTTPException(status_code=503, detail="Demo reset is not configured")
    if not reset_token or not hmac.compare_digest(reset_token, expected_token):
        raise HTTPException(status_code=403, detail="Invalid reset token")

    async with engine.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE TABLE ledger_entries, payment_attempts, "
                "payment_events, webhook_deliveries, mandates "
                "RESTART IDENTITY CASCADE"
            )
        )

    await redis_client.xtrim(PAYMENT_STREAM, maxlen=0, approximate=False)
    return {
        "status": "ok",
        "message": "Demo data, webhook deliveries, and queued events cleared",
    }
