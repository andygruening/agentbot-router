import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadJevChoices,
  routeDefaultAgentWithJev,
  type JevDecider
} from "../src/agents/jev.ts";
import { readConfig } from "../src/config/index.ts";
import type { AgentSelection } from "../src/core/agent-selection.ts";

const fallback: AgentSelection = {
  agent: "codex",
  tag: "agent",
  source: "text",
  usesDefaultAgent: true
};

test("Jev routes $agent to the selected model and reasoning", async () => {
  const choicesPath = await writeChoices();
  const decide: JevDecider = async (message, question, descriptions, apiKey) => {
    assert.equal(message, "Investigate the race condition");
    assert.match(question, /Which configuration/);
    assert.equal(
      descriptions.claude_high,
      "Complex analysis Agent: claude. Model: fable-5.1. Reasoning: high."
    );
    assert.equal(apiKey, "typesafe-test-key");
    return {
      option: "codex_low",
      confidence: 0.91,
      probabilities: { codex_low: 0.09, claude_high: 0.91 },
      model: "jev-test"
    };
  };
  const config = readConfig({
    AGENT_TAGS: "codex,claude",
    TYPESAFE_API_KEY: "typesafe-test-key",
    JEV_CHOICES_PATH: choicesPath
  });

  const selected = await routeDefaultAgentWithJev(
    config,
    fallback,
    "Investigate the race condition",
    decide
  );

  assert.deepEqual(selected, {
    ...fallback,
    agent: "claude",
    model: "fable-5.1",
    reasoning: "high",
    routing: {
      provider: "typesafe-jev",
      option: "claude_high",
      confidence: 0.91,
      probabilities: { codex_low: 0.09, claude_high: 0.91 },
      decisionModel: "jev-test"
    }
  });
});

test("Jev falls back without an API key", async () => {
  const selected = await routeDefaultAgentWithJev(readConfig({}), fallback, "Fix this");
  assert.deepEqual(selected, {
    ...fallback,
    routing: { provider: "typesafe-jev", fallbackReason: "not_configured" }
  });
});

test("Jev excludes choices for agents that are not configured", async () => {
  const choicesPath = await writeChoices();
  const decide: JevDecider = async (_message, _question, descriptions) => {
    assert.deepEqual(Object.keys(descriptions), ["codex_low"]);
    return {
      option: "codex_low",
      confidence: 1,
      probabilities: { codex_low: 1 },
      model: "jev-test"
    };
  };
  const config = readConfig({
    AGENT_TAGS: "codex",
    TYPESAFE_API_KEY: "typesafe-test-key",
    JEV_CHOICES_PATH: choicesPath
  });

  const selected = await routeDefaultAgentWithJev(config, fallback, "Fix this", decide);

  assert.equal(selected.agent, "codex");
  assert.equal(selected.model, "gpt-5.6-sol");
  assert.equal(selected.reasoning, "low");
});

test("Jev choices reject unsupported reasoning", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jev-invalid-"));
  const choicesPath = path.join(directory, "choices.json");
  await writeFile(choicesPath, JSON.stringify({
    question: "Choose",
    options: {
      invalid: { agent: "codex", model: "gpt-5.6-sol", reasoning: "max", description: "Invalid" },
      valid: { agent: "claude", model: "fable-5.1", reasoning: "low", description: "Valid" }
    }
  }));
  await assert.rejects(() => loadJevChoices(choicesPath), /Invalid Jev option/);
});

async function writeChoices(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jev-choices-"));
  const choicesPath = path.join(directory, "choices.json");
  await writeFile(choicesPath, JSON.stringify({
    question: "Which configuration should handle this?",
    options: {
      codex_low: {
        agent: "codex", model: "gpt-5.6-sol", reasoning: "low", description: "Routine work"
      },
      claude_high: {
        agent: "claude", model: "fable-5.1", reasoning: "high", description: "Complex analysis"
      }
    }
  }));
  return choicesPath;
}
