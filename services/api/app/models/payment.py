import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class MandateStatus(str, enum.Enum):
    CREATED = "CREATED"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"


class PaymentStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    RETRYING = "RETRYING"
    EXHAUSTED = "EXHAUSTED"


class PaymentEventStatus(str, enum.Enum):
    RECEIVED = "RECEIVED"
    PROCESSING = "PROCESSING"
    PROCESSED = "PROCESSED"
    IGNORED = "IGNORED"


class LedgerEntryType(str, enum.Enum):
    GOLD_CREDIT = "GOLD_CREDIT"


class Mandate(Base):
    __tablename__ = "mandates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        index=True,
    )

    amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
    )

    currency: Mapped[str] = mapped_column(
        String(3),
        default="INR",
    )

    frequency: Mapped[str] = mapped_column(
        String(20),
    )

    status: Mapped[MandateStatus] = mapped_column(
        default=MandateStatus.CREATED,
    )

    next_charge_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    provider_mandate_id: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    version: Mapped[int] = mapped_column(
        default=1,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class PaymentAttempt(Base):
    __tablename__ = "payment_attempts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    mandate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("mandates.id"),
        index=True,
    )

    payment_id: Mapped[str] = mapped_column(
        String(100),
        index=True,
    )

    attempt_number: Mapped[int] = mapped_column(
        default=1,
    )

    amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
    )

    currency: Mapped[str] = mapped_column(
        String(3),
        default="INR",
    )

    status: Mapped[PaymentStatus] = mapped_column(
        default=PaymentStatus.PENDING,
    )

    provider_reference: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    error_code: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    next_retry_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class PaymentEvent(Base):
    __tablename__ = "payment_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    event_id: Mapped[str] = mapped_column(
        String(150),
        unique=True,
        index=True,
    )

    payment_id: Mapped[str] = mapped_column(
        String(100),
        index=True,
    )

    mandate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("mandates.id"),
        index=True,
    )

    event_type: Mapped[str] = mapped_column(
        String(50),
    )

    provider_status: Mapped[str] = mapped_column(
        String(50),
    )

    payload: Mapped[dict] = mapped_column(
        JSONB,
    )

    status: Mapped[PaymentEventStatus] = mapped_column(
        default=PaymentEventStatus.RECEIVED,
    )

    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        index=True,
    )

    payment_id: Mapped[str] = mapped_column(
        String(100),
        index=True,
    )

    asset: Mapped[str] = mapped_column(
        String(20),
        default="GOLD",
    )

    quantity: Mapped[Decimal] = mapped_column(
        Numeric(18, 8),
    )

    entry_type: Mapped[LedgerEntryType] = mapped_column(
        default=LedgerEntryType.GOLD_CREDIT,
    )

    reference_id: Mapped[str] = mapped_column(
        String(150),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    __table_args__ = (
        UniqueConstraint(
            "payment_id",
            "entry_type",
            name="uq_ledger_payment_entry_type",
        ),
    )