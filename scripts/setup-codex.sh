#!/bin/sh
set -eu
image=${AGENT_DOCKER_IMAGE:-local-agent-bot-agent:latest}
volume=${CODEX_AUTH_VOLUME:-local-agent-codex-auth}
docker build --tag "$image" --file docker/Dockerfile .
docker volume create "$volume" >/dev/null
uid=$(id -u)
gid=$(id -g)
docker run --rm --volume "$volume:/auth" alpine chown -R "$uid:$gid" /auth
docker run --rm -it --user "$uid:$gid" --env HOME=/home/agent \
  --volume "$volume:/home/agent/.codex" "$image" codex login --device-auth
printf '\nCodex subscription authentication saved in Docker volume %s.\n' "$volume"
