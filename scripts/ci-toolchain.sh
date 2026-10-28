#!/usr/bin/env bash
set -euo pipefail
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
task_tools_dir="${RUNNER_TEMP:?RUNNER_TEMP required}/chat-toolchain"
mkdir -p "$task_tools_dir"
curl --fail --silent --show-error --location --retry 2 \
  https://nodejs.org/dist/v26.8.1/node-v26.8.1-linux-x64.tar.xz \
  --output "$task_tools_dir/node.tar.xz"
printf '%s  %s\n' 3e301118d7df53d563b7e96c1617545f26e2f76f9724be668d6cab65c15dda5d "$task_tools_dir/node.tar.xz" | sha256sum --check -
# Hardened rootless jobs deliberately cannot chown archive members.
tar --no-same-owner -xJf "$task_tools_dir/node.tar.xz" -C "$task_tools_dir"
export PATH="$task_tools_dir/node-v26.8.1-linux-x64/bin:$PATH"
npm install --prefix "$task_tools_dir/pnpm" --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org pnpm@11.24.0
export PATH="$task_tools_dir/pnpm/node_modules/.bin:$PATH"
test "$(node --version)" = v26.8.1
test "$(pnpm --version)" = 11.24.0
printf '%s\n%s\n' "$task_tools_dir/node-v26.8.1-linux-x64/bin" "$task_tools_dir/pnpm/node_modules/.bin" >> "${FORGEJO_PATH:?FORGEJO_PATH required}"
