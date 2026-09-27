from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class CreateMandateRequest(BaseModel):
    user_id: UUID
    amount: Decimal = Field(gt=0)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    frequency: Literal["DAILY", "WEEKLY", "MONTHLY"]


class MandateResponse(BaseModel):
    id: UUID
    user_id: UUID
    amount: Decimal
    currency: str
    frequency: str
    status: str
    next_charge_at: datetime | None
    provider_mandate_id: str | None
    version: int

    model_config = {
        "from_attributes": True
    }


class UpdateMandateRequest(BaseModel):
    status: str