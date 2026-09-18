import type { AppConfig } from "../config/index.ts";
import { codexAgentRunner } from "./codex/index.ts";
import { claudeAgentRunner } from "./claude/index.ts";
import type { AgentJob, AgentRunner, StartAgentJobOptions } from "./types.ts";
import type { WebhookContext } from "../core/webhook-context.ts";

const agentRunners: readonly AgentRunner[] = [
  codexAgentRunner,
  claudeAgentRunner
];

export function findAgentRunner(config: AppConfig, agent: string = config.agents.selection.defaultAgent): AgentRunner {
  const runner = agentRunners.find((candidate) => candidate.id === agent);
  if (!runner) {
    throw new AgentRunnerConfigError(
      `Agent runner must be one of ${agentRunners.map((candidate) => candidate.id).join(", ")}`
    );
  }

  return runner;
}

export function agentRunnerIds(): string[] {
  return agentRunners.map((runner) => runner.id);
}

export async function startConfiguredAgentJob(
  config: AppConfig,
  context: WebhookContext,
  prompt: string,
  options?: StartAgentJobOptions
): Promise<AgentJob> {
  return await findAgentRunner(config, context.agentSelection.agent).start(config, context, prompt, options);
}

export class AgentRunnerConfigError extends Error {}
