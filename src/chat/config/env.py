from __future__ import annotations

import os
from collections.abc import Callable


def get_env[T](
    key: str,
    fallback: str = "",
    *,
    required: bool = False,
    transform: Callable[[str], T] | None = None,
) -> str | T:
    raw = os.getenv(key)
    if raw is None or raw == "":
        if required and os.getenv("ENVIRONMENT", "development").lower() == "production":
            raise RuntimeError(f"Missing required env: {key}")
        return transform(fallback) if transform is not None else fallback
    return transform(raw) if transform is not None else raw


def get_env_bool(
    key: str,
    *,
    fallback: bool = False,
    required: bool = False,
) -> bool:
    result = get_env(key, "true" if fallback else "", required=required, transform=lambda v: v.lower() == "true")
    return bool(result)


def get_env_int(
    key: str,
    *,
    fallback: int = 0,
    required: bool = False,
) -> int:
    return int(get_env(key, str(fallback), required=required, transform=int))
