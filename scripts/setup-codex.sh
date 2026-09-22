#!/bin/sh
set -eu
image=${AGENT_DOCKER_IMAGE:-local-agent-bot-agent:latest}
volume=${CODEX_AUTH_VOLUME:-local-agent-codex-auth}
docker build --tag "$image" --file docker/Dockerfile .
docker volume create "$volume" >/dev/null
docker run --rm -it --volume "$volume:/root/.codex" "$image" codex login --device-auth
printf '\nCodex subscription authentication saved in Docker volume %s.\n' "$volume"
