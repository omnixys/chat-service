import pytest

from chat.conversation.errors.conversation import NotParticipantError
from chat.conversation.services.conversation_read_service import ConversationReadService
from chat.conversation.services.conversation_write_service import ConversationWriteService
from chat.message.errors.message import EmptyMessageError
from chat.message.services.message_read_service import MessageReadService
from chat.message.services.message_write_service import MessageWriteService


class TestSendMessage:
    async def test_send_and_query_message(
        self,
        conversation_write_service: ConversationWriteService,
        message_write_service: MessageWriteService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        msg = await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000001", "Hallo Rachel!")
        assert msg.body == "Hallo Rachel!"
        assert msg.sender_id == "01920000-1000-7000-8000-000000000001"
        assert msg.conversation_id == conv.id

    async def test_message_is_persisted(
        self,
        conversation_write_service: ConversationWriteService,
        message_write_service: MessageWriteService,
        message_read_service: MessageReadService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000001", "Persist me!")
        msgs = await message_read_service.get_messages(conv.id, "01920000-1000-7000-8000-000000000001")
        assert len(msgs) == 1
        assert msgs[0].body == "Persist me!"

    async def test_empty_message_rejected(
        self,
        conversation_write_service: ConversationWriteService,
        message_write_service: MessageWriteService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        with pytest.raises(EmptyMessageError):
            await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000001", "")

    async def test_whitespace_only_message_rejected(
        self,
        conversation_write_service: ConversationWriteService,
        message_write_service: MessageWriteService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        with pytest.raises(EmptyMessageError):
            await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000001", "   ")

    async def test_non_participant_cannot_send(
        self,
        conversation_write_service: ConversationWriteService,
        message_write_service: MessageWriteService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        with pytest.raises(NotParticipantError):
            await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000003", "Hello?")


class TestReadMessages:
    async def test_non_participant_cannot_read(
        self,
        conversation_write_service: ConversationWriteService,
        message_write_service: MessageWriteService,
        message_read_service: MessageReadService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000001", "Secret message")
        with pytest.raises(NotParticipantError):
            await message_read_service.get_messages(conv.id, "01920000-1000-7000-8000-000000000003")

    async def test_pagination_with_before(
        self,
        conversation_write_service: ConversationWriteService,
        message_write_service: MessageWriteService,
        message_read_service: MessageReadService,
    ) -> None:
        import asyncio

        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        for i in range(5):
            await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000001", f"Msg {i}")
            await asyncio.sleep(0.01)

        all_msgs = await message_read_service.get_messages(conv.id, "01920000-1000-7000-8000-000000000001", limit=50)
        assert len(all_msgs) == 5

        first_two = await message_read_service.get_messages(conv.id, "01920000-1000-7000-8000-000000000001", limit=2)
        assert len(first_two) == 2

        before_time = all_msgs[3].created_at
        older_msgs = await message_read_service.get_messages(
            conv.id,
            "01920000-1000-7000-8000-000000000001",
            limit=50,
            before=before_time,
        )
        assert len(older_msgs) == 3


class TestUnreadCount:
    async def test_unread_count_increases(
        self,
        conversation_write_service: ConversationWriteService,
        conversation_read_service: ConversationReadService,
        message_write_service: MessageWriteService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        conv = await conversation_read_service.get_conversation(conv.id, "01920000-1000-7000-8000-000000000002")
        assert conv.unread_count == 0

        await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000001", "Hey Rachel!")

        conv = await conversation_read_service.get_conversation(conv.id, "01920000-1000-7000-8000-000000000002")
        assert conv.unread_count == 1

    async def test_mark_read_resets_unread_count(
        self,
        conversation_write_service: ConversationWriteService,
        conversation_read_service: ConversationReadService,
        message_write_service: MessageWriteService,
    ) -> None:
        conv = await conversation_write_service.create_direct_conversation(
            "01920000-1000-7000-8000-000000000001",
            "01920000-1000-7000-8000-000000000002",
        )
        await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000001", "Hey Rachel!")
        await message_write_service.send_message(conv.id, "01920000-1000-7000-8000-000000000001", "Are you there?")

        conv = await conversation_read_service.get_conversation(conv.id, "01920000-1000-7000-8000-000000000002")
        assert conv.unread_count == 2

        await message_write_service.mark_read(conv.id, "01920000-1000-7000-8000-000000000002")

        conv = await conversation_read_service.get_conversation(conv.id, "01920000-1000-7000-8000-000000000002")
        assert conv.unread_count == 0
