from dataclasses import dataclass


@dataclass
class ChannelCapabilities:
    supports_attachments: bool = False
    supports_rich_text: bool = False
    supports_formatting: bool = False
    supports_typing: bool = False
    supports_read_receipts: bool = False
    supports_reactions: bool = False
    supports_quoted_replies: bool = False
    supports_forwarding: bool = False
    supports_editing: bool = False
    supports_deletion: bool = False
    supports_delivery_status: bool = False
    supports_presence: bool = False
