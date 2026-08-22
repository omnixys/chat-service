from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from chat.application.ports.conversation_repository import ConversationRepository
from chat.application.ports.message_repository import MessageRepository
from chat.application.ports.realtime_publisher import RealtimePublisher
from chat.config.settings import settings
from chat.conversation.models.domain.communication_channel import CommunicationChannel
from chat.conversation.models.domain.conversation import Conversation
from chat.conversation.models.enums.conversation import ChannelType
from chat.conversation.services.conversation_write_service import normalize_e164
from chat.db.repositories.conversation_repository import (
    SqlAlchemyConversationRepository,
)
from chat.db.repositories.message_repository import (
    SqlAlchemyMessageRepository,
)
from chat.db.session import get_db
from chat.message.models.domain.message import Message
from chat.message.models.enums.message import DeliveryStatus, MessageContentType
from chat.message.models.events.message import MessageCreatedEvent

logger = __import__("structlog").get_logger(__name__)

router = APIRouter(prefix="/api/v1/internal", tags=["internal"])

_realtime: RealtimePublisher | None = None


def set_realtime(publisher: RealtimePublisher) -> None:
    global _realtime
    _realtime = publisher


def get_realtime() -> RealtimePublisher:
    if _realtime is None:
        raise RuntimeError("Realtime publisher not initialized")
    return _realtime


class InboundMessagePayload(BaseModel):
    message_id: str = ""
    channel: str = "WHATSAPP"
    user_id: str = ""
    from_: str = ""
    body: str = ""
    content_type: str = "TEXT"
    conversation_id: str | None = None


class DeliveryStatusPayload(BaseModel):
    provider_message_id: str
    internal_message_id: str = ""
    conversation_id: str = ""
    status: str
    error: str | None = None
    timestamp: str | None = None


def _assert_internal_key(value: str) -> None:
    expected_key = settings.chat_service_api_key or settings.communication_gateway_api_key
    if expected_key and value != expected_key:
        raise HTTPException(status_code=401, detail="unauthorized")


async def _resolve_conversation(
    repo: ConversationRepository,
    payload: InboundMessagePayload,
) -> Conversation:
    if payload.conversation_id:
        conversation = await repo.find_by_id(payload.conversation_id)
        if conversation is None:
            logger.warning(
                "inbound_conversation_not_found",
                conversation_id=payload.conversation_id,
                channel=payload.channel,
            )
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "UNMATCHED_INBOUND_MESSAGE",
                    "message": f"Conversation '{payload.conversation_id}' not found",
                },
            )
        return conversation

    if payload.from_:
        try:
            conversation = await repo.find_by_external_address(normalize_e164(payload.from_))
            if conversation is not None:
                return conversation
        except ValueError:
            pass

    logger.warning("inbound_unmatched", channel=payload.channel, from_=payload.from_, user_id=payload.user_id)
    raise HTTPException(
        status_code=422,
        detail={
            "code": "UNMATCHED_INBOUND_MESSAGE",
            "message": "Cannot resolve conversation for inbound message",
        },
    )


@router.get("/conversations/{conversation_id}/participants/{user_id}")
async def verify_conversation_participant(
    conversation_id: str,
    user_id: str,
    x_api_key: str = Header(default=""),
    session: AsyncSession = Depends(get_db),
) -> Response:
    _assert_internal_key(x_api_key)
    conversation = await SqlAlchemyConversationRepository(session).find_by_id(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail={"code": "CONVERSATION_NOT_FOUND"})
    if user_id not in conversation.participant_ids:
        raise HTTPException(status_code=403, detail={"code": "CONVERSATION_ACCESS_DENIED"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/inbound-message")
async def receive_inbound_message(
    payload: InboundMessagePayload,
    x_api_key: str = Header(default=""),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:

    try:
        _assert_internal_key(x_api_key)
    except HTTPException:
        logger.warning("inbound_unauthorized", channel=payload.channel, from_=payload.from_, user_id=payload.user_id)
        raise HTTPException(status_code=401, detail="unauthorized")

    conversation_repo: ConversationRepository = SqlAlchemyConversationRepository(session)
    message_repo: MessageRepository = SqlAlchemyMessageRepository(session)

    existing_message = await message_repo.find_by_provider_message_id(payload.message_id)
    if existing_message is not None:
        return {
            "id": existing_message.id,
            "conversation_id": existing_message.conversation_id,
            "sender_id": existing_message.sender_id,
            "body": existing_message.body,
            "channel": existing_message.channel.type.value,
            "delivery_status": existing_message.delivery_status.value,
            "created_at": existing_message.created_at.isoformat(),
            "duplicate": True,
        }

    conversation = await _resolve_conversation(conversation_repo, payload)

    channel_type = ChannelType(payload.channel.upper())
    content_type = MessageContentType(payload.content_type.upper())

    message = Message(
        conversation_id=conversation.id,
        sender_id=f"whatsapp:{normalize_e164(payload.from_)}",
        body=payload.body,
        content_type=content_type,
        channel=CommunicationChannel(type=channel_type),
        delivery_status=DeliveryStatus.DELIVERED,
        provider_message_id=payload.message_id,
    )
    try:
        await message_repo.save(message)
        await session.commit()
    except Exception as exc:
        logger.exception(
            "inbound_db_error",
            message_id=payload.message_id,
            conversation_id=conversation.id,
            error=str(exc),
        )
        raise

    event = MessageCreatedEvent(
        message_id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,
        body=message.body,
        content_type=message.content_type,
        channel=message.channel,
        delivery_status=message.delivery_status,
        created_at=message.created_at,
    )

    realtime = get_realtime()
    try:
        await realtime.publish(f"conversation:{message.conversation_id}", event)
        for uid in conversation.participant_ids:
            await realtime.publish(f"user:{uid}", event)
    except Exception as exc:
        logger.error(
            "realtime_publish_error",
            message_id=message.id,
            conversation_id=message.conversation_id,
            error=str(exc),
        )

    logger.info(
        "inbound_message_processed",
        message_id=message.id,
        conversation_id=message.conversation_id,
        channel=payload.channel,
    )

    return {
        "id": message.id,
        "conversation_id": message.conversation_id,
        "sender_id": message.sender_id,
        "body": message.body,
        "channel": message.channel.type.value,
        "delivery_status": message.delivery_status.value,
        "created_at": message.created_at.isoformat(),
        "duplicate": False,
    }


@router.post("/delivery-status")
async def receive_delivery_status(
    payload: DeliveryStatusPayload,
    x_api_key: str = Header(default=""),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    logger.info("delivery_status_received", provider_msg_id=payload.provider_message_id, status=payload.status)
    _assert_internal_key(x_api_key)
    repo = SqlAlchemyMessageRepository(session)
    message = None
    if payload.internal_message_id:
        from chat.db.models import MessageModel

        model = await session.get(MessageModel, payload.internal_message_id)
        message = repo._to_domain(model) if model else None
    if message is None:
        message = await repo.find_by_provider_message_id(payload.provider_message_id)
    if message is None:
        logger.warning("delivery_status_message_not_found", provider_msg_id=payload.provider_message_id)
        raise HTTPException(status_code=404, detail={"code": "MESSAGE_NOT_FOUND"})

    target = DeliveryStatus(payload.status.upper())
    transitions = {
        DeliveryStatus.PENDING: {DeliveryStatus.SENT, DeliveryStatus.FAILED},
        DeliveryStatus.QUEUED: {DeliveryStatus.SENT, DeliveryStatus.FAILED},
        DeliveryStatus.SENT: {DeliveryStatus.DELIVERED, DeliveryStatus.FAILED},
        DeliveryStatus.DELIVERED: {DeliveryStatus.READ, DeliveryStatus.FAILED},
        DeliveryStatus.READ: set(),
        DeliveryStatus.FAILED: set(),
    }
    if target != message.delivery_status and target not in transitions.get(
        message.delivery_status,
        set(),
    ):
        logger.warning(
            "delivery_status_invalid_transition",
            message_id=message.id,
            current_status=message.delivery_status.value,
            attempted_status=target.value,
        )
        raise HTTPException(status_code=409, detail={"code": "INVALID_STATUS_TRANSITION"})
    updated = await repo.update_delivery_status(
        message.id,
        target.value,
        payload.provider_message_id,
    )
    await session.commit()
    assert updated is not None
    logger.info("delivery_status_applied", message_id=updated.id, status=updated.delivery_status.value)
    return {"id": updated.id, "status": updated.delivery_status.value}
