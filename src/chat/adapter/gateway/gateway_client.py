from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from chat.config.settings import settings
from chat.conversation.models.domain.conversation import Conversation
from chat.message.models.domain.message import Message
from chat.message.models.enums.message import DeliveryStatus

logger = __import__("structlog").get_logger(__name__)


@dataclass
class GatewayResult:
    success: bool
    status: DeliveryStatus
    error: str | None = None
    raw: dict[str, Any] | None = field(default_factory=dict)
    provider_message_id: str | None = None


class GatewayError(Exception):
    pass


class GatewayClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.communication_gateway_url.rstrip("/"),
            headers={
                "x-internal-api-key": settings.communication_gateway_api_key,
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(settings.communication_gateway_timeout),
        )

    async def send(self, message: Message, conversation: Conversation) -> GatewayResult:
        payload = {
            "id": message.id,
            "channel": message.channel.type.value,
            "recipientAddress": conversation.external_address,
            "senderId": message.sender_id,
            "body": message.body,
            "contentType": message.content_type.value,
            "metadata": {"conversationId": conversation.id},
        }

        logger.info(
            "gateway_outbound_start",
            message_id=message.id,
            conversation_id=message.conversation_id,
            channel=message.channel.type.value,
        )

        try:
            response = await self._client.post(
                "/api/v1/messages/send",
                json=payload,
            )
            data = response.json()
            logger.info(
                "gateway_outbound_response",
                message_id=message.id,
                status_code=response.status_code,
            )

            if response.is_success and data.get("success"):
                delivery = DeliveryStatus(data.get("status", "SENT"))
                return GatewayResult(
                    success=True,
                    status=delivery,
                    raw=data,
                    provider_message_id=data.get("providerMessageId"),
                )

            error_msg = data.get("error") or f"HTTP {response.status_code}"
            return GatewayResult(
                success=False,
                status=DeliveryStatus.FAILED,
                error=error_msg,
                raw=data,
            )

        except httpx.TimeoutException:
            logger.warning("gateway_outbound_timeout", message_id=message.id, conversation_id=message.conversation_id)
            return GatewayResult(
                success=False,
                status=DeliveryStatus.FAILED,
                error="gateway_timeout",
            )

        except httpx.ConnectError:
            logger.warning(
                "gateway_outbound_unreachable",
                message_id=message.id,
                conversation_id=message.conversation_id,
            )
            return GatewayResult(
                success=False,
                status=DeliveryStatus.FAILED,
                error="gateway_unreachable",
            )

        except Exception as exc:
            logger.error(
                "gateway_outbound_error",
                message_id=message.id,
                conversation_id=message.conversation_id,
                error=str(exc),
            )
            return GatewayResult(
                success=False,
                status=DeliveryStatus.FAILED,
                error=f"gateway_error: {exc}",
            )

    async def close(self) -> None:
        await self._client.aclose()
