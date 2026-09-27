from app.redis import redis_client


PAYMENT_STREAM = "payment_events"


async def publish_payment_event(event):
    return await redis_client.xadd(
        PAYMENT_STREAM,
        {
            "event_id": event.event_id,
            "payment_id": event.payment_id,
            "mandate_id": str(event.mandate_id),
            "event_type": event.event_type,
            "provider_status": event.provider_status,
        },
    )