from types import SimpleNamespace

import pytest
from security.request_context import RequestContext, reset_request_context, set_request_context

from chat.core.graphql import GraphQLContext
from chat.message.resolvers.message_mutation_resolver import MessageMutation
from chat.security.errors import VerifiedTenantRequiredError
from chat.security.http.auth import Principal
from chat.security.http.guards import require_verified_tenant

TENANT_ID = "11111111-1111-4111-8111-111111111111"


class FailingMessageService:
    def __init__(self) -> None:
        self.called = False

    async def send_message(self, *_args: object) -> None:
        self.called = True


@pytest.fixture(autouse=True)
def _reset_security_context() -> None:
    reset_request_context()
    yield
    reset_request_context()


async def test_send_message_rejects_missing_verified_tenant_before_service_call() -> None:
    service = FailingMessageService()
    set_request_context(
        RequestContext(
            user_id="01920000-1000-7000-8000-000000000008",
            tenant_ids=[],
            tenant_id=None,
            is_authenticated=True,
        ),
    )
    info = SimpleNamespace(
        context=GraphQLContext(
            principal=Principal(user_id="01920000-1000-7000-8000-000000000008"),
            message_write_service=service,
        ),
    )

    with pytest.raises(VerifiedTenantRequiredError) as caught:
        await MessageMutation().send_message(info, "conversation-1", "Hello")

    assert caught.value.extensions == {"code": "VERIFIED_TENANT_REQUIRED"}
    assert service.called is False


def test_verified_tenant_must_be_selected_from_token_memberships() -> None:
    set_request_context(
        RequestContext(
            user_id="01920000-1000-7000-8000-000000000008",
            tenant_ids=[TENANT_ID],
            tenant_id=TENANT_ID,
            is_authenticated=True,
        ),
    )

    assert require_verified_tenant() == TENANT_ID

    set_request_context(
        RequestContext(
            user_id="01920000-1000-7000-8000-000000000008",
            tenant_ids=["22222222-2222-4222-8222-222222222222"],
            tenant_id=TENANT_ID,
            is_authenticated=True,
        ),
    )
    with pytest.raises(VerifiedTenantRequiredError):
        require_verified_tenant()
