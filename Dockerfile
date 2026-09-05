# @license GPL-3.0-or-later
# Copyright (C) 2025 Caleb Gyamfi - Omnixys Technologies
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
# See the GNU General Public License for more details.
#
# For more information, visit <https://www.gnu.org/licenses/>.
# ---------------------------------------------------------------------------------------
# Dockerfile – Omnixys Communication Chat Service
# Multi-stage build optimized for security, reproducibility, and minimal runtime size.
# ---------------------------------------------------------------------------------------
# syntax=docker/dockerfile:1.14.0

ARG PYTHON_VERSION=3.14.7

# ---------------------------------------------------------------------------------------
# Stage 0: Base image
# - Common setup for all later build stages.
# - uv is installed as the Python package manager.
# ---------------------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS base
RUN pip install --no-cache-dir uv
RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/*

# ---------------------------------------------------------------------------------------
# Stage 1: Production dependencies
# - Installs only production dependencies to keep image small.
# - No dev packages or build tools are included.
# ---------------------------------------------------------------------------------------
FROM base AS dependencies
WORKDIR /opt/app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# ---------------------------------------------------------------------------------------
# Stage 2: Final runtime image
# - Copies only installed venv and application code.
# - Runs the app as a non-root user for security.
# ---------------------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS final

# ----- Build-time arguments -----
ARG PYTHON_VERSION
ARG APP_NAME
ARG APP_VERSION
ARG CREATED
ARG REVISION

# ----- Image metadata (OCI compliant) -----
LABEL org.opencontainers.image.title="${APP_NAME}-service" \
      org.opencontainers.image.description="Omnixys ${APP_NAME}-service – Python ${PYTHON_VERSION}, built with FastAPI and Strawberry GraphQL, version ${APP_VERSION}, based on Debian Bookworm." \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.licenses="GPL-3.0-or-later" \
      org.opencontainers.image.vendor="Omnixys Technologies" \
      org.opencontainers.image.authors="caleb.gyamfi@omnixys.com" \
      org.opencontainers.image.base.name="python:${PYTHON_VERSION}-slim-bookworm" \
      org.opencontainers.image.url="https://github.com/omnixys/${APP_NAME}-service" \
      org.opencontainers.image.source="https://github.com/omnixys/${APP_NAME}-service" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.documentation="https://github.com/omnixys/${APP_NAME}-service/blob/main/README.md"

# ----- Set working directory -----
WORKDIR /opt/app

# ----- Environment configuration -----
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/opt/app/src" \
    TZ=UTC

# ----- Install required system packages -----
# tini: lightweight init system for proper signal handling.
# ca-certificates: used for secure HTTPS connections.
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/*

# ----- Create non-root user -----
RUN useradd --create-home --shell /bin/bash app && \
    mkdir -p /opt/app/log && chown -R app:app /opt/app

# ----- Switch to non-root user -----
USER app

# ----- Copy installed dependencies from build stage -----
COPY --from=dependencies --chown=app:app /opt/app/.venv ./.venv
ENV PATH="/opt/app/.venv/bin:$PATH"

# ----- Copy application code -----
COPY --chown=app:app pyproject.toml ./
COPY --chown=app:app src/ ./src/
COPY --chown=app:app alembic.ini ./
COPY --chown=app:app migrations/ ./migrations/

# ----- Expose application port -----
EXPOSE 8000

# ----- Healthcheck -----
# Ensures that Docker and orchestration systems (e.g., Kubernetes) can detect unhealthy containers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# ----- Start command -----
# tini ensures proper signal forwarding and zombie process cleanup.
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "alembic upgrade head && exec chat"]
