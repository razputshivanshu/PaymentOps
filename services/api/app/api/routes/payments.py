from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.metrics import (
    payment_webhooks_total,
    payment_webhooks_duplicates_total,
    payment_webhooks_accepted_total,
)
from app.models import PaymentEvent
from app.schemas.payment import PaymentWebhookRequest
from app.stream import publish_payment_event


router = APIRouter(
    prefix="/webhooks",
    tags=["Payments"],
)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


@router.post("/payment")
async def payment_webhook(
    request: PaymentWebhookRequest,
    db: AsyncSession = Depends(get_db),
):
    # Count every webhook request received.
    payment_webhooks_total.inc()

    # Check whether this webhook event was already received.
    result = await db.execute(
        select(PaymentEvent).where(
            PaymentEvent.event_id == request.event_id
        )
    )

    existing_event = result.scalar_one_or_none()

    # Duplicate webhook event.
    if existing_event:
        payment_webhooks_duplicates_total.inc()

        return {
            "status": "duplicate",
            "event_id": request.event_id,
            "message": "Event already received. Ignoring duplicate.",
        }

    # Create a new payment event.
    event = PaymentEvent(
        event_id=request.event_id,
        payment_id=request.payment_id,
        mandate_id=request.mandate_id,
        event_type=request.event_type,
        provider_status=request.provider_status,
        payload=request.payload,
    )

    db.add(event)

    try:
        await db.commit()

    except IntegrityError:
        # Handles a race where two identical events arrive
        # at almost exactly the same time.
        await db.rollback()

        payment_webhooks_duplicates_total.inc()

        return {
            "status": "duplicate",
            "event_id": request.event_id,
            "message": "Duplicate event detected by database constraint.",
        }

    # The event was successfully persisted.
    payment_webhooks_accepted_total.inc()

    await db.refresh(event)

    # Publish the persisted event to Redis.
    await publish_payment_event(event)

    return {
        "status": "accepted",
        "event_id": event.event_id,
        "received_at": event.received_at,
    }