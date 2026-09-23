import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import test from "node:test";
import { buildDockerArgs, startDockerAgentJob } from "../src/agents/docker/index.ts";
import { readConfig } from "../src/config/index.ts";
import type { WebhookContext } from "../src/core/webhook-context.ts";

test("Docker runner mounts a persistent workspace without GitHub credentials", () => {
  const context = buildContext("codex", "feature/fix");
  const args = buildDockerArgs(readConfig({}), context);
  assert.deepEqual(args.slice(0, 4), ["run", "--rm", "--name", "agentbot-router-job-1"]);
  assert.ok(args.includes("agentbot-router-codex-auth:/home/agent/.codex"));
  assert.ok(args.includes(`${path.resolve("/tmp/job-1/agent-workspace")}:/workspace/repository`));
  assert.ok(args.includes("/workspace/repository"));
  assert.ok(args.includes(`LOCAL_AGENT_UID=${process.getuid?.()}`));
  assert.ok(args.includes(`LOCAL_AGENT_GID=${process.getgid?.()}`));
  assert.ok(!args.includes("--user"));
  assert.ok(args.includes("HOME=/home/agent"));
  assert.ok(args.includes("CODEX_HOME=/home/agent/.codex"));
  assert.ok(!args.some((arg) => arg.startsWith("GITHUB_REPOSITORY=")));
  assert.ok(!args.some((arg) => arg.startsWith("GITHUB_BRANCH=")));
  assert.ok(args.includes("AGENT_MODEL=gpt-5.6-sol"));
  assert.ok(args.includes("AGENT_REASONING=low"));
  assert.ok(!args.includes("GH_TOKEN"));
  assert.ok(!args.includes("GITHUB_TOKEN"));
  assert.ok(!args.includes("GH_HOST"));
  assert.ok(!args.includes("CODEX_API_KEY"));
  assert.ok(!args.includes("ANTHROPIC_API_KEY"));
  assert.ok(!args.some((arg) => arg.includes("TYPESAFE_API_KEY")));
});

test("Docker runner mounts Claude subscription auth home", () => {
  const context = buildContext("claude");
  context.agentSelection.model = "fable-5.1";
  context.agentSelection.reasoning = "low";
  const args = buildDockerArgs(readConfig({}), context);
  assert.ok(args.includes("agentbot-router-claude-auth:/home/agent"));
  assert.ok(!args.some((arg) => arg.startsWith("GITHUB_BRANCH=")));
  assert.ok(args.includes("AGENT_CLI=claude"));
  assert.ok(args.includes("AGENT_MODEL=fable-5.1"));
  assert.ok(args.includes("AGENT_REASONING=low"));
});

function buildContext(agent: "codex" | "claude", branch?: string): WebhookContext {
  const jobDir = path.resolve("/tmp/job-1");
  return {
    integrationId: "github", integrationName: "GitHub", agentRunnerId: agent,
    agentRunnerName: `${agent} CLI`, receivedAt: "2026-09-19T00:00:00Z", eventName: "issue_comment",
    deliveryId: "delivery-1", jobId: "job-1", jobDir, envelopePath: `${jobDir}/webhook.json`,
    rawBodyPath: `${jobDir}/raw-body.json`, payloadPath: `${jobDir}/payload.json`, headersPath: `${jobDir}/headers.json`,
    promptPath: `${jobDir}/prompt.md`, agentOutputPath: `${jobDir}/agent-output.md`,
    agentSelection: {
      agent, model: "gpt-5.6-sol", reasoning: "low",
      tag: agent, source: "text", usesDefaultAgent: false
    },
    integrationPrompt: { savedFiles: "", guidance: "", responseInstructions: "", inlineContext: "" },
    metadata: { repositoryFullName: "octo/example", cloneRepositoryFullName: "octo/example", branch },
    payload: {}, headers: {}, rawBodyBytes: 2
  };
}


test("Docker runner records a completed container result", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "docker-agent-"));
  const origin = path.join(tempDir, "origin.git");
  const seed = path.join(tempDir, "seed");
  await execFileAsync("git", ["init", "--bare", origin]);
  await execFileAsync("git", ["init", seed]);
  await writeFile(path.join(seed, "README.md"), "before\n");
  await execFileAsync("git", ["-C", seed, "add", "README.md"]);
  await execFileAsync("git", ["-C", seed, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Initial"]);
  await execFileAsync("git", ["-C", seed, "remote", "add", "origin", origin]);
  await execFileAsync("git", ["-C", seed, "push", "origin", "HEAD:main"]);
  await execFileAsync("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main"]);
  const fakeGh = path.join(tempDir, "gh");
  await writeFile(fakeGh, `#!/bin/sh
set -eu
if [ "$1 $2" = "repo clone" ]; then exec git clone "$TEST_ORIGIN" "$4"; fi
if [ "$1 $2" = "pr create" ]; then printf 'https://example.test/pull/1\\n'; exit 0; fi
exit 2
`);
  await chmod(fakeGh, 0o755);
  const fakeDocker = path.join(tempDir, "docker");
  await writeFile(fakeDocker, `#!/bin/sh
set -eu
job_volume=""
workspace_volume=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "--volume" ]; then
    case "$argument" in
      *:/job) job_volume="$argument" ;;
      *:/workspace/repository) workspace_volume="$argument" ;;
    esac
  fi
  previous="$argument"
done
job_dir=\${job_volume%:/job}
workspace_dir=\${workspace_volume%:/workspace/repository}
printf 'after\\n' > "$workspace_dir/README.md"
printf 'Container response' > "$job_dir/agent-output.md"
printf 'AGENT_WORKER_DONE\\ntask: job-1\\nsummary: completed in container\\nfiles: none\\nchecks: passed\\nhandoff: none\\n'
`);
  await chmod(fakeDocker, 0o755);
  const context = buildContext("codex");
  context.jobDir = path.join(tempDir, "job");
  context.promptPath = path.join(context.jobDir, "prompt.md");
  context.agentOutputPath = path.join(context.jobDir, "agent-output.md");
  const config = readConfig({
    DOCKER_COMMAND: fakeDocker,
    GITHUB_COMMAND: fakeGh,
    GITHUB_ENV_PASSTHROUGH_JSON: '["TEST_ORIGIN"]',
    WEBHOOK_EVENT_DIR: tempDir
  });
  const job = await startDockerAgentJob(config, context, `Read ${context.jobDir}/github-context.md`, {
    env: { PATH: process.env.PATH, TEST_ORIGIN: origin }
  });
  await waitFor(async () => JSON.parse(await readFile(job.metadataPath, "utf8")).status === "completed");
  assert.match(await readFile(job.agentOutputPath, "utf8"), /^Container response/);
  assert.match(await readFile(job.promptPath, "utf8"), /\/job\/github-context\.md/);
  assert.equal(JSON.parse(await readFile(job.resultPath, "utf8")).summary, "completed in container");
  assert.match(await readFile(job.agentOutputPath, "utf8"), /Pull request: https:\/\/example\.test\/pull\/1/);
  const delivered = await execFileAsync("git", ["--git-dir", origin, "show", "agent/job-1:README.md"]);
  assert.equal(delivered.stdout, "after\n");
});

const execFileAsync = promisify(execFile);

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 2_000) {
    try { if (await predicate()) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
