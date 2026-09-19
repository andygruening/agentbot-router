import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/config/index.ts";

test("readConfig applies Docker runner defaults", () => {
  const config = readConfig({});
  assert.equal(config.core.host, "127.0.0.1");
  assert.equal(config.agents.selection.defaultAgent, "codex");
  assert.deepEqual(config.agents.selection.tags, ["codex", "claude"]);
  assert.equal(config.agents.docker.command, "docker");
  assert.equal(config.agents.docker.image, "local-agent-bot-agent:latest");
  assert.equal(config.agents.docker.pull, false);
  assert.equal(config.agents.docker.codexAuthVolume, "local-agent-codex-auth");
  assert.equal(config.agents.docker.claudeAuthVolume, "local-agent-claude-auth");
  assert.equal(config.agents.docker.execTimeoutMs, 3_600_000);
});

test("readConfig parses Docker runner settings", () => {
  const config = readConfig({ DOCKER_COMMAND: "/usr/bin/docker", AGENT_DOCKER_IMAGE: "example/agent:v1",
    AGENT_DOCKER_PULL: "true", AGENT_EXEC_TIMEOUT_MS: "12345", CODEX_AUTH_VOLUME: "codex-login",
    CLAUDE_AUTH_VOLUME: "claude-login", AGENT_DEFAULT: "claude", CLAUDE_MODEL: "sonnet" });
  assert.equal(config.agents.docker.command, "/usr/bin/docker");
  assert.equal(config.agents.docker.image, "example/agent:v1");
  assert.equal(config.agents.docker.pull, true);
  assert.equal(config.agents.docker.execTimeoutMs, 12345);
  assert.equal(config.agents.docker.codexAuthVolume, "codex-login");
  assert.equal(config.agents.docker.claudeAuthVolume, "claude-login");
  assert.equal(config.agents.claude.model, "sonnet");
});

test("readConfig rejects malformed settings", () => {
  assert.throws(() => readConfig({ AGENT_DEFAULT: "superset" }));
  assert.throws(() => readConfig({ AGENT_TAGS: "codex,superset" }));
  assert.throws(() => readConfig({ AGENT_DOCKER_PULL: "sometimes" }));
  assert.throws(() => readConfig({ AGENT_EXEC_TIMEOUT_MS: "0" }));
  assert.throws(() => readConfig({ GITHUB_COMPLETION_REACTION: "eyes" }));
});
