from graphql import GraphQLError


class AuthenticationRequiredError(PermissionError):
    def __init__(self) -> None:
        super().__init__("authentication required")


class VerifiedTenantRequiredError(GraphQLError):
    def __init__(self) -> None:
        super().__init__(
            "Verified organization context is required",
            extensions={"code": "VERIFIED_TENANT_REQUIRED"},
        )
