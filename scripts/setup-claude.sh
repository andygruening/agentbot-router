#!/bin/sh
set -eu
image=${AGENT_DOCKER_IMAGE:-agentbot-router-agent:latest}
volume=${CLAUDE_AUTH_VOLUME:-agentbot-router-claude-auth}
sh scripts/build-images.sh
docker volume create "$volume" >/dev/null
uid=$(id -u)
gid=$(id -g)
docker run --rm --volume "$volume:/auth" alpine chown -R "$uid:$gid" /auth
docker run --rm -it --user "$uid:$gid" --env HOME=/home/agent \
  --volume "$volume:/home/agent" "$image" claude auth login
printf '\nClaude subscription authentication saved in Docker volume %s.\n' "$volume"
