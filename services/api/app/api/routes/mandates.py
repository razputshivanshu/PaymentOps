from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import Mandate
from app.schemas.mandate import (
    CreateMandateRequest,
    MandateResponse,
    UpdateMandateRequest,
)

router = APIRouter(
    prefix="/mandates",
    tags=["Mandates"],
)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


@router.post(
    "",
    response_model=MandateResponse,
)
async def create_mandate(
    request: CreateMandateRequest,
    db: AsyncSession = Depends(get_db),
):
    mandate = Mandate(
        user_id=request.user_id,
        amount=request.amount,
        currency=request.currency.upper(),
        frequency=request.frequency.upper(),
        status="CREATED",
        next_charge_at=datetime.now(timezone.utc),
    )

    db.add(mandate)

    await db.commit()
    await db.refresh(mandate)

    return mandate