import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/config/index.ts";

test("readConfig applies Docker runner defaults", () => {
  const config = readConfig({});
  assert.equal(config.core.host, "127.0.0.1");
  assert.equal(config.agents.selection.defaultAgent, "codex");
  assert.deepEqual(config.agents.selection.tags, ["codex"]);
  assert.equal(config.agents.docker.command, "docker");
  assert.equal(config.agents.docker.image, "agentbot-router-agent:latest");
  assert.equal(config.agents.docker.repositoryImage, "agentbot-router-repository:latest");
  assert.equal(config.agents.docker.pull, false);
  assert.equal(config.agents.docker.codexAuthVolume, "agentbot-router-codex-auth");
  assert.equal(config.agents.docker.claudeAuthVolume, "agentbot-router-claude-auth");
  assert.equal(config.agents.docker.execTimeoutMs, 3_600_000);
  assert.equal(config.agents.jev.apiKey, undefined);
  assert.match(config.agents.jev.choicesPath, /jev-choices\.json$/);
});

test("readConfig parses Docker runner settings", () => {
  const config = readConfig({ DOCKER_COMMAND: "/usr/bin/docker", AGENT_DOCKER_IMAGE: "example/agent:v1",
    REPOSITORY_DOCKER_IMAGE: "example/repository:v1",
    AGENT_DOCKER_PULL: "true", AGENT_EXEC_TIMEOUT_MS: "12345", CODEX_AUTH_VOLUME: "codex-login",
    CLAUDE_AUTH_VOLUME: "claude-login", AGENT_DEFAULT: "claude",
    TYPESAFE_API_KEY: "typesafe-key", JEV_CHOICES_PATH: "config/choices.json" });
  assert.equal(config.agents.docker.command, "/usr/bin/docker");
  assert.equal(config.agents.docker.image, "example/agent:v1");
  assert.equal(config.agents.docker.repositoryImage, "example/repository:v1");
  assert.equal(config.agents.docker.pull, true);
  assert.equal(config.agents.docker.execTimeoutMs, 12345);
  assert.equal(config.agents.docker.codexAuthVolume, "codex-login");
  assert.equal(config.agents.docker.claudeAuthVolume, "claude-login");
  assert.equal(config.agents.jev.apiKey, "typesafe-key");
  assert.match(config.agents.jev.choicesPath, /config\/choices\.json$/);
});

test("readConfig rejects malformed settings", () => {
  assert.throws(() => readConfig({ AGENT_DEFAULT: "superset" }));
  assert.throws(() => readConfig({ AGENT_TAGS: "codex,superset" }));
  assert.throws(() => readConfig({ AGENT_DOCKER_PULL: "sometimes" }));
  assert.throws(() => readConfig({ AGENT_EXEC_TIMEOUT_MS: "0" }));
  assert.throws(() => readConfig({ GITHUB_COMPLETION_REACTION: "eyes" }));
});
