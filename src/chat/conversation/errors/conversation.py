class ChatError(Exception):
    pass


class NotParticipantError(ChatError):
    def __init__(self, user_id: str, conversation_id: str) -> None:
        self.user_id = user_id
        self.conversation_id = conversation_id
        super().__init__(
            f"User '{user_id}' is not a participant of conversation '{conversation_id}'",
        )


class ConversationNotFoundError(ChatError):
    def __init__(self, conversation_id: str) -> None:
        self.conversation_id = conversation_id
        super().__init__(f"Conversation '{conversation_id}' not found")


class SameUserConversationError(ChatError):
    def __init__(self, user_id: str) -> None:
        self.user_id = user_id
        super().__init__(f"Cannot create direct conversation with self: '{user_id}'")
