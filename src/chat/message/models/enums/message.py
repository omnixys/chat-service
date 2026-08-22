from enum import StrEnum


class MessageContentType(StrEnum):
    TEXT = "TEXT"
    IMAGE = "IMAGE"
    FILE = "FILE"
    SYSTEM = "SYSTEM"


class DeliveryStatus(StrEnum):
    UNKNOWN = "UNKNOWN"
    PENDING = "PENDING"
    QUEUED = "QUEUED"
    SENT = "SENT"
    DELIVERED = "DELIVERED"
    READ = "READ"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
