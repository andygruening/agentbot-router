#!/bin/sh
set -eu
image=${AGENT_DOCKER_IMAGE:-local-agent-bot-agent:latest}
volume=${CLAUDE_AUTH_VOLUME:-local-agent-claude-auth}
docker build --tag "$image" --file docker/Dockerfile .
docker volume create "$volume" >/dev/null
docker run --rm -it --volume "$volume:/root" "$image" claude auth login
printf '\nClaude subscription authentication saved in Docker volume %s.\n' "$volume"
