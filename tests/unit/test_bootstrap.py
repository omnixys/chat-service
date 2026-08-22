import errno

import pytest

from chat.main import ensure_bind_available


class FakeSocket:
    def __init__(self, error: OSError | None = None) -> None:
        self.error = error
        self.closed = False

    def bind(self, _address: tuple[str, int]) -> None:
        if self.error is not None:
            raise self.error

    def close(self) -> None:
        self.closed = True


def test_occupied_port_has_actionable_error(monkeypatch: pytest.MonkeyPatch) -> None:
    probe = FakeSocket(OSError(errno.EADDRINUSE, "occupied"))
    monkeypatch.setattr("chat.main.socket.socket", lambda *_args: probe)
    with pytest.raises(SystemExit, match="already in use"):
        ensure_bind_available("127.0.0.1", 8001)
    assert probe.closed is True


def test_available_port_passes_preflight(monkeypatch: pytest.MonkeyPatch) -> None:
    probe = FakeSocket()
    monkeypatch.setattr("chat.main.socket.socket", lambda *_args: probe)
    ensure_bind_available("127.0.0.1", 8001)
    assert probe.closed is True
