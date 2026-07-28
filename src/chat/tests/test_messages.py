import pytest

from chat.application.services.conversation_service import ConversationService
from chat.application.services.message_service import MessageService
from chat.application.services.read_state_service import ReadStateService
from chat.domain.errors import EmptyMessageError, NotParticipantError


class TestSendMessage:
    async def test_send_and_query_message(
        self,
        conversation_service: ConversationService,
        message_service: MessageService,
    ) -> None:
        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        msg = await message_service.send_message(conv.id, "caleb", "Hallo Rachel!")
        assert msg.body == "Hallo Rachel!"
        assert msg.sender_id == "caleb"
        assert msg.conversation_id == conv.id

    async def test_message_is_persisted(
        self,
        conversation_service: ConversationService,
        message_service: MessageService,
    ) -> None:
        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        await message_service.send_message(conv.id, "caleb", "Persist me!")
        msgs = await message_service.get_messages(conv.id, "caleb")
        assert len(msgs) == 1
        assert msgs[0].body == "Persist me!"

    async def test_empty_message_rejected(
        self,
        conversation_service: ConversationService,
        message_service: MessageService,
    ) -> None:
        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        with pytest.raises(EmptyMessageError):
            await message_service.send_message(conv.id, "caleb", "")

    async def test_whitespace_only_message_rejected(
        self,
        conversation_service: ConversationService,
        message_service: MessageService,
    ) -> None:
        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        with pytest.raises(EmptyMessageError):
            await message_service.send_message(conv.id, "caleb", "   ")

    async def test_non_participant_cannot_send(
        self,
        conversation_service: ConversationService,
        message_service: MessageService,
    ) -> None:
        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        with pytest.raises(NotParticipantError):
            await message_service.send_message(conv.id, "eve", "Hello?")


class TestReadMessages:
    async def test_non_participant_cannot_read(
        self,
        conversation_service: ConversationService,
        message_service: MessageService,
    ) -> None:
        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        await message_service.send_message(conv.id, "caleb", "Secret message")
        with pytest.raises(NotParticipantError):
            await message_service.get_messages(conv.id, "eve")

    async def test_pagination_with_before(
        self,
        conversation_service: ConversationService,
        message_service: MessageService,
    ) -> None:
        import asyncio

        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        for i in range(5):
            await message_service.send_message(conv.id, "caleb", f"Msg {i}")
            await asyncio.sleep(0.01)

        all_msgs = await message_service.get_messages(conv.id, "caleb", limit=50)
        assert len(all_msgs) == 5

        first_two = await message_service.get_messages(conv.id, "caleb", limit=2)
        assert len(first_two) == 2

        before_time = all_msgs[3].created_at
        older_msgs = await message_service.get_messages(
            conv.id,
            "caleb",
            limit=50,
            before=before_time,
        )
        assert len(older_msgs) == 3


class TestUnreadCount:
    async def test_unread_count_increases(
        self,
        conversation_service: ConversationService,
        message_service: MessageService,
        read_state_service: ReadStateService,
    ) -> None:
        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        conv = await conversation_service.get_conversation(conv.id, "rachel")
        assert conv.unread_count == 0

        await message_service.send_message(conv.id, "caleb", "Hey Rachel!")

        conv = await conversation_service.get_conversation(conv.id, "rachel")
        assert conv.unread_count == 1

    async def test_mark_read_resets_unread_count(
        self,
        conversation_service: ConversationService,
        message_service: MessageService,
        read_state_service: ReadStateService,
    ) -> None:
        conv = await conversation_service.create_direct_conversation("caleb", "rachel")
        await message_service.send_message(conv.id, "caleb", "Hey Rachel!")
        await message_service.send_message(conv.id, "caleb", "Are you there?")

        conv = await conversation_service.get_conversation(conv.id, "rachel")
        assert conv.unread_count == 2

        await read_state_service.mark_read(conv.id, "rachel")

        conv = await conversation_service.get_conversation(conv.id, "rachel")
        assert conv.unread_count == 0
