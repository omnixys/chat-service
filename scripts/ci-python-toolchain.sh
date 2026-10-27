#!/usr/bin/env bash
set -euo pipefail
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
task_python_tools="${RUNNER_TEMP:?RUNNER_TEMP required}/python-release-toolchain"
mkdir -p "$task_python_tools"
curl --fail --silent --show-error --location --retry 2 \
  https://github.com/astral-sh/uv/releases/download/0.12.8/uv-x86_64-unknown-linux-gnu.tar.gz \
  --output "$task_python_tools/uv.tar.gz"
printf '%s  %s\n' 2e2b37e9811e17675a9e70bed5e1a58fc8c0388be63d751d72cc735188c149ff "$task_python_tools/uv.tar.gz" | sha256sum --check -
tar --no-same-owner -xzf "$task_python_tools/uv.tar.gz" -C "$task_python_tools"
export PATH="$task_python_tools/uv-x86_64-unknown-linux-gnu:$PATH"
export UV_CACHE_DIR="${RUNNER_TEMP}/uv-cache"
export UV_CONCURRENT_DOWNLOADS=2 UV_HTTP_RETRIES=2
check_uv_version() {
  case "$1" in
    'uv 0.12.8'|'uv 0.12.8 ('*) return 0 ;;
    *) return 1 ;;
  esac
}
check_uv_version "$(uv --version)"
uv python install 3.14.7
printf '%s\n' "$task_python_tools/uv-x86_64-unknown-linux-gnu" >> "${FORGEJO_PATH:?FORGEJO_PATH required}"
printf '%s\n' 'UV_PYTHON=3.14.7' 'UV_CONCURRENT_DOWNLOADS=2' 'UV_HTTP_RETRIES=2' >> "${FORGEJO_ENV:?FORGEJO_ENV required}"
printf 'UV_CACHE_DIR=%s\n' "$UV_CACHE_DIR" >> "${FORGEJO_ENV}"
