from enum import StrEnum


class ConversationType(StrEnum):
    DIRECT = "DIRECT"
    GROUP = "GROUP"
    CHANNEL = "CHANNEL"
    SUPPORT = "SUPPORT"


class ChannelType(StrEnum):
    IN_APP = "IN_APP"
    WHATSAPP = "WHATSAPP"
    EMAIL = "EMAIL"
    SMS = "SMS"
