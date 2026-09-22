#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ] && [ -n "${LOCAL_AGENT_UID:-}" ] && [ -n "${LOCAL_AGENT_GID:-}" ]; then
  case "${AGENT_CLI:-}" in
    codex) auth_dir=/home/agent/.codex ;;
    claude) auth_dir=/home/agent ;;
    *) echo "Unsupported AGENT_CLI: ${AGENT_CLI:-}" >&2; exit 2 ;;
  esac
  chown -R "$LOCAL_AGENT_UID:$LOCAL_AGENT_GID" "$auth_dir"
  exec gosu "$LOCAL_AGENT_UID:$LOCAL_AGENT_GID" "$0" "$@"
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

: "${GH_TOKEN:=${GITHUB_TOKEN:-}}"
: "${GH_TOKEN:?GH_TOKEN or GITHUB_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${AGENT_CLI:?AGENT_CLI is required}"
: "${JOB_ID:?JOB_ID is required}"

export GH_TOKEN
source_dir=/workspace/source
repo_dir=/workspace/repository
result_file=/tmp/agent-final.txt
branch="${GITHUB_BRANCH:-}"

gh repo clone "$GITHUB_REPOSITORY" "$source_dir"
if [ -n "$branch" ]; then
  repo_dir=$source_dir
  git -C "$repo_dir" fetch origin "$branch"
  git -C "$repo_dir" checkout -B "$branch" "origin/$branch"
else
  git -C "$source_dir" worktree add --detach "$repo_dir" HEAD
fi
cd "$repo_dir"
git config user.name "local-agent-bot"
git config user.email "local-agent-bot@users.noreply.github.com"

if [ "$AGENT_CLI" = codex ]; then
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

if [ -n "$(git status --porcelain)" ]; then
  if [ -z "$branch" ]; then
    task_branch="agent/${JOB_ID}"
    git switch -c "$task_branch"
  fi
  git add --all
  git commit -m "Apply agent task $JOB_ID"
  if [ -n "$branch" ]; then
    git push origin "HEAD:$branch"
    printf '\n\nChanges were committed and pushed to `%s`.\n' "$branch" >> /job/agent-output.md
  else
    git push --set-upstream origin "$task_branch"
    pr_url=$(gh pr create --repo "$GITHUB_REPOSITORY" --head "$task_branch" --fill)
    printf '\n\nPull request: %s\n' "$pr_url" >> /job/agent-output.md
  fi
fi

cat "$result_file"
