FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gosu jq openssh-client \
 && npm install --global @openai/codex @anthropic-ai/claude-code \
 && rm -rf /var/lib/apt/lists/*

COPY docker/agent-entrypoint.sh /usr/local/bin/agent-entrypoint
RUN chmod 0755 /usr/local/bin/agent-entrypoint \
 && mkdir -p /home/agent /workspace \
 && chmod 1777 /home/agent /workspace

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/agent-entrypoint"]
