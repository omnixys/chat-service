import pytest

from chat.conversation.errors.conversation import (
    ConversationNotFoundError,
    NotParticipantError,
    SameUserConversationError,
)
from chat.conversation.models.enums.conversation import ConversationType
from chat.conversation.services.conversation_read_service import ConversationReadService
from chat.conversation.services.conversation_write_service import ConversationWriteService


class TestDirectConversation:
    async def test_create_direct_conversation(
        self,
        conversation_write_service: ConversationWriteService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        assert conv.participant_pair_key == "01920000-1000-7000-8000-000000000001:01920000-1000-7000-8000-000000000002"
        assert "01920000-1000-7000-8000-000000000001" in conv.participant_ids
        assert "01920000-1000-7000-8000-000000000002" in conv.participant_ids

    async def test_direct_conversation_idempotent(
        self,
        conversation_write_service: ConversationWriteService,
    ) -> None:
        conv1 = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        conv2 = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        assert conv1.id == conv2.id

    async def test_direct_conversation_reverse_order(
        self,
        conversation_write_service: ConversationWriteService,
    ) -> None:
        conv1 = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        conv2 = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000002",
            "01920000-1000-7000-8000-000000000001",
        )
        assert conv1.id == conv2.id

    async def test_support_conversation_is_distinct_from_direct_conversation(
        self,
        conversation_write_service: ConversationWriteService,
    ) -> None:
        direct = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000004",
        )
        support = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000004",
            ConversationType.SUPPORT,
        )

        assert support.id != direct.id
        assert support.type is ConversationType.SUPPORT
        assert (
            support.participant_pair_key
            == "support:01920000-1000-7000-8000-000000000001:01920000-1000-7000-8000-000000000004"
        )

    async def test_support_conversation_is_idempotent(
        self,
        conversation_write_service: ConversationWriteService,
    ) -> None:
        first = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000004",
            ConversationType.SUPPORT,
        )
        second = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000004",
            "01920000-1000-7000-8000-000000000001",
            ConversationType.SUPPORT,
        )

        assert first.id == second.id

    async def test_same_user_rejected(self, conversation_write_service: ConversationWriteService) -> None:
        with pytest.raises(SameUserConversationError):
            await conversation_write_service.create_direct_conversation(
                "01920000-1000-7000-8000-000000000001",
                "01920000-1000-7000-8000-000000000001",
            )

    async def test_parallel_creation_is_idempotent(
        self,
        conversation_write_service: ConversationWriteService,
    ) -> None:

        conv1 = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000005",
            "01920000-1000-7000-8000-000000000006",
        )
        conv2 = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000005",
            "01920000-1000-7000-8000-000000000006",
        )
        conv3 = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000005",
            "01920000-1000-7000-8000-000000000006",
        )
        assert conv1.id == conv2.id == conv3.id


class TestConversationQueries:
    async def test_get_conversation_as_participant(
        self,
        conversation_write_service: ConversationWriteService,
        conversation_read_service: ConversationReadService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        result = await conversation_read_service.get_conversation(conv.id, "01920000-1000-7000-8000-000000000001")
        assert result.id == conv.id

    async def test_non_participant_cannot_get_conversation(
        self,
        conversation_write_service: ConversationWriteService,
        conversation_read_service: ConversationReadService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        with pytest.raises(NotParticipantError):
            await conversation_read_service.get_conversation(conv.id, "01920000-1000-7000-8000-000000000003")

    async def test_conversation_not_found(self, conversation_read_service: ConversationReadService) -> None:
        with pytest.raises(ConversationNotFoundError):
            await conversation_read_service.get_conversation("non-existent", "01920000-1000-7000-8000-000000000001")

    async def test_list_conversations_for_user(
        self,
        conversation_write_service: ConversationWriteService,
        conversation_read_service: ConversationReadService,
    ) -> None:
        await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000003",
        )
        convos = await conversation_read_service.list_conversations("01920000-1000-7000-8000-000000000001")
        assert len(convos) == 2

    async def test_list_conversations_empty(
        self,
        conversation_read_service: ConversationReadService,
    ) -> None:
        convos = await conversation_read_service.list_conversations("01920000-1000-7000-8000-000000000007")
        assert convos == []
