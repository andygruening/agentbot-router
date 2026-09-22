import assert from "node:assert/strict";
import test from "node:test";
import { agentRunnerIds, findAgentRunner } from "../src/agents/registry.ts";
import { readConfig } from "../src/config/index.ts";

test("agent runner registry exposes Codex and Claude runners", () => {
  assert.deepEqual(agentRunnerIds(), ["codex", "claude"]);
  assert.equal(findAgentRunner(readConfig({ AGENT_DEFAULT: "claude" })).id, "claude");
  assert.equal(findAgentRunner(readConfig({ AGENT_DEFAULT: "codex" })).id, "codex");
});

test("agent runner registry rejects unknown runners", () => {
  assert.throws(
    () => readConfig({ AGENT_DEFAULT: "unknown" }),
    /AGENT_DEFAULT must be codex or claude/
  );
});
