import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { readConfig } from "../src/config/index.ts";
import { createWebhookServer, type AgentLauncher } from "../src/core/server.ts";

test("webhook endpoint persists payload and launches a Codex agent", async () => {
  const eventDir = await mkdtemp(path.join(tmpdir(), "webhook-receiver-"));
  const secret = "webhook-secret";
  const config = readConfig({
    GITHUB_WEBHOOK_SECRET: secret,
    WEBHOOK_EVENT_DIR: eventDir,
    AGENT_DEFAULT: "codex",
    GITHUB_CONTEXT_ENABLED: "false",
    GITHUB_RESPONSE_ENABLED: "false"
  });
  const launched: string[] = [];
  let releaseLaunch: () => void = () => {};
  const launchGate = new Promise<void>((resolve) => {
    releaseLaunch = resolve;
  });
  const launcher: AgentLauncher = async (_config, context, prompt) => {
    launched.push(prompt);
    await launchGate;
    return {
      jobId: context.jobId,
      status: "running",
      agent: context.agentSelection.agent,
      runnerId: "codex",
      runnerName: "Codex CLI",
      command: "codex",
      args: ["agents", "create", "--agent", context.agentSelection.agent],
      jobDir: context.jobDir,
      stdoutPath: path.join(context.jobDir, "codex-exec.stdout.log"),
      stderrPath: path.join(context.jobDir, "codex-exec.stderr.log"),
      transcriptPath: path.join(context.jobDir, "codex-last-message.md"),
      agentOutputPath: path.join(context.jobDir, "agent-output.md"),
      resultPath: path.join(context.jobDir, "agent-result.json"),
      metadataPath: path.join(context.jobDir, "job.json"),
      promptPath: context.promptPath,
      startedAt: new Date().toISOString()
    };
  };
  const server = createWebhookServer(config, launcher);
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  await listen(server);

  try {
    const payload = {
      action: "opened",
      comment: { body: "$codex please handle this" },
      issue: { number: 123 },
      repository: { full_name: "octo/example" },
      sender: { login: "octocat" }
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    const response = await fetch(serverUrl(server, config.integrations.github.webhookPath), {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-1",
        "x-github-event": "pull_request",
        "x-hub-signature-256": signature
      },
      body: rawBody
    });

    assert.equal(response.status, 202);
    releaseLaunch();
    const body = (await response.json()) as {
      jobDir: string;
      jobId: string;
      status: string;
      agentRunner: { id: string };
    };
    await waitFor(() => launched.length === 1);
    assert.equal(launched.length, 1);
    assert.match(launched[0] ?? "", /pull_request/);
    assert.match(launched[0] ?? "", /octo\/example/);
    assert.match(launched[0] ?? "", /Selected agent: codex/);
    assert.match(launched[0] ?? "", /GitHub issue\/PR context: skipped/);
    assert.equal(body.status, "accepted");
    assert.equal(body.agentRunner.id, "codex");

    const persistedPayload = JSON.parse(
      await readFile(path.join(body.jobDir, "payload.json"), "utf8")
    ) as typeof payload;
    assert.deepEqual(persistedPayload, payload);
    assert.match(body.jobId, /pull_request_delivery-1/);
    assert.match(logs.join("\n"), /Received GitHub webhook:/);
    assert.match(logs.join("\n"), /octo\/example/);
    assert.match(logs.join("\n"), /codex/);
    assert.doesNotMatch(logs.join("\n"), /"payload":/);
    assert.doesNotMatch(logs.join("\n"), /x-hub-signature-256/);

    const duplicate = await fetch(serverUrl(server, config.integrations.github.webhookPath), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-1",
        "x-github-event": "pull_request",
        "x-hub-signature-256": signature
      },
      body: rawBody
    });
    assert.equal(duplicate.status, 202);
    assert.equal(((await duplicate.json()) as { reason: string }).reason, "duplicate_delivery");
    assert.equal(launched.length, 1);
  } finally {
    releaseLaunch();
    console.log = originalLog;
    await close(server);
  }
});

test("$claude selects the Claude runner for a tagged delivery", async () => {
  const eventDir = await mkdtemp(path.join(tmpdir(), "webhook-claude-"));
  const config = readConfig({
    GITHUB_WEBHOOK_SECRET: "test-secret",
    WEBHOOK_EVENT_DIR: eventDir,
    GITHUB_CONTEXT_ENABLED: "false",
    GITHUB_RESPONSE_ENABLED: "false"
  });
  const selected: Array<{ runner: string; branch?: string; repo?: string }> = [];
  const originalLog = console.log;
  console.log = () => {};
  const server = createWebhookServer(config, async (_config, context) => {
    selected.push({
      runner: context.agentRunnerId,
      branch: context.metadata.branch,
      repo: context.metadata.cloneRepositoryFullName
    });
    return {
      jobId: context.jobId,
      status: "running",
      agent: context.agentSelection.agent,
      runnerId: "claude",
      runnerName: "Claude CLI",
      command: "claude",
      args: ["--print"],
      jobDir: context.jobDir,
      stdoutPath: path.join(context.jobDir, "claude.stdout.log"),
      stderrPath: path.join(context.jobDir, "claude.stderr.log"),
      transcriptPath: path.join(context.jobDir, "claude-final-message.md"),
      agentOutputPath: context.agentOutputPath,
      resultPath: path.join(context.jobDir, "agent-result.json"),
      metadataPath: path.join(context.jobDir, "job.json"),
      promptPath: context.promptPath,
      startedAt: new Date().toISOString()
    };
  });
  await listen(server);
  try {
    const rawBody = Buffer.from(JSON.stringify({
      action: "created",
      comment: { body: "$claude investigate" },
      issue: { number: 123 },
      pull_request: {
        number: 123,
        head: {
          ref: "feature/fix",
          repo: { full_name: "octocat/example-fork" }
        }
      },
      repository: { full_name: "octo/example" }
    }));
    const signature = `sha256=${createHmac("sha256", "test-secret").update(rawBody).digest("hex")}`;
    const response = await fetch(serverUrl(server, config.integrations.github.webhookPath), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "claude-1",
        "x-github-event": "issue_comment",
        "x-hub-signature-256": signature
      },
      body: rawBody
    });
    assert.equal(response.status, 202);
    assert.equal(((await response.json()) as { agentRunner: { id: string } }).agentRunner.id, "claude");
    await waitFor(() => selected.length === 1);
    assert.deepEqual(selected, [{
      runner: "claude",
      branch: "feature/fix",
      repo: "octocat/example-fork"
    }]);
  } finally {
    console.log = originalLog;
    await close(server);
  }
});

test("webhook endpoint rejects invalid signatures", async () => {
  const eventDir = await mkdtemp(path.join(tmpdir(), "webhook-receiver-"));
  const config = readConfig({
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    WEBHOOK_EVENT_DIR: eventDir,
    AGENT_DEFAULT: "codex",
    GITHUB_CONTEXT_ENABLED: "false",
    GITHUB_RESPONSE_ENABLED: "false"
  });
  const server = createWebhookServer(config, async () => {
    throw new Error("launcher should not be called");
  });
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  await listen(server);

  try {
    const response = await fetch(serverUrl(server, config.integrations.github.webhookPath), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-hub-signature-256": "sha256=wrong"
      },
      body: "{}"
    });

    assert.equal(response.status, 401);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /Rejected request:/);
    assert.match(warnings[0] ?? "", /invalid_signature/);
    assert.doesNotMatch(warnings[0] ?? "", /sha256=wrong/);
  } finally {
    console.warn = originalWarn;
    await close(server);
  }
});

test("webhook endpoint ignores valid requests without an agent tag", async () => {
  const eventDir = await mkdtemp(path.join(tmpdir(), "webhook-receiver-"));
  const secret = "webhook-secret";
  const config = readConfig({
    GITHUB_WEBHOOK_SECRET: secret,
    WEBHOOK_EVENT_DIR: eventDir,
    AGENT_DEFAULT: "codex",
    GITHUB_CONTEXT_ENABLED: "false",
    GITHUB_RESPONSE_ENABLED: "false"
  });
  const server = createWebhookServer(config, async () => {
    throw new Error("launcher should not be called");
  });
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};

  await listen(server);

  try {
    const payload = {
      action: "opened",
      comment: { body: "please investigate" },
      repository: { full_name: "octo/example" },
      sender: { login: "octocat" }
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    const response = await fetch(serverUrl(server, config.integrations.github.webhookPath), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-2",
        "x-github-event": "issue_comment",
        "x-hub-signature-256": signature
      },
      body: rawBody
    });
    const body = (await response.json()) as { ignored: boolean; reason: string };

    assert.equal(response.status, 202);
    assert.equal(body.ignored, true);
    assert.equal(body.reason, "agent_tag_not_found");
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    await close(server);
  }
});

test("webhook endpoint does not relaunch from issue tags on untagged comments", async () => {
  const eventDir = await mkdtemp(path.join(tmpdir(), "webhook-receiver-"));
  const secret = "webhook-secret";
  const config = readConfig({
    GITHUB_WEBHOOK_SECRET: secret,
    WEBHOOK_EVENT_DIR: eventDir,
    AGENT_DEFAULT: "codex",
    GITHUB_CONTEXT_ENABLED: "false",
    GITHUB_RESPONSE_ENABLED: "false"
  });
  const server = createWebhookServer(config, async () => {
    throw new Error("launcher should not be called");
  });
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};

  await listen(server);

  try {
    const payload = {
      action: "created",
      comment: { body: "Completed without a trigger tag." },
      issue: {
        number: 123,
        body: "$codex please handle this",
        labels: [{ name: "codex" }]
      },
      repository: { full_name: "octo/example" },
      sender: { login: "octocat" }
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    const response = await fetch(serverUrl(server, config.integrations.github.webhookPath), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-3",
        "x-github-event": "issue_comment",
        "x-hub-signature-256": signature
      },
      body: rawBody
    });
    const body = (await response.json()) as { ignored: boolean; reason: string };

    assert.equal(response.status, 202);
    assert.equal(body.ignored, true);
    assert.equal(body.reason, "agent_tag_not_found");
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    await close(server);
  }
});

function listen(server: ReturnType<typeof createWebhookServer>): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server: ReturnType<typeof createWebhookServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function serverUrl(server: ReturnType<typeof createWebhookServer>, pathname: string): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}${pathname}`;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2_000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
