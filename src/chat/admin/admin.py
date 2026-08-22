from __future__ import annotations

from fastapi import APIRouter

admin_router = APIRouter(prefix="/admin", tags=["admin"])
