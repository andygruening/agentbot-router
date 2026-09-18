import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/config/index.ts";

test("readConfig applies local runner defaults", () => {
  const config = readConfig({});
  assert.equal(config.core.host, "127.0.0.1");
  assert.equal(config.core.port, 8787);
  assert.equal(config.agents.selection.defaultAgent, "codex");
  assert.deepEqual(config.agents.selection.tags, ["codex", "claude"]);
  assert.equal(config.agents.codex.command, "codex");
  assert.equal(config.agents.codex.defaultModel, "gpt-5.5");
  assert.equal(config.agents.claude.command, "claude");
  assert.equal(config.agents.claude.model, undefined);
  assert.equal(config.agents.claude.execTimeoutMs, 3_600_000);
  assert.deepEqual(config.agents.claude.envPassthrough, ["ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR"]);
  assert.equal(config.integrations.github.webhookPath, "/webhooks/github");
  assert.equal(config.integrations.github.responseEnabled, true);
  assert.equal(config.integrations.github.contextEnabled, true);
});

test("readConfig parses runner options and allow lists", () => {
  const config = readConfig({
    AGENT_DEFAULT: "claude",
    AGENT_TAGS: "codex, claude",
    ALLOWED_EVENTS: "issues, issue_comment",
    CLAUDE_COMMAND: "/opt/bin/claude",
    CLAUDE_MODEL: "sonnet",
    CLAUDE_EXTRA_ARGS_JSON: '["--permission-mode","acceptEdits"]',
    CLAUDE_ENV_PASSTHROUGH_JSON: '["ANTHROPIC_API_KEY"]',
    CLAUDE_WORKING_DIRECTORY: "/tmp/project",
    CLAUDE_EXEC_TIMEOUT_MS: "12345",
    CODEX_SANDBOX: "workspace-write",
    GITHUB_COMPLETION_REACTION: "rocket"
  });
  assert.equal(config.agents.selection.defaultAgent, "claude");
  assert.deepEqual(config.agents.selection.tags, ["codex", "claude"]);
  assert.equal(config.agents.claude.command, "/opt/bin/claude");
  assert.equal(config.agents.claude.model, "sonnet");
  assert.deepEqual(config.agents.claude.extraArgs, ["--permission-mode", "acceptEdits"]);
  assert.deepEqual(config.agents.claude.envPassthrough, ["ANTHROPIC_API_KEY"]);
  assert.equal(config.agents.claude.workingDirectory, "/tmp/project");
  assert.equal(config.agents.claude.execTimeoutMs, 12345);
  assert.equal(config.core.allowedEvents?.has("issue_comment"), true);
  assert.equal(config.agents.codex.sandbox, "workspace-write");
  assert.equal(config.integrations.github.completionReaction, "rocket");
});

test("readConfig rejects malformed runner settings", () => {
  assert.throws(() => readConfig({ CLAUDE_EXTRA_ARGS_JSON: '"--print"' }));
  assert.throws(() => readConfig({ CLAUDE_ENV_PASSTHROUGH_JSON: '"ANTHROPIC_API_KEY"' }));
  assert.throws(() => readConfig({ CLAUDE_EXEC_TIMEOUT_MS: "0" }));
  assert.throws(() => readConfig({ AGENT_DEFAULT: "superset" }));
  assert.throws(() => readConfig({ AGENT_TAGS: "codex,superset" }));
  assert.throws(() => readConfig({ CODEX_SANDBOX: "full" }));
  assert.throws(() => readConfig({ CODEX_APPROVAL_POLICY: "always" }));
  assert.throws(() => readConfig({ GITHUB_COMPLETION_REACTION: "eyes" }));
});
