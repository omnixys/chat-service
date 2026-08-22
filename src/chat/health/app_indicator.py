from __future__ import annotations

from typing import Any


class AppIndicator:
    name = "app"

    async def check(self) -> dict[str, Any]:
        return {"status": "up"}
