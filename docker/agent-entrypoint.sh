#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ] && [ -n "${LOCAL_AGENT_UID:-}" ] && [ -n "${LOCAL_AGENT_GID:-}" ]; then
  case "${AGENT_CLI:-}" in
    codex) auth_dir=/home/agent/.codex ;;
    claude) auth_dir=/home/agent ;;
    *) echo "Unsupported AGENT_CLI: ${AGENT_CLI:-}" >&2; exit 2 ;;
  esac
  mkdir -p "$auth_dir"
  chown -R "$LOCAL_AGENT_UID:$LOCAL_AGENT_GID" "$auth_dir"
  exec gosu "$LOCAL_AGENT_UID:$LOCAL_AGENT_GID" env HOME=/home/agent "$0" "$@"
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

: "${AGENT_CLI:?AGENT_CLI is required}"
: "${JOB_ID:?JOB_ID is required}"
result_file=/tmp/agent-final.txt

if [ "$AGENT_CLI" = codex ]; then
  export CODEX_HOME=/home/agent/.codex
  if [ ! -s "$CODEX_HOME/auth.json" ]; then
    echo "Codex authentication is missing from $CODEX_HOME/auth.json; rerun pnpm setup:codex as the service account." >&2
    exit 10
  fi
  codex login --config 'cli_auth_credentials_store="file"' status >&2
  set -- codex exec --config 'cli_auth_credentials_store="file"' --dangerously-bypass-approvals-and-sandbox --color never
  if [ -n "${AGENT_MODEL:-}" ]; then set -- "$@" --model "$AGENT_MODEL"; fi
  if [ -n "${AGENT_REASONING:-}" ]; then set -- "$@" --config "model_reasoning_effort=\"$AGENT_REASONING\""; fi
  "$@" - < /job/prompt.md > "$result_file"
elif [ "$AGENT_CLI" = claude ]; then
  set -- claude --print --dangerously-skip-permissions --output-format text
  if [ -n "${AGENT_MODEL:-}" ]; then set -- "$@" --model "$AGENT_MODEL"; fi
  if [ -n "${AGENT_REASONING:-}" ]; then set -- "$@" --effort "$AGENT_REASONING"; fi
  "$@" "Follow the task instructions on stdin." < /job/prompt.md > "$result_file"
else
  echo "Unsupported AGENT_CLI: $AGENT_CLI" >&2
  exit 2
fi

cat "$result_file"
