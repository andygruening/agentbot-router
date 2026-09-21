import assert from "node:assert/strict";
import test from "node:test";
import {
  AmbiguousAgentTagError,
  InvalidAgentTagError,
  selectAgentFromGitHubPayload as selectAgentFromPayload
} from "../src/integrations/github/agent-tags.ts";
import { readConfig } from "../src/config/index.ts";

test("$agent selects the configured default CLI", () => {
  const selection = selectAgentFromPayload(
    {
      comment: { body: "$agent please investigate" }
    },
    readConfig({
      AGENT_DEFAULT: "codex",
      AGENT_TAGS: "codex,claude"
    }).agents.selection
  );

  assert.deepEqual(selection, {
    agent: "codex",
    tag: "agent",
    source: "text",
    usesDefaultAgent: true
  });
});

test("direct configured tags select that CLI", () => {
  const selection = selectAgentFromPayload(
    {
      comment: { body: "$agent $claude please investigate" }
    },
    readConfig({
      AGENT_DEFAULT: "codex",
      AGENT_TAGS: "codex,claude"
    }).agents.selection
  );

  assert.equal(selection?.agent, "claude");
  assert.equal(selection?.usesDefaultAgent, false);
});

test("agent tags select model and reasoning overrides", () => {
  const config = readConfig({ AGENT_TAGS: "codex,claude" }).agents.selection;

  assert.deepEqual(
    selectAgentFromPayload({ comment: { body: "$codex:gpt-5.6-sol:low fix this" } }, config),
    {
      agent: "codex", model: "gpt-5.6-sol", reasoning: "low",
      tag: "codex:gpt-5.6-sol:low", source: "text", usesDefaultAgent: false
    }
  );
  assert.deepEqual(
    selectAgentFromPayload({ issue: { labels: [{ name: "claude:fable-5.1" }] } }, config),
    {
      agent: "claude", model: "fable-5.1",
      tag: "claude:fable-5.1", source: "label", usesDefaultAgent: false
    }
  );
  assert.equal(
    selectAgentFromPayload({ comment: { body: "Please handle this with $codex:gpt-5.6-sol:low." } }, config)?.reasoning,
    "low"
  );
});

test("agent tags reject invalid models and unsupported reasoning", () => {
  const config = readConfig({ AGENT_TAGS: "codex,claude" }).agents.selection;
  for (const tag of ["$codex::low", "$codex:gpt-5.6-sol:max", "$claude:fable-5.1:minimal"]) {
    assert.throws(
      () => selectAgentFromPayload({ comment: { body: tag } }, config),
      InvalidAgentTagError
    );
  }
});

test("different configurations for the same agent are ambiguous", () => {
  const config = readConfig({ AGENT_TAGS: "codex,claude" }).agents.selection;
  assert.throws(
    () => selectAgentFromPayload(
      { comment: { body: "$codex:gpt-5.6-sol:low $codex:gpt-5.6-sol:high" } },
      config
    ),
    AmbiguousAgentTagError
  );
});

test("issue_comment tags are read only from the new comment", () => {
  const selection = selectAgentFromPayload(
    {
      comment: { body: "Agent finished without a trigger tag." },
      issue: {
        body: "$codex please handle this",
        labels: [{ name: "codex" }]
      }
    },
    readConfig({
      AGENT_DEFAULT: "codex",
      AGENT_TAGS: "codex,claude"
    }).agents.selection,
    "issue_comment"
  );

  assert.equal(selection, undefined);
});

test("issue_comment direct tag is not made ambiguous by tags on the issue", () => {
  const selection = selectAgentFromPayload(
    {
      comment: { body: "$claude please handle this follow-up" },
      issue: {
        body: "$codex please handle this",
        labels: [{ name: "codex" }]
      }
    },
    readConfig({
      AGENT_DEFAULT: "codex",
      AGENT_TAGS: "codex,claude"
    }).agents.selection,
    "issue_comment"
  );

  assert.equal(selection?.agent, "claude");
  assert.equal(selection?.source, "text");
});

test("labels can select the default or a direct agent", () => {
  const config = readConfig({
    AGENT_DEFAULT: "codex",
    AGENT_TAGS: "codex,claude"
  }).agents.selection;

  assert.equal(
    selectAgentFromPayload({ issue: { labels: [{ name: "agent" }] } }, config)?.agent,
    "codex"
  );
  assert.equal(
    selectAgentFromPayload({ pull_request: { labels: [{ name: "claude" }] } }, config)?.agent,
    "claude"
  );
});

test("multiple direct agent tags are rejected as ambiguous", () => {
  assert.throws(
    () =>
      selectAgentFromPayload(
        {
          comment: { body: "$codex $claude" }
        },
        readConfig({
          AGENT_DEFAULT: "codex",
          AGENT_TAGS: "codex,claude"
        }).agents.selection
      ),
    AmbiguousAgentTagError
  );
});

test("agent-prefixed text tags do not bypass the configured allow-list", () => {
  const selection = selectAgentFromPayload(
    {
      comment: { body: "$agent:gpt-5.4" }
    },
    readConfig({
      AGENT_DEFAULT: "codex",
      AGENT_TAGS: "codex,claude"
    }).agents.selection
  );

  assert.equal(selection, undefined);
});
