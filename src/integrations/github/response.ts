import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentJob, WorkerResult } from "../../agents/types.ts";
import type { AppConfig, GitHubReactionContent } from "../../config/index.ts";
import { runGh } from "./gh.ts";
export { buildGitHubEnv } from "./gh.ts";

export type GitHubReactionTargetKind =
  | "issue"
  | "issue-comment"
  | "pull-request-review-comment";

export type GitHubResponseTarget = {
  repo: string;
  issueNumber: number;
  reactionTarget: {
    kind: GitHubReactionTargetKind;
    apiPath: string;
  };
};

export type GitHubResponseState = {
  target: GitHubResponseTarget;
  responsePath: string;
  commentBodyPath: string;
  processingReaction?: {
    id: number;
    apiPath: string;
    deleteApiPath: string;
    content: "eyes";
    createdAt: string;
  };
  completionReaction?: {
    id: number;
    apiPath: string;
    deleteApiPath: string;
    content: Exclude<GitHubReactionContent, "eyes">;
    createdAt: string;
  };
  completedAt?: string;
  commentPosted?: boolean;
  processingReactionRemoved?: boolean;
  errors: GitHubResponseErrorRecord[];
};

export type GitHubResponseErrorRecord = {
  step: string;
  message: string;
};

export class GitHubResponseError extends Error {
  readonly step: string;

  constructor(step: string, message: string) {
    super(message);
    this.step = step;
  }
}

class AgentOutputError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.path = path;
  }
}

export function extractGitHubResponseTarget(
  payload: unknown,
  eventName: string
): GitHubResponseTarget | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const repo = readString(isRecord(payload.repository) ? payload.repository.full_name : undefined);
  const issue = isRecord(payload.issue) ? payload.issue : undefined;
  const pullRequest = isRecord(payload.pull_request) ? payload.pull_request : undefined;
  const issueNumber = readPositiveInteger(issue?.number) ?? readPositiveInteger(pullRequest?.number);

  if (!repo || !issueNumber) {
    return undefined;
  }

  const comment = isRecord(payload.comment) ? payload.comment : undefined;
  const commentId = readPositiveInteger(comment?.id);
  if (commentId && eventName === "issue_comment") {
    return {
      repo,
      issueNumber,
      reactionTarget: {
        kind: "issue-comment",
        apiPath: `repos/${repo}/issues/comments/${commentId}/reactions`
      }
    };
  }

  if (commentId && eventName === "pull_request_review_comment") {
    return {
      repo,
      issueNumber,
      reactionTarget: {
        kind: "pull-request-review-comment",
        apiPath: `repos/${repo}/pulls/comments/${commentId}/reactions`
      }
    };
  }

  return {
    repo,
    issueNumber,
    reactionTarget: {
      kind: "issue",
      apiPath: `repos/${repo}/issues/${issueNumber}/reactions`
    }
  };
}

export async function beginGitHubResponse(
  config: AppConfig,
  jobDir: string,
  target: GitHubResponseTarget
): Promise<GitHubResponseState> {
  const state: GitHubResponseState = {
    target,
    responsePath: path.join(jobDir, "github-response.json"),
    commentBodyPath: path.join(jobDir, "github-result-comment.md"),
    errors: []
  };

  if (!config.integrations.github.responseEnabled || config.core.dryRun) {
    await writeGitHubResponseState(state);
    logGitHubResponse("GitHub processing reaction skipped:", {
      reason: config.core.dryRun ? "dry_run" : "github_response_disabled",
      target
    });
    return state;
  }

  await assertGhAuthenticated(config);
  state.processingReaction = await createGitHubReaction(
    config,
    target.reactionTarget.apiPath,
    "eyes",
    "add_processing_reaction"
  );
  await writeGitHubResponseState(state);
  logGitHubResponse("GitHub processing reaction added:", {
    target,
    reaction: state.processingReaction
  });
  return state;
}

export async function completeGitHubResponse(
  config: AppConfig,
  state: GitHubResponseState | undefined,
  job: AgentJob,
  result: WorkerResult | undefined
): Promise<GitHubResponseState | undefined> {
  if (!state) {
    return undefined;
  }

  state.completedAt = new Date().toISOString();
  let commentBody: string | undefined;
  try {
    commentBody = await buildResultComment(job, result);
    await writeFile(state.commentBodyPath, commentBody);
  } catch (error: unknown) {
    state.errors.push({
      step: error instanceof AgentOutputError ? "read_agent_output" : "build_result_comment",
      message: errorMessage(error)
    });
    await writeFile(state.commentBodyPath, "");
  }

  if (!config.integrations.github.responseEnabled || config.core.dryRun) {
    await writeGitHubResponseState(state);
    logGitHubResponse("GitHub result comment skipped:", {
      reason: config.core.dryRun ? "dry_run" : "github_response_disabled",
      target: state.target,
      commentBodyPath: state.commentBodyPath
    });
    return state;
  }

  if (commentBody !== undefined) {
    try {
      const commentResult = await runGh(config.integrations.github, [
        "issue",
        "comment",
        String(state.target.issueNumber),
        "--repo",
        state.target.repo,
        "--body-file",
        state.commentBodyPath
      ]);
      if (commentResult.exitCode !== 0) {
        state.errors.push({
          step: "post_result_comment",
          message: commentResult.stderr.trim()
        });
      } else {
        state.commentPosted = true;
        logGitHubResponse("GitHub result comment posted:", {
          repo: state.target.repo,
          issueNumber: state.target.issueNumber,
          commentBodyPath: state.commentBodyPath
        });
      }
    } catch (error: unknown) {
      state.errors.push({
        step: "post_result_comment",
        message: errorMessage(error)
      });
    }
  } else {
    logGitHubResponse("GitHub result comment skipped:", {
      reason: "agent_output_missing",
      target: state.target,
      commentBodyPath: state.commentBodyPath
    });
  }

  const terminalReaction = isSuccessfulCompletion(job, result) && state.errors.length === 0
    ? config.integrations.github.completionReaction
    : "-1";
  if (commentBody === undefined && state.errors.length === 0) {
    state.errors.push({
      step: "terminal_status",
      message: "Agent output was unavailable"
    });
  }
  try {
    state.completionReaction = await createGitHubReaction(
      config,
      state.target.reactionTarget.apiPath,
      terminalReaction,
      "add_completion_reaction"
    );
    logGitHubResponse("GitHub terminal reaction added:", {
      target: state.target,
      reaction: state.completionReaction
    });
  } catch (error: unknown) {
    state.errors.push({
      step: "add_completion_reaction",
      message: errorMessage(error)
    });
  }

  // Keep the processing marker when GitHub could not record a terminal state.
  if (state.processingReaction && state.completionReaction) {
    try {
      const deleteResult = await runGh(config.integrations.github, [
        "api",
        "--method",
        "DELETE",
        state.processingReaction.deleteApiPath,
        "-H",
        "Accept: application/vnd.github+json"
      ]);
      if (deleteResult.exitCode !== 0) {
        state.errors.push({
          step: "remove_processing_reaction",
          message: deleteResult.stderr.trim()
        });
      } else {
        state.processingReactionRemoved = true;
        logGitHubResponse("GitHub processing reaction removed:", {
          target: state.target,
          reactionId: state.processingReaction.id
        });
      }
    } catch (error: unknown) {
      state.errors.push({
        step: "remove_processing_reaction",
        message: errorMessage(error)
      });
    }
  }

  await writeGitHubResponseState(state);
  if (state.errors.length > 0) {
    logGitHubResponse("GitHub response completed with errors:", {
      target: state.target,
      errors: state.errors
    });
  }

  return state;
}

export async function buildResultComment(
  job: AgentJob,
  result: WorkerResult | undefined
): Promise<string> {
  if (result) {
    const output = await readAgentOutput(job.agentOutputPath);
    if (output !== undefined && output.trim()) {
      return appendProcessingSignature(output, job);
    }

    throw new AgentOutputError(
      job.agentOutputPath,
      `Agent did not write a non-empty agent output file at ${job.agentOutputPath}`
    );
  }

  return appendProcessingSignature(buildPublicFailureMessage(job), job);
}

function buildPublicFailureMessage(job: AgentJob): string {
  const failure = classifyFailure(job);
  return [
    "The agent could not complete this task.",
    "",
    `**Stage:** ${failure.stage}`,
    `**Error:** ${failure.message}`,
    `**Job ID:** \`${formatInlineCode(job.jobId)}\``,
    "",
    "See the server job logs for full diagnostic output."
  ].join("\n");
}

function classifyFailure(job: AgentJob): { stage: string; message: string } {
  const error = job.error?.toLowerCase() ?? "";

  if (job.status === "timeout" || job.signal === "SIGTERM") {
    return { stage: "Agent execution", message: "The agent exceeded its execution timeout." };
  }
  if (
    error.includes("authentication is missing") ||
    error.includes("401 unauthorized") ||
    error.includes("missing bearer or basic authentication") ||
    error.includes("not logged in")
  ) {
    return { stage: "Agent authentication", message: "The selected agent CLI is not authenticated." };
  }
  if (
    error.includes("could not create work tree") ||
    error.includes("failed to initialize in-process app-server") ||
    error.includes("permission denied") ||
    error.includes("operation not permitted")
  ) {
    return { stage: "Container setup", message: "The agent container encountered a filesystem permission error." };
  }
  if (
    error.includes("could not read username") ||
    error.includes("failed to push") ||
    error.includes("git push") ||
    error.includes("gh pr create") ||
    error.includes("pull request")
  ) {
    return { stage: "Repository delivery", message: "The changes could not be pushed or delivered as a pull request." };
  }
  if (
    error.includes("repository not found") ||
    error.includes("could not read from remote repository") ||
    error.includes("failed to run git")
  ) {
    return { stage: "Repository checkout", message: "The repository could not be cloned or checked out." };
  }
  if (error.includes("without a valid worker completion envelope")) {
    return { stage: "Result processing", message: "The agent finished without returning a valid completion result." };
  }
  if (
    error.includes("cannot connect to the docker daemon") ||
    error.includes("docker: command not found") ||
    error.includes("spawn docker")
  ) {
    return { stage: "Container launch", message: "The agent container could not be started." };
  }

  return { stage: "Agent execution", message: "The agent process exited unexpectedly." };
}

function formatInlineCode(value: string): string {
  return value.replaceAll("`", "'").replace(/[\r\n]/g, " ");
}

function appendProcessingSignature(body: string, job: AgentJob): string {
  const parts = [formatAgentName(job.agent)];
  if (job.model) parts.push(formatModelName(job.model));
  if (job.reasoning) parts.push(`${formatWords(job.reasoning)} reasoning`);
  return `${body.trimEnd()}\n\n---\n\n*Processed by ${parts.join(" · ")}*`;
}

function formatAgentName(agent: string): string {
  if (agent.toLowerCase() === "codex") return "Codex";
  if (agent.toLowerCase() === "claude") return "Claude";
  return formatWords(agent);
}

function formatModelName(model: string): string {
  return model
    .split("-")
    .map((part) => part.toLowerCase() === "gpt" ? "GPT" : formatWords(part))
    .join(" ");
}

function formatWords(value: string): string {
  return value.replaceAll("_", " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

async function assertGhAuthenticated(config: AppConfig): Promise<void> {
  const result = await runGh(config.integrations.github, ["auth", "status"]);
  if (result.exitCode !== 0) {
    throw new GitHubResponseError("gh_auth_status", result.stderr.trim());
  }
}

async function createGitHubReaction<TContent extends GitHubReactionContent>(
  config: AppConfig,
  apiPath: string,
  content: TContent,
  step: string
): Promise<{
  id: number;
  apiPath: string;
  deleteApiPath: string;
  content: TContent;
  createdAt: string;
}> {
  const result = await runGh(config.integrations.github, [
    "api",
    "--method",
    "POST",
    apiPath,
    "-H",
    "Accept: application/vnd.github+json",
    "-f",
    `content=${content}`
  ]);
  if (result.exitCode !== 0) {
    throw new GitHubResponseError(step, result.stderr.trim());
  }

  const reaction = parseJsonObject(result.stdout);
  const reactionId = readPositiveInteger(reaction.id);
  if (!reactionId) {
    throw new GitHubResponseError(step, "GitHub did not return a reaction id");
  }

  return {
    id: reactionId,
    apiPath,
    deleteApiPath: `${apiPath}/${reactionId}`,
    content,
    createdAt: new Date().toISOString()
  };
}

async function writeGitHubResponseState(state: GitHubResponseState): Promise<void> {
  await writeFile(state.responsePath, `${JSON.stringify(state, null, 2)}\n`);
}

function isSuccessfulCompletion(job: AgentJob, result: WorkerResult | undefined): boolean {
  return result?.status === "completed" || job.status === "completed";
}

async function readAgentOutput(agentOutputPath: string): Promise<string | undefined> {
  try {
    return await readFile(agentOutputPath, "utf8");
  } catch {
    return undefined;
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }

  return parsed as Record<string, unknown>;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function logGitHubResponse(message: string, details: Record<string, unknown>): void {
  console.log(message, JSON.stringify({ at: new Date().toISOString(), ...details }, null, 2));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
