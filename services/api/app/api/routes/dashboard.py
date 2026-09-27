from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import LedgerEntry, Mandate, PaymentAttempt, PaymentEvent

router = APIRouter(tags=["Dashboard"])


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
