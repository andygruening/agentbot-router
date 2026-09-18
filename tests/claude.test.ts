import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readConfig } from "../src/config/index.ts";
import {
  buildClaudeEnv,
  buildClaudeExecArgs,
  startClaudeAgentJob
} from "../src/agents/claude/index.ts";
import type { WebhookContext } from "../src/core/prompt.ts";

test("buildClaudeExecArgs runs Claude non-interactively", () => {
  const args = buildClaudeExecArgs(readConfig({
    CLAUDE_MODEL: "sonnet",
    CLAUDE_EXTRA_ARGS_JSON: '["--permission-mode","acceptEdits"]'
  }));
  assert.deepEqual(args, ["--print", "--output-format", "text", "--model", "sonnet", "--permission-mode", "acceptEdits", "Follow the task instructions on stdin."]);
});

test("startClaudeAgentJob launches claude exec and records the completed result", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-job-"));
  const fakeClaudePath = path.join(tempDir, "fake-claude.mjs");
  const argsPath = path.join(tempDir, "args.jsonl");
  const workerOutputPath = path.join(tempDir, "job", "agent-output.md");
  const publicAgentOutput = "Claude finished the requested work.";
  const finalMessage = `${publicAgentOutput}
AGENT_WORKER_DONE
task: job-1
summary: claude agent result
files: none
checks: fake check passed
handoff: none
`;

  await writeFile(
    fakeClaudePath,
    `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(argsPath)}, JSON.stringify(args) + "\\n");

let stdin = "";
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  if (!stdin.includes("test prompt should not be logged")) {
    process.stderr.write("missing prompt", () => {
      process.exit(1);
    });
    return;
  }


  writeFileSync(${JSON.stringify(workerOutputPath)}, ${JSON.stringify(publicAgentOutput)});
  process.stdout.write(${JSON.stringify(finalMessage)}, () => {
    process.exit(0);
  });
});
`
  );
  await chmod(fakeClaudePath, 0o755);

  const config = readConfig({
    AGENT_DEFAULT: "claude",
    AGENT_TAGS: "claude",
    CLAUDE_COMMAND: fakeClaudePath,
    CLAUDE_MODEL: "sonnet",
    CLAUDE_EXEC_TIMEOUT_MS: "5000",
    WEBHOOK_EVENT_DIR: tempDir
  });
  const context = buildWebhookContext(tempDir);
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const job = await startClaudeAgentJob(config, context, "test prompt should not be logged");
    await waitFor(async () => {
      const metadata = JSON.parse(await readFile(job.metadataPath, "utf8")) as { status: string };
      return metadata.status === "completed";
    });

    const metadata = JSON.parse(await readFile(job.metadataPath, "utf8")) as {
      status: string;
      agent: string;
      runnerId: string;
      stdoutPath: string;
      transcriptPath: string;
    };
    const result = JSON.parse(await readFile(job.resultPath, "utf8")) as {
      summary: string;
      checks: string;
    };
    const savedAgentOutput = await readFile(job.agentOutputPath, "utf8");
    const args = await readFile(argsPath, "utf8");

    assert.equal(metadata.status, "completed");
    assert.equal(metadata.agent, "claude");
    assert.equal(metadata.runnerId, "claude");
    assert.equal(metadata.stdoutPath, job.stdoutPath);
    assert.equal(metadata.transcriptPath, job.transcriptPath);
    assert.equal(result.summary, "claude agent result");
    assert.equal(result.checks, "fake check passed");
    assert.equal(savedAgentOutput, publicAgentOutput);
    assert.match(args, /"--print","--output-format","text","--model","sonnet"/);

    assert.doesNotMatch(logs.join("\n"), /test prompt should not be logged/);
  } finally {
    console.log = originalLog;
  }
});

test("buildClaudeEnv passes only the configured minimal environment", () => {
  assert.deepEqual(
    buildClaudeEnv(
      readConfig({ CLAUDE_ENV_PASSTHROUGH_JSON: "[\"ANTHROPIC_API_KEY\"]" }).agents.claude,
      {
        HOME: "/home/test",
        PATH: "/bin",
        ANTHROPIC_API_KEY: "key",
        SECRET: "do-not-pass"
      }
    ),
    {
      HOME: "/home/test",
      PATH: "/bin",
      ANTHROPIC_API_KEY: "key"
    }
  );
});

function buildWebhookContext(tempDir: string): WebhookContext {
  const jobDir = path.join(tempDir, "job");

  return {
    integrationId: "github",
    integrationName: "GitHub",
    agentRunnerId: "claude",
    agentRunnerName: "Claude CLI",
    receivedAt: "2026-08-28T00:00:00.000Z",
    eventName: "issues",
    deliveryId: "delivery-2",
    jobId: "job-1",
    jobDir,
    envelopePath: path.join(jobDir, "webhook.json"),
    rawBodyPath: path.join(jobDir, "raw-body.json"),
    payloadPath: path.join(jobDir, "payload.json"),
    headersPath: path.join(jobDir, "headers.json"),
    promptPath: path.join(jobDir, "prompt.md"),
    agentOutputPath: path.join(jobDir, "agent-output.md"),
    agentSelection: {
      agent: "claude",
      tag: "agent",
      source: "text",
      usesDefaultAgent: true
    },
    integrationPrompt: {
      savedFiles: "- GitHub issue/PR context: skipped (github_context_disabled)",
      guidance: "No extended GitHub issue/PR context was fetched for this delivery.",
      responseInstructions:
        "The webhook receiver owns GitHub reactions and final result comments. Do not add reactions or post GitHub comments yourself.",
      inlineContext: ""
    },
    metadata: {
      action: "opened",
      repositoryFullName: "octo/example",
      senderLogin: "octocat"
    },
    payload: {
      action: "opened",
      repository: { full_name: "octo/example" },
      sender: { login: "octocat" }
    },
    headers: {},
    rawBodyBytes: 2
  };
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 2_000) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error("Timed out waiting for condition");
}
