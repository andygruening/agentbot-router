FROM node:22-bookworm-slim AS agent-runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gosu jq openssh-client \
 && npm install --global @openai/codex @anthropic-ai/claude-code \
 && rm -rf /var/lib/apt/lists/*

COPY docker/agent-entrypoint.sh /usr/local/bin/agent-entrypoint
RUN chmod 0755 /usr/local/bin/agent-entrypoint \
 && mkdir -p /home/agent /workspace \
 && chmod 1777 /home/agent /workspace

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/agent-entrypoint"]

FROM debian:bookworm-slim AS repository-runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates gh git gosu openssh-client \
 && rm -rf /var/lib/apt/lists/*

COPY docker/repository-entrypoint.sh /usr/local/bin/repository-entrypoint
RUN chmod 0755 /usr/local/bin/repository-entrypoint \
 && mkdir -p /home/repository /workspace \
 && chmod 1777 /home/repository /workspace

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/repository-entrypoint"]

# Keep an unqualified `docker build` backward-compatible with the agent image.
FROM agent-runtime AS default-runtime
