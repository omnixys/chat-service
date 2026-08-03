"""V1 conversation channels and provider message identity.

Revision ID: 004
Revises: 003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: str | None = "003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("channel", sa.String(20), nullable=False, server_default="IN_APP"),
    )
    op.add_column("conversations", sa.Column("external_address", sa.String(32)))
    op.add_column("conversations", sa.Column("external_display_name", sa.String(255)))
    op.create_index(
        "uq_conversations_external_address",
        "conversations",
        ["external_address"],
        unique=True,
    )
    op.add_column("messages", sa.Column("provider_message_id", sa.String(255)))
    op.create_index(
        "uq_messages_provider_message_id",
        "messages",
        ["provider_message_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_messages_provider_message_id", table_name="messages")
    op.drop_column("messages", "provider_message_id")
    op.drop_index("uq_conversations_external_address", table_name="conversations")
    op.drop_column("conversations", "external_display_name")
    op.drop_column("conversations", "external_address")
    op.drop_column("conversations", "channel")
