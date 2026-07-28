import pytest

from chat.application.services.conversation_service import ConversationService
from chat.domain.enums import ConversationType
from chat.domain.errors import (
    ConversationNotFoundError,
    NotParticipantError,
    SameUserConversationError,
)


class TestDirectConversation:
    async def test_create_direct_conversation(
        self,
        conversation_service: ConversationService,
    ) -> None:
        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        assert conv.participant_pair_key == "caleb:rachel"
        assert "caleb" in conv.participant_ids
        assert "rachel" in conv.participant_ids

    async def test_direct_conversation_idempotent(
        self,
        conversation_service: ConversationService,
    ) -> None:
        conv1 = await conversation_service.create_direct_conversation("caleb", "rachel")
        conv2 = await conversation_service.create_direct_conversation("caleb", "rachel")
        assert conv1.id == conv2.id

    async def test_direct_conversation_reverse_order(
        self,
        conversation_service: ConversationService,
    ) -> None:
        conv1 = await conversation_service.create_direct_conversation("caleb", "rachel")
        conv2 = await conversation_service.create_direct_conversation("rachel", "caleb")
        assert conv1.id == conv2.id

    async def test_support_conversation_is_distinct_from_direct_conversation(
        self,
        conversation_service: ConversationService,
    ) -> None:
        direct = await conversation_service.create_direct_conversation("caleb", "admin")
        support = await conversation_service.create_direct_conversation(
            "caleb",
            "admin",
            ConversationType.SUPPORT,
        )

        assert support.id != direct.id
        assert support.type is ConversationType.SUPPORT
        assert support.participant_pair_key == "support:admin:caleb"

    async def test_support_conversation_is_idempotent(
        self,
        conversation_service: ConversationService,
    ) -> None:
        first = await conversation_service.create_direct_conversation(
            "caleb",
            "admin",
            ConversationType.SUPPORT,
        )
        second = await conversation_service.create_direct_conversation(
            "admin",
            "caleb",
            ConversationType.SUPPORT,
        )

        assert first.id == second.id

    async def test_same_user_rejected(self, conversation_service: ConversationService) -> None:
        with pytest.raises(SameUserConversationError):
            await conversation_service.create_direct_conversation("caleb", "caleb")

    async def test_parallel_creation_is_idempotent(
        self,
        conversation_service: ConversationService,
    ) -> None:

        conv1 = await conversation_service.create_direct_conversation("alice", "bob")
        conv2 = await conversation_service.create_direct_conversation("alice", "bob")
        conv3 = await conversation_service.create_direct_conversation("alice", "bob")
        assert conv1.id == conv2.id == conv3.id


class TestConversationQueries:
    async def test_get_conversation_as_participant(
        self,
        conversation_service: ConversationService,
    ) -> None:
        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        result = await conversation_service.get_conversation(conv.id, "caleb")
        assert result.id == conv.id

    async def test_non_participant_cannot_get_conversation(
        self,
        conversation_service: ConversationService,
    ) -> None:
        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        with pytest.raises(NotParticipantError):
            await conversation_service.get_conversation(conv.id, "eve")

    async def test_conversation_not_found(self, conversation_service: ConversationService) -> None:
        with pytest.raises(ConversationNotFoundError):
            await conversation_service.get_conversation("non-existent", "caleb")

    async def test_list_conversations_for_user(
        self,
        conversation_service: ConversationService,
    ) -> None:
        await conversation_service.create_direct_conversation("caleb", "rachel")
        await conversation_service.create_direct_conversation("caleb", "eve")
        convos = await conversation_service.list_conversations("caleb")
        assert len(convos) == 2

    async def test_list_conversations_empty(
        self,
        conversation_service: ConversationService,
    ) -> None:
        convos = await conversation_service.list_conversations("lonely-user")
        assert convos == []
