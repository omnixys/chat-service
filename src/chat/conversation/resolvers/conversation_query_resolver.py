import strawberry
from strawberry.types import Info

from chat.conversation.models.payloads.conversation import Conversation, Participant
from chat.core.graphql import get_conversation_read_service, get_principal


def _participants_from_ids(ids: list[str]) -> list[Participant]:
    return [Participant(user_id=strawberry.ID(uid)) for uid in ids]


@strawberry.type
class ConversationQuery:
    @strawberry.field
    async def conversations(self, info: Info) -> list[Conversation]:
        service = get_conversation_read_service(info)
        principal = await get_principal(info)
        convos = await service.list_conversations(principal.user_id)
        return [
            Conversation(
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
            for c in convos
        ]

    @strawberry.field
    async def conversation(self, info: Info, id: strawberry.ID) -> Conversation | None:
        service = get_conversation_read_service(info)
        principal = await get_principal(info)
        c = await service.get_conversation(str(id), principal.user_id)
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
