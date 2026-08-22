from chat.conversation.errors.conversation import ChatError


class EmptyMessageError(ChatError):
    def __init__(self) -> None:
        super().__init__("Message body must not be empty")
