#!/bin/sh
set -eu

agent_image=${AGENT_DOCKER_IMAGE:-agentbot-router-agent:latest}
repository_image=${REPOSITORY_DOCKER_IMAGE:-agentbot-router-repository:latest}

docker build --target agent-runtime --tag "$agent_image" --file docker/Dockerfile .
docker build --target repository-runtime --tag "$repository_image" --file docker/Dockerfile .
