import strawberry
from strawberry.types import Info

from chat.conversation.models.payloads.conversation import Conversation, ConversationType, Participant
from chat.core.graphql import get_conversation_write_service, get_message_write_service, get_principal

logger = __import__("structlog").get_logger(__name__)


def _participants_from_ids(ids: list[str]) -> list[Participant]:
    return [Participant(user_id=strawberry.ID(uid)) for uid in ids]


@strawberry.type
class ConversationMutation:
    @strawberry.mutation
    async def create_in_app_conversation(
        self,
        info: Info,
        participant_user_id: str,
        conversation_type: ConversationType = ConversationType.DIRECT,  # type: ignore[valid-type]
    ) -> Conversation:
        service = get_conversation_write_service(info)
        principal = await get_principal(info)
        logger.info("graphql_create_in_app_conversation", user_id=principal.user_id, participant=participant_user_id)
        c = await service.create_direct_conversation(
            principal.user_id,
            participant_user_id,
            conversation_type,
        )
        return Conversation(
            id=strawberry.ID(c.id),
            type=c.type,
            participants=_participants_from_ids(c.participant_ids),
            last_message=c.last_message,
            last_message_at=c.last_message_at,
            unread_count=c.unread_count,
            channel=c.channel,
            external_address=c.external_address,
            external_display_name=c.external_display_name,
        )

    @strawberry.mutation
    async def create_whatsapp_conversation(
        self,
        info: Info,
        phone_number: str,
        display_name: str | None = None,
    ) -> Conversation:
        service = get_conversation_write_service(info)
        principal = await get_principal(info)
        logger.info("graphql_create_whatsapp_conversation", user_id=principal.user_id, phone_number=phone_number)
        c = await service.create_whatsapp_conversation(
            principal.user_id,
            phone_number,
            display_name,
        )
        return Conversation(
            id=strawberry.ID(c.id),
            type=c.type,
            participants=_participants_from_ids(c.participant_ids),
            last_message=c.last_message,
            last_message_at=c.last_message_at,
            unread_count=c.unread_count,
            channel=c.channel,
            external_address=c.external_address,
            external_display_name=c.external_display_name,
        )

    @strawberry.mutation
    async def mark_read(
        self,
        info: Info,
        conversation_id: strawberry.ID,
    ) -> bool:
        service = get_message_write_service(info)
        principal = await get_principal(info)
        return await service.mark_read(str(conversation_id), principal.user_id)
