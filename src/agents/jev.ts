import { readFile } from "node:fs/promises";
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { AppConfig } from "../config/index.ts";
import {
  isModelName,
  supportedReasoning,
  type AgentSelection
} from "../core/agent-selection.ts";

type JevChoice = {
  agent: "codex" | "claude";
  model: string;
  reasoning?: string;
  description: string;
};

type JevChoicesFile = {
  question: string;
  options: Record<string, JevChoice>;
};

export type JevDecision = {
  option: string;
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
};

export type JevDecider = (
  userMessage: string,
  question: string,
  descriptions: Record<string, string>,
  apiKey: string
) => Promise<JevDecision>;

export async function routeDefaultAgentWithJev(
  config: AppConfig,
  fallback: AgentSelection,
  userMessage: string | undefined,
  decide: JevDecider = decideWithTypeSafe
): Promise<AgentSelection> {
  const apiKey = config.agents.jev.apiKey;
  if (!apiKey) return withFallback(fallback, "not_configured");
  if (!userMessage?.trim()) return withFallback(fallback, "empty_user_message");

  try {
    const choices = await loadJevChoices(config.agents.jev.choicesPath);
    const enabledAgents = new Set(config.agents.selection.tags);
    const enabledOptions = Object.fromEntries(
      Object.entries(choices.options).filter(([, option]) => enabledAgents.has(option.agent))
    );
    if (Object.keys(enabledOptions).length === 0) {
      throw new Error("Jev choices do not contain an option for a configured agent");
    }
    const descriptions = Object.fromEntries(
      Object.entries(enabledOptions).map(([id, option]) => [
        id,
        `${option.description} Agent: ${option.agent}. Model: ${option.model}.` +
          (option.reasoning ? ` Reasoning: ${option.reasoning}.` : " Use the model's default effort.")
      ])
    );
    const decision = await decide(userMessage.trim(), choices.question, descriptions, apiKey);
    const option = highestProbabilityOption(decision.probabilities) ?? decision.option;
    const selected = enabledOptions[option];
    if (!selected) throw new Error(`Jev returned unknown option "${option}"`);
    if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
      throw new Error("Jev returned invalid confidence");
    }

    return {
      ...fallback,
      agent: selected.agent,
      model: selected.model,
      ...(selected.reasoning ? { reasoning: selected.reasoning } : {}),
      routing: {
        provider: "typesafe-jev",
        option,
        confidence: decision.confidence,
        probabilities: decision.probabilities,
        decisionModel: decision.model
      }
    };
  } catch (error) {
    console.warn("Jev agent routing failed; using configured default:", serializeError(error));
    return withFallback(fallback, "routing_failed");
  }
}

export async function loadJevChoices(filePath: string): Promise<JevChoicesFile> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (!isRecord(parsed) || typeof parsed.question !== "string" || !parsed.question.trim()) {
    throw new Error("Jev choices must contain a non-empty question");
  }
  if (!isRecord(parsed.options) || Object.keys(parsed.options).length < 2) {
    throw new Error("Jev choices must contain at least two options");
  }

  const options: Record<string, JevChoice> = {};
  for (const [id, value] of Object.entries(parsed.options)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id) || !isRecord(value)) {
      throw new Error(`Invalid Jev option "${id}"`);
    }
    const agent = value.agent;
    const model = value.model;
    const reasoning = value.reasoning;
    const description = value.description;
    if ((agent !== "codex" && agent !== "claude") || typeof model !== "string" || !isModelName(model)
      || (reasoning !== undefined &&
        (typeof reasoning !== "string" || !supportedReasoning(agent).includes(reasoning)))
      || typeof description !== "string" || !description.trim()) {
      throw new Error(`Invalid Jev option "${id}"`);
    }
    options[id] = {
      agent,
      model,
      ...(typeof reasoning === "string" ? { reasoning } : {}),
      description: description.trim()
    };
  }

  return { question: parsed.question.trim(), options };
}

async function decideWithTypeSafe(
  userMessage: string,
  question: string,
  descriptions: Record<string, string>,
  apiKey: string
): Promise<JevDecision> {
  const client = new TypeSafeClient({ apiKey });
  const response = await client.systemOne({
    state: { userMessage },
    questions: { agentConfiguration: choice(question, descriptions) }
  });
  const answer = response.answers.agentConfiguration;
  return {
    option: answer.choice,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    model: response.model
  };
}

function withFallback(selection: AgentSelection, fallbackReason: string): AgentSelection {
  return {
    ...selection,
    routing: { provider: "typesafe-jev", fallbackReason }
  };
}

function highestProbabilityOption(probabilities: Record<string, number>): string | undefined {
  let winner: string | undefined;
  let highest = Number.NEGATIVE_INFINITY;
  for (const [option, probability] of Object.entries(probabilities)) {
    if (Number.isFinite(probability) && probability >= 0 && probability <= 1 && probability > highest) {
      winner = option;
      highest = probability;
    }
  }
  return winner;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeError(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };
}
