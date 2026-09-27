from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class PaymentWebhookRequest(BaseModel):
    event_id: str
    payment_id: str
    mandate_id: UUID
    event_type: Literal[
        "PAYMENT_SUCCESS",
        "PAYMENT_FAILED",
    ]
    provider_status: Literal[
        "SUCCESS",
        "FAILED",
    ]
    payload: dict = {}