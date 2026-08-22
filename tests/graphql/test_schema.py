from chat.config.graphql import schema


def test_federation_service_sdl_is_available() -> None:
    result = schema.execute_sync("{ _service { sdl } }")
    assert result.errors is None
    assert result.data is not None
    assert "type Query" in result.data["_service"]["sdl"]
