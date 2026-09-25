import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../../config/index.ts";
import type { WebhookContext } from "../../core/webhook-context.ts";
import { parseWorkerResult } from "../shared/completion-envelope.ts";
import { writeJsonFileAtomic } from "../shared/json-files.ts";
import type { AgentJob, AgentRunner, StartAgentJobOptions, WorkerResult } from "../types.ts";

type DockerPhase = "prepare" | "agent" | "finalize";

type CommandResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
};

type WorkflowOutcome = {
  stdout: string;
  stderr: string;
  agentStdout: string;
  result?: WorkerResult;
  failedPhase?: DockerPhase | "workspace";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  error?: string;
};

const runner = (id: "codex" | "claude", displayName: string): AgentRunner => ({
  id,
  displayName,
  start: startDockerAgentJob
});

export const codexDockerRunner = runner("codex", "Codex CLI");
export const claudeDockerRunner = runner("claude", "Claude CLI");

export function buildAgentDockerArgs(
  config: AppConfig,
  context: WebhookContext,
  workspaceVolume = workspaceVolumeName(context.jobId)
): string[] {
  const args = dockerRunPrefix(config, containerName(context.jobId, "agent"));
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  const selectedModel = context.agentSelection.model;
  const authMount = context.agentSelection.agent === "codex"
    ? `${config.agents.docker.codexAuthVolume}:/home/agent/.codex`
    : `${config.agents.docker.claudeAuthVolume}:/home/agent`;

  args.push(
    "--volume", `${workspaceVolume}:/workspace`,
    "--volume", `${path.resolve(context.jobDir)}:/job`,
    "--volume", authMount,
    "--env", "HOME=/home/agent",
    "--env", "CODEX_HOME=/home/agent/.codex",
    "--env", `LOCAL_AGENT_UID=${uid ?? 1000}`,
    "--env", `LOCAL_AGENT_GID=${gid ?? 1000}`,
    "--env", `AGENT_CLI=${context.agentSelection.agent}`,
    "--env", `JOB_ID=${context.jobId}`,
    "--env", `AGENT_MODEL=${selectedModel ?? ""}`,
    "--env", `AGENT_REASONING=${context.agentSelection.reasoning ?? ""}`,
    config.agents.docker.image
  );
  return args;
}

export function buildRepositoryDockerArgs(
  config: AppConfig,
  context: WebhookContext,
  phase: "prepare" | "finalize",
  workspaceVolume = workspaceVolumeName(context.jobId)
): string[] {
  const args = dockerRunPrefix(config, containerName(context.jobId, phase));
  const uid = process.getuid?.();
  const gid = process.getgid?.();

  args.push(
    "--volume", `${workspaceVolume}:/workspace`,
    ...(phase === "finalize"
      ? ["--volume", `${path.resolve(context.jobDir)}:/job`]
      : []),
    "--env", "GH_TOKEN",
    "--env", "GITHUB_TOKEN",
    "--env", "GH_HOST",
    "--env", `LOCAL_AGENT_UID=${uid ?? 1000}`,
    "--env", `LOCAL_AGENT_GID=${gid ?? 1000}`,
    "--env", `GITHUB_REPOSITORY=${context.metadata.cloneRepositoryFullName ?? context.metadata.repositoryFullName ?? ""}`,
    "--env", `GITHUB_BRANCH=${context.metadata.branch ?? ""}`,
    "--env", `JOB_ID=${context.jobId}`,
    config.agents.docker.repositoryImage,
    phase
  );
  return args;
}

export async function startDockerAgentJob(
  config: AppConfig,
  context: WebhookContext,
  prompt: string,
  options: StartAgentJobOptions = {}
): Promise<AgentJob> {
  const onComplete = options.onComplete ?? (async () => {});
  await mkdir(context.jobDir, { recursive: true });
  await writeFile(context.promptPath, prompt.replaceAll(context.jobDir, "/job"));

  const stdoutPath = path.join(context.jobDir, "docker.stdout.log");
  const stderrPath = path.join(context.jobDir, "docker.stderr.log");
  const transcriptPath = path.join(context.jobDir, "agent-final-message.md");
  const resultPath = path.join(context.jobDir, "agent-result.json");
  const metadataPath = path.join(context.jobDir, "job.json");
  const workspaceVolume = workspaceVolumeName(context.jobId);
  const args = buildAgentDockerArgs(config, context, workspaceVolume);
  const startedAt = new Date().toISOString();
  const selectedModel = context.agentSelection.model;
  const base: AgentJob = {
    jobId: context.jobId,
    status: "running",
    agent: context.agentSelection.agent,
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(context.agentSelection.reasoning ? { reasoning: context.agentSelection.reasoning } : {}),
    ...(context.agentSelection.routing ? { routing: context.agentSelection.routing } : {}),
    runnerId: context.agentSelection.agent,
    runnerName: `${context.agentRunnerName} in Docker`,
    command: config.agents.docker.command,
    args,
    jobDir: context.jobDir,
    stdoutPath,
    stderrPath,
    transcriptPath,
    agentOutputPath: context.agentOutputPath,
    resultPath,
    metadataPath,
    promptPath: context.promptPath,
    startedAt,
    kind: "isolated-docker-workflow"
  };

  if (config.core.dryRun) {
    const result: WorkerResult = {
      status: "completed",
      marker: "AGENT_WORKER_DONE",
      task: context.jobId,
      summary: "Dry run; Docker containers were not launched."
    };
    const job = { ...base, status: "dry-run" as const, finishedAt: startedAt };
    await Promise.all([
      writeFile(context.agentOutputPath, result.summary ?? ""),
      writeJsonFileAtomic(resultPath, result),
      writeJsonFileAtomic(metadataPath, job)
    ]);
    await onComplete(job, result);
    return job;
  }

  const hostEnv = options.env ?? process.env;
  if (!hostEnv.GH_TOKEN && !hostEnv.GITHUB_TOKEN) {
    throw new DockerAgentLaunchError(
      "GH_TOKEN or GITHUB_TOKEN is required for repository preparation and delivery"
    );
  }

  const running: AgentJob = {
    ...base,
    sessionId: workspaceVolume
  };
  await writeJsonFileAtomic(metadataPath, running);
  void monitorWorkflow(
    executeDockerWorkflow(config, context, workspaceVolume, hostEnv),
    running,
    onComplete
  );
  return running;
}

async function executeDockerWorkflow(
  config: AppConfig,
  context: WebhookContext,
  workspaceVolume: string,
  hostEnv: NodeJS.ProcessEnv
): Promise<WorkflowOutcome> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deadline = Date.now() + config.agents.docker.execTimeoutMs;
  let agentStdout = "";
  let activePhase: DockerPhase | "workspace" = "workspace";

  try {
    const create = await runDockerCommand(
      config.agents.docker.command,
      ["volume", "create", workspaceVolume],
      dockerBaseEnv(hostEnv),
      remainingMs(deadline)
    );
    appendPhaseLogs("workspace", create, stdout, stderr);
    assertCommandSucceeded("workspace", create);

    activePhase = "prepare";
    const prepare = await runDockerCommand(
      config.agents.docker.command,
      buildRepositoryDockerArgs(config, context, "prepare", workspaceVolume),
      dockerRepositoryEnv(hostEnv),
      remainingMs(deadline)
    );
    appendPhaseLogs("prepare", prepare, stdout, stderr);
    assertCommandSucceeded("prepare", prepare);

    activePhase = "agent";
    const agent = await runDockerCommand(
      config.agents.docker.command,
      buildAgentDockerArgs(config, context, workspaceVolume),
      dockerBaseEnv(hostEnv),
      remainingMs(deadline)
    );
    agentStdout = agent.stdout;
    appendPhaseLogs("agent", agent, stdout, stderr);
    assertCommandSucceeded("agent", agent);

    const parsed = parseWorkerResult(agentStdout, context.jobId);
    if (!parsed) {
      throw new DockerWorkflowError(
        "agent",
        "Agent completed without a valid worker completion envelope",
        agent
      );
    }

    activePhase = "finalize";
    const finalize = await runDockerCommand(
      config.agents.docker.command,
      buildRepositoryDockerArgs(config, context, "finalize", workspaceVolume),
      dockerRepositoryEnv(hostEnv),
      remainingMs(deadline)
    );
    appendPhaseLogs("finalize", finalize, stdout, stderr);
    assertCommandSucceeded("finalize", finalize);

    return {
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      agentStdout,
      result: parsed.result,
      exitCode: 0,
      signal: null,
      timedOut: false
    };
  } catch (error: unknown) {
    const workflowError = error instanceof DockerWorkflowError
      ? error
      : new DockerWorkflowError(activePhase, errorMessage(error));
    return {
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      agentStdout,
      failedPhase: workflowError.phase,
      exitCode: workflowError.commandResult?.exitCode ?? null,
      signal: workflowError.commandResult?.signal ?? null,
      timedOut: workflowError.commandResult?.timedOut ?? false,
      error: workflowError.message
    };
  } finally {
    await cleanupDockerWorkflow(config, context.jobId, workspaceVolume, hostEnv);
  }
}

async function monitorWorkflow(
  workflow: Promise<WorkflowOutcome>,
  job: AgentJob,
  onComplete: NonNullable<StartAgentJobOptions["onComplete"]>
): Promise<void> {
  const outcome = await workflow;
  await Promise.all([
    writeFile(job.stdoutPath, outcome.stdout),
    writeFile(job.stderrPath, outcome.stderr),
    writeFile(job.transcriptPath, outcome.agentStdout)
  ]);
  const finishedAt = new Date().toISOString();

  if (!outcome.result) {
    const failed: AgentJob = {
      ...job,
      status: outcome.timedOut ? "timeout" : "failed",
      finishedAt,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      error: outcome.error ?? `Docker ${outcome.failedPhase ?? "workflow"} phase failed`
    };
    await writeJsonFileAtomic(job.metadataPath, failed);
    await onComplete(failed, undefined);
    return;
  }

  const finished: AgentJob = {
    ...job,
    status: outcome.result.status,
    finishedAt,
    exitCode: 0
  };
  await Promise.all([
    writeJsonFileAtomic(job.resultPath, outcome.result),
    writeJsonFileAtomic(job.metadataPath, finished)
  ]);
  await onComplete(finished, outcome.result);
}

function dockerRunPrefix(config: AppConfig, name: string): string[] {
  const args = ["run", "--rm", "--name", name];
  if (config.agents.docker.pull) {
    args.push("--pull", "always");
  }
  return args;
}

function dockerBaseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return selectEnv(env, ["HOME", "PATH", "DOCKER_HOST", "DOCKER_CONTEXT"]);
}

function dockerRepositoryEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return selectEnv(env, [
    "HOME",
    "PATH",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GH_HOST"
  ]);
}

function selectEnv(env: NodeJS.ProcessEnv, keys: string[]): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    if (env[key] !== undefined) {
      result[key] = env[key];
    }
  }
  return result;
}

function runDockerCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, Math.max(1, timeoutMs));

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        spawnError: error.message
      });
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        signal: timedOut ? "SIGTERM" : signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut
      });
    });
  });
}

async function cleanupDockerWorkflow(
  config: AppConfig,
  jobId: string,
  workspaceVolume: string,
  hostEnv: NodeJS.ProcessEnv
): Promise<void> {
  const env = dockerBaseEnv(hostEnv);
  for (const phase of ["prepare", "agent", "finalize"] as const) {
    await runDockerCommand(
      config.agents.docker.command,
      ["rm", "--force", containerName(jobId, phase)],
      env,
      10_000
    );
  }
  await runDockerCommand(
    config.agents.docker.command,
    ["volume", "rm", "--force", workspaceVolume],
    env,
    10_000
  );
}

function appendPhaseLogs(
  phase: DockerPhase | "workspace",
  result: CommandResult,
  stdout: string[],
  stderr: string[]
): void {
  if (result.stdout) stdout.push(`[${phase}]\n${result.stdout}`);
  if (result.stderr) stderr.push(`[${phase}]\n${result.stderr}`);
}

function assertCommandSucceeded(
  phase: DockerPhase | "workspace",
  result: CommandResult
): void {
  if (result.exitCode === 0 && !result.spawnError && !result.timedOut) return;
  const detail = result.spawnError ?? (
    result.stderr.trim() || `Docker exited with code ${result.exitCode}`
  );
  throw new DockerWorkflowError(phase, `${phase} phase failed: ${detail}`, result);
}

function remainingMs(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

function workspaceVolumeName(jobId: string): string {
  return `agentbot-router-workspace-${safeName(jobId)}`;
}

function containerName(jobId: string, phase: DockerPhase): string {
  return `agentbot-router-${safeName(jobId)}-${phase}`.slice(0, 120);
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]/g, "-").slice(-80);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class DockerWorkflowError extends Error {
  readonly phase: DockerPhase | "workspace";
  readonly commandResult?: CommandResult;

  constructor(
    phase: DockerPhase | "workspace",
    message: string,
    commandResult?: CommandResult
  ) {
    super(message);
    this.phase = phase;
    this.commandResult = commandResult;
  }
}

export class DockerAgentLaunchError extends Error {}
