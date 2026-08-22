from abc import ABC, abstractmethod

from chat.conversation.models.domain.conversation import Conversation


class ConversationRepository(ABC):
    @abstractmethod
    async def find_by_participant_pair_key(self, key: str) -> Conversation | None: ...

    @abstractmethod
    async def find_by_id(self, conversation_id: str) -> Conversation | None: ...

    @abstractmethod
    async def find_by_user_id(self, user_id: str) -> list[Conversation]: ...

    @abstractmethod
    async def find_by_external_address(self, address: str) -> Conversation | None: ...

    @abstractmethod
    async def save(self, conversation: Conversation) -> Conversation: ...

    @abstractmethod
    async def add_participant(self, conversation_id: str, user_id: str) -> None: ...

    @abstractmethod
    async def is_participant(self, conversation_id: str, user_id: str) -> bool: ...

    @abstractmethod
    async def get_participant_ids(self, conversation_id: str) -> list[str]: ...
