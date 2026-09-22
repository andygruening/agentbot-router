import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../../config/index.ts";
import type { WebhookContext } from "../../core/webhook-context.ts";
import { parseWorkerResult } from "../shared/completion-envelope.ts";
import { writeJsonFileAtomic } from "../shared/json-files.ts";
import type { AgentJob, AgentRunner, StartAgentJobOptions, WorkerResult } from "../types.ts";

const runner = (id: "codex" | "claude", displayName: string): AgentRunner => ({ id, displayName, start: startDockerAgentJob });
export const codexDockerRunner = runner("codex", "Codex CLI");
export const claudeDockerRunner = runner("claude", "Claude CLI");

export function buildDockerArgs(config: AppConfig, context: WebhookContext): string[] {
  const args = ["run", "--rm", "--name", `local-agent-${safeName(context.jobId)}`];
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  const selectedModel = context.agentSelection.model ?? (context.agentSelection.agent === "codex"
    ? config.agents.codex.defaultModel
    : config.agents.claude.model);
  if (config.agents.docker.pull) args.push("--pull", "always");
  const authMount = context.agentSelection.agent === "codex"
    ? `${config.agents.docker.codexAuthVolume}:/home/agent/.codex`
    : `${config.agents.docker.claudeAuthVolume}:/home/agent`;
  args.push("--tmpfs", "/workspace:rw,exec,mode=1777",
    "--volume", `${path.resolve(context.jobDir)}:/job`,
    "--volume", authMount,
    "--env", "HOME=/home/agent",
    "--env", `LOCAL_AGENT_UID=${uid ?? 1000}`,
    "--env", `LOCAL_AGENT_GID=${gid ?? 1000}`,
    "--env", "GH_TOKEN", "--env", "GITHUB_TOKEN",
    "--env", `AGENT_CLI=${context.agentSelection.agent}`,
    "--env", `GITHUB_REPOSITORY=${context.metadata.cloneRepositoryFullName ?? context.metadata.repositoryFullName ?? ""}`,
    "--env", `GITHUB_BRANCH=${context.metadata.branch ?? ""}`,
    "--env", `JOB_ID=${context.jobId}`,
    "--env", `AGENT_MODEL=${selectedModel ?? ""}`,
    "--env", `AGENT_REASONING=${context.agentSelection.reasoning ?? ""}`,
    config.agents.docker.image);
  return args;
}

export async function startDockerAgentJob(config: AppConfig, context: WebhookContext, prompt: string, options: StartAgentJobOptions = {}): Promise<AgentJob> {
  const onComplete = options.onComplete ?? (async () => {});
  await mkdir(context.jobDir, { recursive: true });
  await writeFile(context.promptPath, prompt.replaceAll(context.jobDir, "/job"));
  const stdoutPath = path.join(context.jobDir, "docker.stdout.log");
  const stderrPath = path.join(context.jobDir, "docker.stderr.log");
  const transcriptPath = path.join(context.jobDir, "agent-final-message.md");
  const resultPath = path.join(context.jobDir, "agent-result.json");
  const metadataPath = path.join(context.jobDir, "job.json");
  const args = buildDockerArgs(config, context);
  const startedAt = new Date().toISOString();
  const selectedModel = context.agentSelection.model ?? (context.agentSelection.agent === "codex"
    ? config.agents.codex.defaultModel
    : config.agents.claude.model);
  const base: AgentJob = { jobId: context.jobId, status: "running", agent: context.agentSelection.agent,
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(context.agentSelection.reasoning ? { reasoning: context.agentSelection.reasoning } : {}),
    ...(context.agentSelection.routing ? { routing: context.agentSelection.routing } : {}),
    runnerId: context.agentSelection.agent, runnerName: `${context.agentRunnerName} in Docker`, command: config.agents.docker.command,
    args, jobDir: context.jobDir, stdoutPath, stderrPath, transcriptPath, agentOutputPath: context.agentOutputPath,
    resultPath, metadataPath, promptPath: context.promptPath, startedAt, kind: "docker-container" };
  if (config.core.dryRun) {
    const result: WorkerResult = { status: "completed", marker: "AGENT_WORKER_DONE", task: context.jobId, summary: "Dry run; Docker container was not launched." };
    const job = { ...base, status: "dry-run" as const, finishedAt: startedAt };
    await Promise.all([writeFile(context.agentOutputPath, result.summary ?? ""), writeJsonFileAtomic(resultPath, result), writeJsonFileAtomic(metadataPath, job)]);
    await onComplete(job, result); return job;
  }
  const hostEnv = options.env ?? process.env;
  if (!hostEnv.GH_TOKEN && !hostEnv.GITHUB_TOKEN) {
    throw new DockerAgentLaunchError("GH_TOKEN or GITHUB_TOKEN is required for container repository operations");
  }
  const child = spawn(config.agents.docker.command, args, { env: dockerHostEnv(hostEnv), stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk)); child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
  const processDone = waitForProcess(child, config.agents.docker.execTimeoutMs);
  await waitForSpawn(child);
  const running = { ...base, sessionId: String(child.pid) };
  await writeJsonFileAtomic(metadataPath, running);
  void monitor(processDone, context, running, stdout, stderr, onComplete);
  return running;
}

function dockerHostEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ["HOME", "PATH", "DOCKER_HOST", "DOCKER_CONTEXT", "GH_TOKEN", "GITHUB_TOKEN"])
    if (env[key] !== undefined) result[key] = env[key];
  return result;
}
async function monitor(processDone: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>, context: WebhookContext, job: AgentJob, out: Buffer[], err: Buffer[], onComplete: NonNullable<StartAgentJobOptions["onComplete"]>): Promise<void> {
  const processResult = await processDone;
  const stdout = Buffer.concat(out).toString("utf8"), stderr = Buffer.concat(err).toString("utf8");
  await Promise.all([writeFile(job.stdoutPath, stdout), writeFile(job.stderrPath, stderr), writeFile(job.transcriptPath, stdout)]);
  const finishedAt = new Date().toISOString();
  if (processResult.signal === "SIGTERM" || processResult.exitCode !== 0) {
    const failed: AgentJob = { ...job, status: processResult.signal === "SIGTERM" ? "timeout" : "failed", finishedAt, exitCode: processResult.exitCode, signal: processResult.signal, error: stderr.trim() || `Docker exited with code ${processResult.exitCode}` };
    await writeJsonFileAtomic(job.metadataPath, failed); await onComplete(failed, undefined); return;
  }
  const parsed = parseWorkerResult(stdout, context.jobId);
  if (!parsed) {
    const failed: AgentJob = { ...job, status: "failed", finishedAt, exitCode: 0, error: "Container completed without a valid worker completion envelope" };
    await writeJsonFileAtomic(job.metadataPath, failed); await onComplete(failed, undefined); return;
  }
  const finished: AgentJob = { ...job, status: parsed.result.status, finishedAt, exitCode: 0 };
  await Promise.all([writeJsonFileAtomic(job.resultPath, parsed.result), writeJsonFileAtomic(job.metadataPath, finished)]); await onComplete(finished, parsed.result);
}
function waitForSpawn(child: ReturnType<typeof spawn>): Promise<void> { return new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }); }
function waitForProcess(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => { let timedOut = false; const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    child.once("close", (exitCode, signal) => { clearTimeout(timer); resolve({ exitCode, signal: timedOut ? "SIGTERM" : signal }); });
    child.once("error", () => { clearTimeout(timer); resolve({ exitCode: null, signal: null }); }); });
}
function safeName(value: string): string { return value.toLowerCase().replace(/[^a-z0-9_.-]/g, "-").slice(-100); }
export class DockerAgentLaunchError extends Error {}
