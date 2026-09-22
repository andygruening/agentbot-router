import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadJevChoices,
  routeAgentWithJev,
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

  const selected = await routeAgentWithJev(
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

test("Jev routing requires an API key", async () => {
  await assert.rejects(
    () => routeAgentWithJev(readConfig({}), fallback, "Fix this"),
    /TYPESAFE_API_KEY is required/
  );
});

test("fully specified tags are validated without calling Jev", async () => {
  const choicesPath = await writeChoices();
  const selection: AgentSelection = {
    agent: "codex",
    model: "gpt-5.6-sol",
    reasoning: "low",
    tag: "codex:gpt-5.6-sol:low",
    source: "text",
    usesDefaultAgent: false
  };
  const config = readConfig({ AGENT_TAGS: "codex", JEV_CHOICES_PATH: choicesPath });
  const decide: JevDecider = async () => {
    throw new Error("Jev should not be called");
  };

  assert.deepEqual(await routeAgentWithJev(config, selection, "Fix this", decide), selection);
  await assert.rejects(
    () => routeAgentWithJev(config, { ...selection, reasoning: "max" }, "Fix this", decide),
    /do not contain an option matching the agent tag/
  );
});

test("Jev excludes choices for agents that are not configured", async () => {
  const choicesPath = await writeChoices();
  const decide: JevDecider = async (_message, _question, descriptions) => {
    assert.deepEqual(Object.keys(descriptions), ["codex_low", "codex_high"]);
    return {
      option: "codex_low",
      confidence: 1,
      probabilities: { codex_low: 1, codex_high: 0 },
      model: "jev-test"
    };
  };
  const config = readConfig({
    AGENT_TAGS: "codex",
    TYPESAFE_API_KEY: "typesafe-test-key",
    JEV_CHOICES_PATH: choicesPath
  });

  const selected = await routeAgentWithJev(config, fallback, "Fix this", decide);

  assert.equal(selected.agent, "codex");
  assert.equal(selected.model, "gpt-5.6-sol");
  assert.equal(selected.reasoning, "low");
});

test("Jev selects model and reasoning within a directly tagged agent", async () => {
  const choicesPath = await writeChoices();
  const selection: AgentSelection = {
    agent: "codex",
    tag: "codex",
    source: "text",
    usesDefaultAgent: false
  };
  const decide: JevDecider = async (_message, _question, descriptions) => {
    assert.deepEqual(Object.keys(descriptions), ["codex_low", "codex_high"]);
    return {
      option: "codex_high",
      confidence: 0.75,
      probabilities: { codex_low: 0.25, codex_high: 0.75 },
      model: "jev-test"
    };
  };
  const config = readConfig({
    AGENT_TAGS: "codex,claude",
    TYPESAFE_API_KEY: "typesafe-test-key",
    JEV_CHOICES_PATH: choicesPath
  });

  const selected = await routeAgentWithJev(config, selection, "Investigate this", decide);

  assert.equal(selected.agent, "codex");
  assert.equal(selected.model, "gpt-5.6-sol");
  assert.equal(selected.reasoning, "high");
});

test("Jev fills only the missing reasoning for a selected agent and model", async () => {
  const choicesPath = await writeChoices();
  const selection: AgentSelection = {
    agent: "codex",
    model: "gpt-5.6-sol",
    tag: "codex:gpt-5.6-sol",
    source: "text",
    usesDefaultAgent: false
  };
  const decide: JevDecider = async (_message, _question, descriptions) => {
    assert.deepEqual(Object.keys(descriptions), ["codex_low", "codex_high"]);
    return {
      option: "codex_low",
      confidence: 0.8,
      probabilities: { codex_low: 0.2, codex_high: 0.8 },
      model: "jev-test"
    };
  };
  const config = readConfig({
    AGENT_TAGS: "codex,claude",
    TYPESAFE_API_KEY: "typesafe-test-key",
    JEV_CHOICES_PATH: choicesPath
  });

  const selected = await routeAgentWithJev(config, selection, "Debug this", decide);

  assert.equal(selected.agent, "codex");
  assert.equal(selected.model, "gpt-5.6-sol");
  assert.equal(selected.reasoning, "high");
  assert.equal(selected.routing?.option, "codex_high");
});

test("Jev choices reject unsupported reasoning", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jev-invalid-"));
  const choicesPath = path.join(directory, "choices.json");
  await writeFile(choicesPath, JSON.stringify({
    question: "Choose",
    options: {
      invalid: { agent: "codex", model: "gpt-5.6-sol", reasoning: "minimal", description: "Invalid" },
      valid: { agent: "claude", model: "fable-5.1", reasoning: "low", description: "Valid" }
    }
  }));
  await assert.rejects(() => loadJevChoices(choicesPath), /Invalid Jev option/);
});

test("Jev choices allow a model without an effort override", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jev-default-effort-"));
  const choicesPath = path.join(directory, "choices.json");
  await writeFile(choicesPath, JSON.stringify({
    question: "Choose",
    options: {
      haiku: { agent: "claude", model: "haiku", description: "Fast simple work" },
      sonnet: { agent: "claude", model: "sonnet", reasoning: "high", description: "Daily coding" }
    }
  }));

  const choices = await loadJevChoices(choicesPath);
  assert.equal(choices.options.haiku?.reasoning, undefined);
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
      codex_high: {
        agent: "codex", model: "gpt-5.6-sol", reasoning: "high", description: "Difficult work"
      },
      claude_high: {
        agent: "claude", model: "fable-5.1", reasoning: "high", description: "Complex analysis"
      }
    }
  }));
  return choicesPath;
}
