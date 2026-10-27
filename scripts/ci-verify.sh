#!/usr/bin/env bash
set -euo pipefail
export PYTHON_DOTENV_DISABLED=1 DOTENV_CONFIG_PATH=/dev/null
export UV_CONCURRENT_DOWNLOADS=2 UV_HTTP_RETRIES=2
uv sync --frozen
uv run --frozen ruff format --check src/
uv run --frozen ruff check src/
uv run --frozen mypy src/
uv run --frozen pytest tests/unit -q
uv build
