#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ] && [ -n "${LOCAL_AGENT_UID:-}" ] && [ -n "${LOCAL_AGENT_GID:-}" ]; then
  mkdir -p /home/repository /workspace
  chown -R "$LOCAL_AGENT_UID:$LOCAL_AGENT_GID" /home/repository /workspace
  exec gosu "$LOCAL_AGENT_UID:$LOCAL_AGENT_GID" env HOME=/home/repository "$0" "$@"
fi

: "${GH_TOKEN:=${GITHUB_TOKEN:-}}"
: "${GH_TOKEN:?GH_TOKEN or GITHUB_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${JOB_ID:?JOB_ID is required}"
: "${1:?prepare or finalize is required}"

export GH_TOKEN
branch="${GITHUB_BRANCH:-}"
repo_dir=/workspace/repository
gh auth setup-git --hostname "${GH_HOST:-github.com}"

case "$1" in
  prepare)
    gh repo clone "$GITHUB_REPOSITORY" "$repo_dir"
    if [ -n "$branch" ]; then
      git -C "$repo_dir" fetch origin "$branch"
      git -C "$repo_dir" checkout -B "$branch" "origin/$branch"
    fi
    git -C "$repo_dir" config user.name "agentbot-router"
    git -C "$repo_dir" config user.email "agentbot-router@users.noreply.github.com"
    ;;
  finalize)
    cd "$repo_dir"
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
    ;;
  *)
    echo "Unsupported repository phase: $1" >&2
    exit 2
    ;;
esac
