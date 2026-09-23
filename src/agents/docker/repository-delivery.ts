import { spawn } from "node:child_process";
import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../../config/index.ts";
import type { WebhookContext } from "../../core/webhook-context.ts";
import { buildGitHubEnv } from "../../integrations/github/gh.ts";
import type { AgentJob } from "../types.ts";

export type RepositoryWorkspace = {
  trustedCheckoutPath: string;
  agentWorkspacePath: string;
  branch?: string;
};

export async function prepareRepositoryWorkspace(
  config: AppConfig,
  context: WebhookContext,
  env: NodeJS.ProcessEnv = process.env
): Promise<RepositoryWorkspace> {
  const repository = context.metadata.cloneRepositoryFullName ?? context.metadata.repositoryFullName;
  if (!repository) throw new RepositoryDeliveryError("Repository metadata is required");

  const trustedCheckoutPath = path.join(
    path.dirname(context.jobDir),
    ".repository-workspaces",
    context.jobId,
    "trusted-repository"
  );
  const agentWorkspacePath = path.join(context.jobDir, "agent-workspace");
  await Promise.all([
    rm(trustedCheckoutPath, { recursive: true, force: true }),
    rm(agentWorkspacePath, { recursive: true, force: true })
  ]);
  await mkdir(context.jobDir, { recursive: true });

  await runChecked(
    config.integrations.github.command,
    ["repo", "clone", repository, trustedCheckoutPath],
    buildGitHubEnv(config.integrations.github, env),
    "clone repository"
  );

  const branch = context.metadata.branch;
  if (branch) {
    await runChecked(
      "git",
      ["-C", trustedCheckoutPath, "fetch", "origin", branch],
      buildGitEnv(config, env),
      "fetch target branch"
    );
    await runChecked(
      "git",
      ["-C", trustedCheckoutPath, "checkout", "-B", branch, `origin/${branch}`],
      env,
      "checkout target branch"
    );
  }

  await cp(trustedCheckoutPath, agentWorkspacePath, {
    recursive: true,
    filter: (source) => path.relative(trustedCheckoutPath, source).split(path.sep)[0] !== ".git"
  });
  return { trustedCheckoutPath, agentWorkspacePath, branch };
}

export async function finalizeRepositoryWorkspace(
  config: AppConfig,
  context: WebhookContext,
  workspace: RepositoryWorkspace,
  job: AgentJob,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await replaceWorkingFiles(workspace.trustedCheckoutPath, workspace.agentWorkspacePath);
  const gitEnv = buildGitEnv(config, env);
  const status = await runChecked(
    "git",
    ["-C", workspace.trustedCheckoutPath, "status", "--porcelain"],
    gitEnv,
    "inspect repository changes"
  );
  if (!status.trim()) return;

  await runChecked("git", ["-C", workspace.trustedCheckoutPath, "add", "--all"], gitEnv, "stage repository changes");
  await runChecked(
    "git",
    [
      "-C", workspace.trustedCheckoutPath,
      "-c", "core.hooksPath=/dev/null",
      "-c", "user.name=agentbot-router",
      "-c", "user.email=agentbot-router@users.noreply.github.com",
      "commit", "-m", `Apply agent task ${context.jobId}`
    ],
    gitEnv,
    "commit repository changes"
  );

  let deliveryNote: string;
  if (workspace.branch) {
    await runChecked(
      "git",
      ["-C", workspace.trustedCheckoutPath, "push", "origin", `HEAD:${workspace.branch}`],
      gitEnv,
      "push target branch"
    );
    deliveryNote = `Changes were committed and pushed to \`${workspace.branch}\`.`;
  } else {
    const taskBranch = `agent/${context.jobId}`;
    await runChecked("git", ["-C", workspace.trustedCheckoutPath, "switch", "-c", taskBranch], gitEnv, "create task branch");
    await runChecked(
      "git",
      ["-C", workspace.trustedCheckoutPath, "push", "--set-upstream", "origin", taskBranch],
      gitEnv,
      "push task branch"
    );
    const repository = context.metadata.cloneRepositoryFullName ?? context.metadata.repositoryFullName ?? "";
    const prUrl = await runChecked(
      config.integrations.github.command,
      ["pr", "create", "--repo", repository, "--head", taskBranch, "--fill"],
      buildGitHubEnv(config.integrations.github, env),
      "create pull request"
    );
    deliveryNote = `Pull request: ${prUrl.trim()}`;
  }

  const output = await readFile(job.agentOutputPath, "utf8");
  await writeFile(job.agentOutputPath, `${output.trimEnd()}\n\n${deliveryNote}\n`);
}

async function replaceWorkingFiles(trustedCheckoutPath: string, agentWorkspacePath: string): Promise<void> {
  const agentEntries = await readdir(agentWorkspacePath);
  if (agentEntries.includes(".git")) {
    throw new RepositoryDeliveryError("Agent workspace must not contain Git metadata");
  }
  await validateAgentWorkspace(agentWorkspacePath);
  const trustedEntries = await readdir(trustedCheckoutPath);
  await Promise.all(
    trustedEntries
      .filter((entry) => entry !== ".git")
      .map((entry) => rm(path.join(trustedCheckoutPath, entry), { recursive: true, force: true }))
  );
  for (const entry of agentEntries) {
    await cp(path.join(agentWorkspacePath, entry), path.join(trustedCheckoutPath, entry), {
      recursive: true,
      preserveTimestamps: true
    });
  }
}

async function validateAgentWorkspace(directory: string): Promise<void> {
  for (const entry of await readdir(directory)) {
    const entryPath = path.join(directory, entry);
    const stats = await lstat(entryPath);
    if (stats.isDirectory()) {
      await validateAgentWorkspace(entryPath);
    } else if (!stats.isFile() && !stats.isSymbolicLink()) {
      throw new RepositoryDeliveryError(`Agent workspace contains unsupported entry: ${entryPath}`);
    }
  }
}

function buildGitEnv(config: AppConfig, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env, ...buildGitHubEnv(config.integrations.github, env) };
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) return result;
  const host = env.GH_HOST?.trim() || "github.com";
  return {
    ...result,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: `http.https://${host}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    GIT_CONFIG_KEY_1: "credential.interactive",
    GIT_CONFIG_VALUE_1: "never"
  };
}

async function runChecked(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  step: string
): Promise<string> {
  const result = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({
      exitCode,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    }));
  });
  if (result.exitCode !== 0) {
    throw new RepositoryDeliveryError(`${step} failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
  }
  return result.stdout;
}

export class RepositoryDeliveryError extends Error {}
