import assert from "node:assert/strict";
import path from "node:path";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { buildDockerArgs, startDockerAgentJob } from "../src/agents/docker/index.ts";
import { readConfig } from "../src/config/index.ts";
import type { WebhookContext } from "../src/core/webhook-context.ts";

test("Docker runner mounts Codex subscription auth and passes repository branch", () => {
  const context = buildContext("codex", "feature/fix");
  const args = buildDockerArgs(readConfig({}), context);
  assert.deepEqual(args.slice(0, 4), ["run", "--rm", "--name", "local-agent-job-1"]);
  assert.ok(args.includes("local-agent-codex-auth:/root/.codex"));
  assert.ok(args.includes("GITHUB_REPOSITORY=octo/example"));
  assert.ok(args.includes("GITHUB_BRANCH=feature/fix"));
  assert.ok(args.includes("AGENT_MODEL=gpt-5.5"));
  assert.ok(args.includes("AGENT_REASONING="));
  assert.ok(args.includes("GH_TOKEN"));
  assert.ok(!args.includes("CODEX_API_KEY"));
  assert.ok(!args.includes("ANTHROPIC_API_KEY"));
});

test("Docker runner mounts Claude subscription auth home", () => {
  const context = buildContext("claude");
  context.agentSelection.model = "fable-5.1";
  context.agentSelection.reasoning = "low";
  const args = buildDockerArgs(readConfig({}), context);
  assert.ok(args.includes("local-agent-claude-auth:/root"));
  assert.ok(args.includes("GITHUB_BRANCH="));
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
    agentSelection: { agent, tag: agent, source: "text", usesDefaultAgent: false },
    integrationPrompt: { savedFiles: "", guidance: "", responseInstructions: "", inlineContext: "" },
    metadata: { repositoryFullName: "octo/example", cloneRepositoryFullName: "octo/example", branch },
    payload: {}, headers: {}, rawBodyBytes: 2
  };
}


test("Docker runner records a completed container result", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "docker-agent-"));
  const fakeDocker = path.join(tempDir, "docker");
  await writeFile(fakeDocker, `#!/bin/sh
set -eu
volume=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "--volume" ]; then volume="$argument"; break; fi
  previous="$argument"
done
job_dir=\${volume%:/job}
printf 'Container response' > "$job_dir/agent-output.md"
printf 'AGENT_WORKER_DONE\\ntask: job-1\\nsummary: completed in container\\nfiles: none\\nchecks: passed\\nhandoff: none\\n'
`);
  await chmod(fakeDocker, 0o755);
  const context = buildContext("codex");
  context.jobDir = path.join(tempDir, "job");
  context.promptPath = path.join(context.jobDir, "prompt.md");
  context.agentOutputPath = path.join(context.jobDir, "agent-output.md");
  const config = readConfig({ DOCKER_COMMAND: fakeDocker, WEBHOOK_EVENT_DIR: tempDir });
  const job = await startDockerAgentJob(config, context, `Read ${context.jobDir}/github-context.md`, {
    env: { PATH: process.env.PATH, GH_TOKEN: "test-token" }
  });
  await waitFor(async () => JSON.parse(await readFile(job.metadataPath, "utf8")).status === "completed");
  assert.equal(await readFile(job.agentOutputPath, "utf8"), "Container response");
  assert.match(await readFile(job.promptPath, "utf8"), /\/job\/github-context\.md/);
  assert.equal(JSON.parse(await readFile(job.resultPath, "utf8")).summary, "completed in container");
});

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 2_000) {
    try { if (await predicate()) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
