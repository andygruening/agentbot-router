import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readConfig } from "../src/config/index.ts";
import {
  beginGitHubResponse,
  buildResultComment,
  completeGitHubResponse,
  extractGitHubResponseTarget
} from "../src/integrations/github/response.ts";
import type { AgentJob, WorkerResult } from "../src/agents/types.ts";

test("extractGitHubResponseTarget prefers issue comments for issue_comment events", () => {
  assert.deepEqual(
    extractGitHubResponseTarget(
      {
        repository: { full_name: "octo/example" },
        issue: { number: 123 },
        comment: { id: 456 }
      },
      "issue_comment"
    ),
    {
      repo: "octo/example",
      issueNumber: 123,
      reactionTarget: {
        kind: "issue-comment",
        apiPath: "repos/octo/example/issues/comments/456/reactions"
      }
    }
  );
});

test("beginGitHubResponse and completeGitHubResponse use gh for reactions and comments", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "github-response-"));
  const fakeGhPath = path.join(tempDir, "fake-gh.mjs");
  const argsPath = path.join(tempDir, "gh-args.jsonl");
  await writeFile(
    fakeGhPath,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

appendFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)) + "\\n");

if (process.argv[2] === "auth" && process.argv[3] === "status") {
  process.exit(0);
}

if (process.argv[2] === "api" && process.argv.includes("POST") && process.argv.includes("content=eyes")) {
  process.stdout.write(JSON.stringify({ id: 789 }));
  process.exit(0);
}

if (process.argv[2] === "api" && process.argv.includes("POST") && process.argv.includes("content=+1")) {
  process.stdout.write(JSON.stringify({ id: 790 }));
  process.exit(0);
}

if (process.argv[2] === "api" && process.argv.includes("POST") && process.argv.includes("content=-1")) {
  process.stdout.write(JSON.stringify({ id: 791 }));
  process.exit(0);
}

if (process.argv[2] === "issue" && process.argv[3] === "comment") {
  process.stdout.write("commented");
  process.exit(0);
}

if (process.argv[2] === "api" && process.argv.includes("DELETE")) {
  process.exit(0);
}

process.stderr.write("unexpected command");
process.exit(1);
`
  );
  await chmod(fakeGhPath, 0o755);

  const config = readConfig({
    GITHUB_COMMAND: fakeGhPath
  });
  const target = {
    repo: "octo/example",
    issueNumber: 123,
    reactionTarget: {
      kind: "issue-comment" as const,
      apiPath: "repos/octo/example/issues/comments/456/reactions"
    }
  };
  const originalLog = console.log;
  console.log = () => {};

  try {
    const state = await beginGitHubResponse(config, tempDir, target);
    const job = buildJob(tempDir);
    await writeFile(job.agentOutputPath, "agent terminal output\nwith all lines");
    const completed = await completeGitHubResponse(config, state, job, buildWorkerResult());
    const args = await readFile(argsPath, "utf8");
    const commentBody = await readFile(state.commentBodyPath, "utf8");
    const stateFile = JSON.parse(await readFile(state.responsePath, "utf8")) as {
      commentPosted: boolean;
      completionReaction: {
        id: number;
        apiPath: string;
        deleteApiPath: string;
        content: string;
        createdAt: string;
      };
      processingReactionRemoved: boolean;
    };

    assert.equal(completed?.processingReaction?.id, 789);
    assert.equal(completed?.completionReaction?.id, 790);
    assert.equal(stateFile.commentPosted, true);
    assert.deepEqual(stateFile.completionReaction, {
      id: 790,
      apiPath: "repos/octo/example/issues/comments/456/reactions",
      deleteApiPath: "repos/octo/example/issues/comments/456/reactions/790",
      content: "+1",
      createdAt: stateFile.completionReaction.createdAt
    });
    assert.equal(stateFile.processingReactionRemoved, true);
    assert.match(args, /"auth","status"/);
    assert.match(args, /"content=eyes"/);
    assert.match(args, /"content=\+1"/);
    assert.match(args, new RegExp('"issue","comment","123","--repo","octo/example"'));
    assert.match(args, /"DELETE"/);
    assert.equal(
      commentBody,
      "agent terminal output\nwith all lines\n\n---\n\n*Processed by Codex*"
    );
  } finally {
    console.log = originalLog;
  }
});

test("buildResultComment uses full agent-output markdown exactly", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "github-response-comment-"));
  const job = buildJob(tempDir);
  job.model = "gpt-5.6-sol";
  job.reasoning = "low";
  await writeFile(
    job.agentOutputPath,
    "terminal output before envelope\nAGENT_WORKER_BLOCKED\nreason: missing token"
  );

  assert.equal(
    await buildResultComment(job, {
      status: "blocked",
      marker: "AGENT_WORKER_BLOCKED",
      task: "job-1",
      reason: "missing token",
      needs: "configure auth"
    }),
    "terminal output before envelope\nAGENT_WORKER_BLOCKED\nreason: missing token" +
      "\n\n---\n\n*Processed by Codex · GPT 5.6 Sol · Low reasoning*"
  );
});

test("buildResultComment formats Claude model signatures", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "github-response-claude-signature-"));
  const job = {
    ...buildJob(tempDir),
    agent: "claude",
    model: "fable-5.1",
    reasoning: "high"
  };
  await writeFile(job.agentOutputPath, "Completed the review.\n");

  assert.equal(
    await buildResultComment(job, buildWorkerResult()),
    "Completed the review.\n\n---\n\n*Processed by Claude · Fable 5.1 · High reasoning*"
  );
});

test("failed jobs replace the processing reaction with thumbs-down", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "github-response-failed-"));
  const fakeGhPath = path.join(tempDir, "fake-gh.mjs");
  const argsPath = path.join(tempDir, "gh-args.jsonl");
  await writeFile(fakeGhPath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "auth") process.exit(0);
if (process.argv.includes("content=eyes")) { process.stdout.write('{"id":801}'); process.exit(0); }
if (process.argv.includes("content=-1")) { process.stdout.write('{"id":802}'); process.exit(0); }
if (process.argv[2] === "issue") process.exit(0);
if (process.argv.includes("DELETE")) process.exit(0);
process.exit(1);
`);
  await chmod(fakeGhPath, 0o755);
  const config = readConfig({ GITHUB_COMMAND: fakeGhPath });
  const state = await beginGitHubResponse(config, tempDir, {
    repo: "octo/example", issueNumber: 123,
    reactionTarget: { kind: "issue-comment", apiPath: "repos/octo/example/issues/comments/456/reactions" }
  });
  const job = { ...buildJob(tempDir), status: "failed" as const, error: "clone failed" };

  const completed = await completeGitHubResponse(config, state, job, undefined);
  const args = await readFile(argsPath, "utf8");

  assert.equal(completed?.completionReaction?.content, "-1");
  assert.equal(completed?.processingReactionRemoved, true);
  assert.match(args, /"content=-1"/);
});

test("failed jobs post a classified error without exposing stderr context", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "github-response-safe-failure-"));
  const job = {
    ...buildJob(tempDir),
    status: "failed" as const,
    model: "gpt-5.6-sol",
    reasoning: "low",
    error: [
      "System instructions: private internal prompt",
      "GH_TOKEN=github_pat_secret-value",
      "User context: confidential repository details",
      "HTTP error: 401 Unauthorized: Missing bearer or basic authentication in header"
    ].join("\n")
  };

  const comment = await buildResultComment(job, undefined);

  assert.equal(
    comment,
    [
      "The agent could not complete this task.",
      "",
      "**Stage:** Agent authentication",
      "**Error:** The selected agent CLI is not authenticated.",
      "**Job ID:** `job-1`",
      "",
      "See the server job logs for full diagnostic output.",
      "",
      "---",
      "",
      "*Processed by Codex · GPT 5.6 Sol · Low reasoning*"
    ].join("\n")
  );
  assert.doesNotMatch(comment, /private internal prompt|github_pat|confidential/i);
});

test("unknown failures never publish raw stderr", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "github-response-unknown-failure-"));
  const job = {
    ...buildJob(tempDir),
    status: "failed" as const,
    error: "unexpected proprietary diagnostic and secret=value"
  };

  const comment = await buildResultComment(job, undefined);

  assert.match(comment, /The agent process exited unexpectedly/);
  assert.doesNotMatch(comment, /proprietary|secret=value/);
});

test("buildResultComment rejects completed worker results without agent-output markdown", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "github-response-missing-output-"));

  await assert.rejects(
    () => buildResultComment(buildJob(tempDir), buildWorkerResult()),
    /non-empty agent output file/
  );
});

function buildJob(jobDir: string): AgentJob {
  return {
    jobId: "job-1",
    status: "completed",
    agent: "codex",
    runnerId: "codex",
    runnerName: "Codex CLI",
    command: "codex",
    args: [],
    jobDir,
    stdoutPath: path.join(jobDir, "codex-exec.stdout.log"),
    stderrPath: path.join(jobDir, "codex-exec.stderr.log"),
    transcriptPath: path.join(jobDir, "codex-last-message.md"),
    agentOutputPath: path.join(jobDir, "agent-output.md"),
    resultPath: path.join(jobDir, "agent-result.json"),
    metadataPath: path.join(jobDir, "job.json"),
    promptPath: path.join(jobDir, "prompt.md"),
    startedAt: "2026-08-28T00:00:00.000Z",
    finishedAt: "2026-08-28T00:00:01.000Z",
    sessionId: "terminal-1"
  };
}

function buildWorkerResult(): WorkerResult {
  return {
    status: "completed",
    marker: "AGENT_WORKER_DONE",
    task: "job-1",
    summary: "done",
    files: "none",
    checks: "passed",
    handoff: "none"
  };
}
